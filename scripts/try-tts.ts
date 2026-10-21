import { DeepgramTts } from '../server/src/tts';

async function main() {
  console.log('--- Testing Deepgram Aura Streaming TTS ---');
  console.log('Connecting to Deepgram TTS WebSocket (wss://api.deepgram.com/v1/speak)...\n');

  const tts = new DeepgramTts();

  const startTime = Date.now();
  await tts.start();
  const connectedTime = Date.now() - startTime;
  console.log(`[+${connectedTime}ms] WebSocket connected!`);

  const testText = 'Hello! This is a real-time text to speech test using Deepgram Aura and raw WebSockets.';
  console.log(`Sending text: "${testText}"\n`);

  tts.sendText(testText);
  tts.finish();

  let firstChunkTime: number | null = null;
  let chunkCount = 0;
  let totalBytes = 0;

  for await (const base64Chunk of tts.audio()) {
    chunkCount++;
    const now = Date.now() - startTime;

    if (firstChunkTime === null) {
      firstChunkTime = now;
      console.log(`[+${now}ms] >> FIRST AUDIO CHUNK RECEIVED (Time to First Audio: ${firstChunkTime}ms) <<`);
    }

    const chunkBytes = Buffer.from(base64Chunk, 'base64').byteLength;
    totalBytes += chunkBytes;

    console.log(`[+${now}ms] Received chunk #${chunkCount} (${chunkBytes} bytes)`);
  }

  const totalTime = Date.now() - startTime;
  // 16,000 samples/sec * 2 bytes/sample (16-bit) = 32,000 bytes per second of audio
  const audioDurationSec = (totalBytes / 32000).toFixed(2);

  console.log('\n--- TTS Summary ---');
  console.log(`Time to First Audio (TTFA): ${firstChunkTime}ms`);
  console.log(`Total audio chunks:         ${chunkCount}`);
  console.log(`Total audio payload:        ${totalBytes} bytes (~${audioDurationSec}s of 16kHz PCM audio)`);
  console.log(`Total completion time:      ${totalTime}ms`);
}

main().catch((err: unknown) => {
  console.error('\nError during TTS test:', (err as Error).message);
  process.exit(1);
});
