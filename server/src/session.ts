import { Transport } from './transport';
import { ChatMessage, streamSentences, buildSystemPrompt } from './llm';
import { DeepgramStt, TranscriptData } from './stt';
import { DeepgramTts } from './tts';
import { config } from './config';

export interface StartParams {
  name?: string;
  inquiry?: string;
  mode?: string;
}

/**
 * CallSession
 * 
 * Manages the conversational state and orchestration for a single call.
 * Talks exclusively to the abstract Transport interface to remain fully decoupled
 * from transport-specific details (WebSocket, telephony, etc.).
 */
export class CallSession {
  // Conversation history for LLM context
  private history: ChatMessage[] = [];

  // Buffer accumulating finalized text chunks of the user's current utterance
  private buffer: string[] = [];

  // Monotonically increasing agent turn counter
  private turnIdCounter: number = 0;

  // Active marks emitted to the client waiting for completion acknowledgment
  private pendingMarks: Set<string> = new Set();

  // Active turn promise to ensure turns run cleanly in order
  private currentTurnPromise: Promise<void> | null = null;

  // Deepgram STT stream instance for this session
  private stt: DeepgramStt | null = null;

  // Formatted persona system prompt for the LLM
  private systemPrompt: string = '';

  // Lifecycle flags
  private isStarted: boolean = false;
  private isStopped: boolean = false;

  constructor(private transport: Transport) {}

  /**
   * Initializes the session on start:
   * 1. Builds the system prompt.
   * 2. Connects Deepgram STT.
   * 3. Speaks an initial greeting through the same runTurn pipeline.
   */
  public async start(params: StartParams): Promise<void> {
    if (this.isStarted || this.isStopped) {
      return;
    }
    this.isStarted = true;

    // Build conversational system prompt
    this.systemPrompt = buildSystemPrompt(params.name, params.inquiry);

    // Initialize Deepgram STT if API key is present
    if (config.DEEPGRAM_API_KEY) {
      this.stt = new DeepgramStt({
        apiKey: config.DEEPGRAM_API_KEY,
        onTranscript: (data: TranscriptData) => {
          this.handleTranscript(data);
        },
        onUtteranceEnd: () => {
          this.handleUtteranceEnd();
        },
        onError: (err: Error) => {
          console.error('[CallSession] STT error:', err);
        },
      });

      this.stt.connect();
    } else {
      console.warn('[CallSession] DEEPGRAM_API_KEY is missing. Speech recognition will be unavailable.');
    }

    // Compose personalized or default greeting
    const agentName = config.AGENT_NAME || 'Alex';
    let greeting = `Hello! I am ${agentName}. How can I help you today?`;
    if (params.name) {
      greeting = `Hello ${params.name}! I am ${agentName}. How can I help you today?`;
    }

    // Play greeting through the exact same runTurn() path used for LLM replies
    async function* greetingSource() {
      yield greeting;
    }

    this.currentTurnPromise = this.runTurn(greetingSource());
    this.currentTurnPromise.catch((err) => {
      console.error('[CallSession] Error during greeting turn:', err);
    });

    await this.currentTurnPromise;
  }

  /**
   * Runs an agent conversational turn:
   * 1. Consumes sentences from source (greeting or LLM stream).
   * 2. Feeds sentences to Deepgram TTS.
   * 3. Streams 16 kHz PCM chunks to transport.sendAudio(payload, turnId).
   * 4. Emits a mark at the end of the audio stream and tracks in pendingMarks.
   * 5. Saves agent reply into history.
   */
  private async runTurn(sentenceSource: AsyncIterable<string>): Promise<void> {
    const turnId = ++this.turnIdCounter;
    console.log(`[CallSession] Starting agent turn ${turnId}...`);
    const tts = new DeepgramTts();

    try {
      await tts.start();

      let fullAgentReply = '';

      // Task 1: Feed sentences into TTS and send agent captions to transport
      const sendSentencesTask = (async () => {
        try {
          for await (const sentence of sentenceSource) {
            if (this.isStopped) {
              break;
            }
            console.log(`[CallSession] Turn ${turnId} sentence: "${sentence}"`);
            fullAgentReply += (fullAgentReply ? ' ' : '') + sentence;
            this.transport.sendTranscript('agent', sentence, true);
            tts.sendText(sentence);
          }
        } finally {
          tts.finish();
        }
      })();

      // Task 2: Receive synthesized 16 kHz PCM chunks and stream down to transport
      const sendAudioTask = (async () => {
        for await (const audioChunk of tts.audio()) {
          if (this.isStopped) {
            break;
          }
          this.transport.sendAudio(audioChunk, turnId);
        }
      })();

      // Await both text dispatch and audio completion concurrently
      await Promise.all([sendSentencesTask, sendAudioTask]);

      // Save complete agent response into history for future LLM turns
      if (fullAgentReply.trim()) {
        this.history.push({ role: 'assistant', content: fullAgentReply.trim() });
      }

      // Emit trailing mark so client can acknowledge when playback finishes
      const markName = `mark_turn_${turnId}`;
      this.pendingMarks.add(markName);
      this.transport.sendMark(markName);
      console.log(`[CallSession] Agent turn ${turnId} audio sent. Emitted mark: "${markName}"`);
    } catch (err) {
      console.error(`[CallSession] Error in agent turn ${turnId}:`, err);
    } finally {
      tts.close();
    }
  }

  /**
   * Processes incoming transcripts from Deepgram STT:
   * - Interim results are sent to the client for live visual preview.
   * - Final chunks are pushed to the utterance buffer.
   * - When speechFinal is true, triggers user commitment and LLM turn.
   */
  private handleTranscript(data: TranscriptData): void {
    if (this.isStopped) {
      return;
    }

    // If interim result and not speechFinal, update preview
    if (!data.isFinal && !data.speechFinal) {
      if (data.text.trim()) {
        this.transport.sendTranscript('user', data.text, false);
      }
      return;
    }

    // Push finalized text fragment to the current utterance buffer
    if (data.text.trim()) {
      this.buffer.push(data.text.trim());
      this.transport.sendTranscript('user', data.text.trim(), true);
      console.log(`[CallSession] User chunk finalized: "${data.text.trim()}" (speechFinal=${data.speechFinal})`);
    }

    // Natural sentence boundary detected by Deepgram endpointing
    if (data.speechFinal && this.buffer.length > 0) {
      this.commitUserUtteranceAndReply();
    }
  }

  /**
   * Handles Deepgram's UtteranceEnd event (1 second of sustained silence).
   * Serves as a safety net if speechFinal didn't trigger cleanly.
   */
  private handleUtteranceEnd(): void {
    if (this.isStopped) {
      return;
    }

    if (this.buffer.length > 0) {
      console.log('[CallSession] UtteranceEnd event triggered with buffered speech');
      this.commitUserUtteranceAndReply();
    }
  }

  /**
   * Joins buffered user text, updates conversation history, and triggers an LLM turn.
   */
  private commitUserUtteranceAndReply(): void {
    const userUtterance = this.buffer.join(' ').trim();
    this.buffer = [];

    if (!userUtterance) {
      return;
    }

    console.log(`[CallSession] User utterance completed: "${userUtterance}"`);

    // Record user message in history
    this.history.push({ role: 'user', content: userUtterance });

    // Validate LLM API key before starting turn
    if (!config.LLM_API_KEY) {
      const missingKeyWarning = 'LLM_API_KEY is not set in server/.env. Please add your Groq API key to enable AI responses.';
      console.error(`[CallSession] ${missingKeyWarning}`);
      this.transport.sendTranscript('agent', `[Error: ${missingKeyWarning}]`, true);
      return;
    }

    // Execute LLM response turn (chaining after prior turn if still active)
    const previousTurn = this.currentTurnPromise;
    const executeTurn = async () => {
      if (previousTurn) {
        try {
          await previousTurn;
        } catch {
          // Ignore prior turn errors to continue conversation
        }
      }

      if (this.isStopped) {
        return;
      }

      await this.runTurn(streamSentences(this.systemPrompt, this.history));
    };

    this.currentTurnPromise = executeTurn();
    this.currentTurnPromise.catch((err) => {
      console.error('[CallSession] Error during user-triggered turn:', err);
    });
  }

  /**
   * Forwards client audio payloads to Deepgram STT.
   */
  public handleMedia(payloadBase64: string): void {
    if (this.isStopped || !this.stt) {
      return;
    }
    const buffer = Buffer.from(payloadBase64, 'base64');
    this.stt.sendAudio(buffer);
  }

  /**
   * Removes completed mark when acknowledged by the client.
   */
  public handleMark(name: string): void {
    this.pendingMarks.delete(name);
  }

  /**
   * Cleans up STT and active resources when the call stops.
   */
  public stop(): void {
    if (this.isStopped) {
      return;
    }
    this.isStopped = true;

    if (this.stt) {
      this.stt.close();
      this.stt = null;
    }

    this.pendingMarks.clear();
    this.buffer = [];
  }
}
