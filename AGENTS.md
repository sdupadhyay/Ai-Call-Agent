PROJECT: A learning/POC AI voice agent that talks to a user from a BROWSER (no phone network, no Twilio). Not for production.

FLOW: A web page captures the microphone and streams audio to our server over a WebSocket. The server pipes audio to Deepgram (speech-to-text), sends the text to an LLM, streams the reply sentence by sentence to Deepgram Aura (text-to-speech), and streams the audio back to the page, which plays it from a queue it can flush instantly. The agent must handle interruptions (barge-in) very reliably, including in noisy places and when the agent's own voice leaks into the mic.

STACK:
- server/: Node.js 20+, TypeScript strict, Fastify + @fastify/websocket, "Groq" package for LLM, dotenv + zod, tsx, vitest. Use the raw "ws" package for Deepgram STT and Deepgram TTS (no vendor SDKs) so I can see the protocol.
- web/: Vite + Vanila js (No framework) , Web Audio API with an AudioWorklet. Use Tailwind CSS.

AUDIO: 16 kHz, mono, 16-bit little-endian PCM in both directions, base64-encoded inside JSON messages. Deepgram STT: encoding=linear16, sample_rate=16000. Deepgram TTS: encoding=linear16, sample_rate=16000.

BROWSER <-> SERVER JSON PROTOCOL (define once in a shared types file, as discriminated unions):
- client to server: start {name, inquiry, mode}, media {payload}, mark {name}, vad {state: "start"|"end"}, ptt {state}, stop
- server to client: media {payload, turnId}, mark {name}, clear {nextTurnId}, duck, resume, transcript {role, text, final}, debug {event, detail, ts}
Every agent turn has an increasing turnId. After a clear, the client must discard any media with a turnId lower than nextTurnId (this prevents stale audio from playing after an interruption).

ARCHITECTURE RULE: CallSession (conversation logic) must talk to a small Transport interface (sendAudio, sendMark, sendClear, sendDuck, sendResume, sendTranscript). The browser WebSocket is one implementation, so a phone provider could be added later without touching the conversation logic.

WORKING RULES:
1. Build ONLY what the current prompt asks. No extra features or future-step code.
2. I am a beginner. Keep files small and single-purpose. Comments explain WHY.
3. After finishing, give me a plain-English walkthrough: what each new file does, how data flows, and any new concept explained simply.
4. Tell me exactly how to verify the step (commands, what I should see).
5. If unsure about an external API's protocol, check the official docs. Never guess message formats.
6. No hardcoded secrets. Keys come from .env.
7. Every un-awaited promise needs a .catch so one failure cannot crash the process.
8. Stop when the step is done and wait for my next prompt.