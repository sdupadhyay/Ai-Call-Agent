PROJECT: A learning/POC AI voice agent that makes OUTBOUND phone calls. Not for production.

FLOW: Backend asks Twilio to call a customer. When they pick up, Twilio opens a WebSocket to our server and streams 8 kHz mu-law audio both ways. Server pipes audio to Deepgram (speech-to-text), sends the text to an LLM, streams the reply sentence by sentence to ElevenLabs (text-to-speech), and sends the audio back to Twilio. The agent must handle interruptions (barge-in).

STACK: Node.js 20+(Latest), TypeScript (strict mode), Fastify + @fastify/websocket or Browser native ws:, official "twilio" package, "Groq" package for LLM, dotenv + zod for config, tsx for dev, vitest for tests. Use the raw "ws" package for Deepgram and ElevenLabs (no vendor SDKs for those two) so I can see the protocol.

WORKING RULES:

1. Build ONLY what the current prompt asks. Do not add extra features or future-step code. Also after each prompt dont start coding immediately first please sharte the implementation plan and get approval from me then only start coding.
2. I am a beginner. Keep files small and single-purpose. Add short comments explaining WHY, not just what.
3. After finishing, give me a plain-English walkthrough: what each new file does, how data flows, and any new concept (explain it simply).
4. Tell me exactly how to verify the step works (commands to run, what I should see).
5. If unsure about an external API's protocol, check the official docs. Never guess message formats.
6. Never hardcode secrets. All keys come from .env.
7. Every un-awaited promise needs a .catch so one failure cannot crash the process.
8. Stop when the step is done and wait for my next prompt.
9. Always follow best practice of coding and folder structure. 