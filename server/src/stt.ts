import WebSocket from 'ws';

export interface TranscriptData {
  text: string;
  isFinal: boolean;
  speechFinal: boolean;
  confidence: number;
  wordCount: number;
}

export interface DeepgramSttOptions {
  apiKey: string;
  onTranscript: (data: TranscriptData) => void;
  onSpeechStarted?: () => void;
  onUtteranceEnd?: () => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
}

/**
 * DeepgramStt
 * 
 * Manages a direct, raw WebSocket streaming connection to Deepgram's Speech-to-Text API.
 * Uses raw 'ws' package to expose protocol details without vendor SDK abstraction.
 */
export class DeepgramStt {
  private apiKey: string;
  private ws: WebSocket | null = null;
  private onTranscriptCallback: (data: TranscriptData) => void;
  private onSpeechStartedCallback?: () => void;
  private onUtteranceEndCallback?: () => void;
  private onErrorCallback?: (error: Error) => void;
  private onCloseCallback?: () => void;
  private isClosing: boolean = false;

  constructor(options: DeepgramSttOptions) {
    this.apiKey = options.apiKey;
    this.onTranscriptCallback = options.onTranscript;
    this.onSpeechStartedCallback = options.onSpeechStarted;
    this.onUtteranceEndCallback = options.onUtteranceEnd;
    this.onErrorCallback = options.onError;
    this.onCloseCallback = options.onClose;
  }

  /**
   * Opens the WebSocket connection to Deepgram with real-time streaming parameters.
   */
  public connect(): void {
    if (this.ws) {
      return;
    }

    this.isClosing = false;

    // Build URL with streaming speech-to-text parameters
    const params = new URLSearchParams({
      model: 'nova-3',
      encoding: 'linear16',
      sample_rate: '16000',
      channels: '1',
      interim_results: 'true',
      endpointing: '400',
      utterance_end_ms: '1000',
      vad_events: 'true',
      smart_format: 'true',
    });

    const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`;

    // Connect using raw ws library with Authorization token header
    this.ws = new WebSocket(url, {
      headers: {
        Authorization: `Token ${this.apiKey}`,
      },
    });

    this.ws.on('open', () => {
      // Deepgram stream ready to receive binary PCM audio frames
    });

    this.ws.on('message', (rawData: WebSocket.RawData) => {
      try {
        const message = JSON.parse(rawData.toString());

        switch (message.type) {
          case 'Results': {
            const channel = message.channel;
            const alternative = channel?.alternatives?.[0];
            const text = alternative?.transcript ?? '';
            const isFinal = Boolean(message.is_final);
            const speechFinal = Boolean(message.speech_final);

            // Rule: Ignore empty transcripts unless speech_final is true
            if (!text.trim() && !speechFinal) {
              return;
            }

            // Compute confidence: use alternative confidence, or compute average from words array
            let confidence = alternative?.confidence ?? 0;
            if (alternative?.words && alternative.words.length > 0) {
              const wordConfidenceSum = alternative.words.reduce(
                (sum: number, w: { confidence?: number }) => sum + (w.confidence ?? 0),
                0
              );
              confidence = wordConfidenceSum / alternative.words.length;
            }

            const wordCount = alternative?.words?.length ?? (text.trim() ? text.trim().split(/\s+/).length : 0);

            this.onTranscriptCallback({
              text,
              isFinal,
              speechFinal,
              confidence,
              wordCount,
            });
            break;
          }

          case 'SpeechStarted':
            this.onSpeechStartedCallback?.();
            break;

          case 'UtteranceEnd':
            this.onUtteranceEndCallback?.();
            break;

          default:
            // Other metadata messages like 'Metadata' are safely ignored
            break;
        }
      } catch (err) {
        // Safe catch to ensure one malformed message cannot crash the server
        console.error('Failed to parse Deepgram message:', err);
      }
    });

    this.ws.on('error', (err: Error) => {
      if (!this.isClosing) {
        this.onErrorCallback?.(err);
      }
    });

    this.ws.on('close', () => {
      this.ws = null;
      this.onCloseCallback?.();
    });
  }

  /**
   * Forwards a raw binary 16 kHz PCM chunk directly to Deepgram.
   */
  public sendAudio(buffer: Buffer): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(buffer);
    }
  }

  /**
   * Gracefully terminates the Deepgram stream by sending CloseStream first.
   */
  public close(): void {
    if (!this.ws) {
      return;
    }

    this.isClosing = true;

    if (this.ws.readyState === WebSocket.OPEN) {
      try {
        // Deepgram protocol requires sending {"type": "CloseStream"} before closing
        this.ws.send(JSON.stringify({ type: 'CloseStream' }));
      } catch {
        // Socket may have been closing concurrently
      }

      // Close the underlying connection
      this.ws.close();
    }

    this.ws = null;
  }
}
