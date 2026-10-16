import Groq from 'groq-sdk';
import { config } from './config';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Builds the system prompt for our voice agent.
 * 
 * Rules embedded in the prompt:
 * - Friendly phone-style assistant.
 * - Short, conversational spoken sentences.
 * - Strict prohibition of markdown, bullet points, asterisks, and numbered lists (since it's spoken).
 * - Ask only one question at a time.
 * - If interrupted, acknowledge the customer's input and do not repeat previous statements.
 */
export function buildSystemPrompt(customerName?: string, inquiry?: string): string {
  const agentName = config.AGENT_NAME || 'Alex';
  const companyName = config.COMPANY_NAME || 'our service';

  const customerGreeting = customerName ? `The customer's name is ${customerName}.` : '';
  const customerInquiry = inquiry ? `The customer is calling about: "${inquiry}".` : '';

  return `You are ${agentName}, a friendly and helpful phone agent for ${companyName}.
You are speaking directly with a customer on a real-time telephone / voice call.
${customerGreeting}
${customerInquiry}

CRITICAL RULES FOR SPOKEN VOICE RESPONSES:
1. Speak in short, natural, conversational sentences.
2. NEVER use markdown formatting, bullet points, numbered lists, emojis, or symbols like asterisks (*). Your words will be converted directly to speech by a text-to-speech engine.
3. Keep answers concise (1 to 3 sentences maximum per turn).
4. Ask only ONE question at a time so the customer has room to respond.
5. If the customer interrupts you, smoothly adapt to what they just said and do not repeat what you previously started saying.
6. Speak warmly, professionally, and clearly.`
    .replace(/\n\s+/g, '\n')
    .trim();
}

/**
 * Helper function to extract a complete sentence from a text buffer based on punctuation boundaries.
 * 
 * Boundary rules:
 * - Emits at . ! or ? followed by whitespace.
 * - For the first chunk only (isFirstChunk === true), also allows comma (,) followed by whitespace.
 * - Skips any boundary that results in a fragment under 12 characters (e.g. abbreviations like "Dr.", "U.S.").
 */
function extractNextSentence(
  buffer: string,
  isFirstChunk: boolean
): { sentence: string; remaining: string; isFirstChunk: boolean } | null {
  // Regex: if first chunk, match comma or terminal punctuation followed by whitespace.
  // Otherwise, match only terminal punctuation followed by whitespace.
  const regex = isFirstChunk ? /([.!?]|,)\s+/g : /([.!?])\s+/g;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(buffer)) !== null) {
    const boundaryEnd = match.index + match[1].length; // Include the punctuation mark
    const fragment = buffer.slice(0, boundaryEnd).trim();

    // Skip boundaries that give fragments under 12 characters (prevents premature splits on abbreviations)
    if (fragment.length >= 12) {
      const remaining = buffer.slice(match.index + match[0].length);
      return {
        sentence: fragment,
        remaining,
        isFirstChunk: false,
      };
    }
  }

  return null;
}

/**
 * Async generator that calls Groq chat completion stream and yields one complete sentence at a time.
 * 
 * @param systemPrompt - Instructions defining persona and rules
 * @param history - Conversation history messages
 * @param signal - Optional AbortSignal for immediate cancellation on interruption
 */
export async function* streamSentences(
  systemPrompt: string,
  history: ChatMessage[],
  signal?: AbortSignal
): AsyncGenerator<string, void, unknown> {
  if (!config.LLM_API_KEY) {
    throw new Error('LLM_API_KEY is not set in environment variables. Please add it to your .env file.');
  }

  if (signal?.aborted) {
    return;
  }

  // Initialize Groq client with configured credentials and optional custom base URL
  const groq = new Groq({
    apiKey: config.LLM_API_KEY,
    baseURL: config.LLM_BASE_URL || undefined,
  });

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history,
  ];

  let stream;
  try {
    stream = await groq.chat.completions.create(
      {
        model: config.LLM_MODEL || 'llama-3.3-70b-versatile',
        messages,
        max_tokens: 150,
        stream: true,
      },
      { signal }
    );
  } catch (err: unknown) {
    // If the request was aborted before or during initiation, exit gracefully
    if (signal?.aborted || (err as { name?: string })?.name === 'AbortError') {
      return;
    }
    throw err;
  }

  let buffer = '';
  let isFirstChunk = true;

  try {
    for await (const chunk of stream) {
      if (signal?.aborted) {
        return;
      }

      const content = chunk.choices[0]?.delta?.content || '';
      buffer += content;

      // Extract all completed sentences from the current buffer
      let extracted: ReturnType<typeof extractNextSentence>;
      while ((extracted = extractNextSentence(buffer, isFirstChunk)) !== null) {
        yield extracted.sentence;
        buffer = extracted.remaining;
        isFirstChunk = extracted.isFirstChunk;
      }
    }
  } catch (err: unknown) {
    // If streaming was aborted mid-flight (e.g. user barge-in), exit cleanly
    if (signal?.aborted || (err as { name?: string })?.name === 'AbortError' || (err as { name?: string })?.name === 'APIUserAbortError') {
      return;
    }
    throw err;
  }

  // Yield any remaining leftover text at the end of the stream
  const leftover = buffer.trim();
  if (leftover.length > 0 && !signal?.aborted) {
    yield leftover;
  }
}
