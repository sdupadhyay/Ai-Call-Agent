import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { config } from './config';
import {
  ClientMessage,
  ServerMediaMessage,
  ServerMarkMessage,
  ServerClearMessage,
} from './protocol';

// Initialize the Fastify server instance
const server = Fastify({
  logger: true, // Enable built-in request/response logging
});

// Register the WebSocket plugin so Fastify can handle ws:// connections
server.register(websocket);

// Simple health check endpoint
server.get('/health', async () => {
  return { status: 'ok' };
});

/**
 * Generates a single 20 ms PCM chunk of a 440 Hz sine wave sampled at 16,000 Hz.
 * 20 ms at 16 kHz = 320 samples = 640 bytes.
 * 
 * @param startSampleIndex - Global sample index offset for phase continuity
 * @returns Base64-encoded 16-bit PCM little-endian buffer
 */
function generateToneChunkBase64(startSampleIndex: number): string {
  const sampleRate = 16000;
  const frequency = 440; // Musical note A4
  const samplesPerChunk = 320; // 20 ms
  const buffer = Buffer.alloc(samplesPerChunk * 2); // 2 bytes per 16-bit sample

  for (let i = 0; i < samplesPerChunk; i++) {
    const globalSample = startSampleIndex + i;
    // Calculate sine wave sample (-1.0 to 1.0)
    const sinValue = Math.sin((2 * Math.PI * frequency * globalSample) / sampleRate);
    // Scale to comfortable 16-bit volume (amplitude of 16384 out of 32767)
    const int16Value = Math.round(sinValue * 16384);
    buffer.writeInt16LE(int16Value, i * 2);
  }

  return buffer.toString('base64');
}

// WebSocket endpoint for browser audio streaming and control messages
server.register(async function (fastify) {
  fastify.get('/ws', { websocket: true }, (socket, req) => {
    server.log.info('WebSocket client connected to /ws');

    // State tracking for rate-limited media logging
    let mediaChunkCount = 0;
    let lastReportTime = Date.now();

    // Timer handle for debug test tone streaming
    let testToneTimer: NodeJS.Timeout | null = null;

    const stopTestTone = () => {
      if (testToneTimer) {
        clearInterval(testToneTimer);
        testToneTimer = null;
      }
    };

    socket.on('message', (rawData: Buffer | string) => {
      try {
        const message = JSON.parse(rawData.toString()) as ClientMessage;

        switch (message.type) {
          case 'start':
            server.log.info(
              {
                name: message.name,
                inquiry: message.inquiry,
                mode: message.mode,
              },
              'Received "start" message from client'
            );
            break;

          case 'media': {
            mediaChunkCount++;
            const now = Date.now();
            const elapsed = now - lastReportTime;

            // Log media throughput approximately once every second
            if (elapsed >= 1000) {
              const secondsOfAudio = (mediaChunkCount * 0.02).toFixed(2);
              server.log.info(
                `Received ${mediaChunkCount} media chunks (~${secondsOfAudio}s audio) in the last ${(elapsed / 1000).toFixed(2)}s`
              );
              mediaChunkCount = 0;
              lastReportTime = now;
            }
            break;
          }

          case 'mark':
            server.log.info({ markName: message.name }, 'Client acknowledged mark playback completion');
            break;

          case 'stop':
            server.log.info('Received "stop" message from client');
            stopTestTone();
            break;

          case 'debug': {
            // for generating test audio
            if (message.action === 'test_tone') {
              server.log.info('Received debug "test_tone" request. Streaming 3s 440Hz tone with turnId=1...');
              stopTestTone();

              const totalChunks = 150; // 150 chunks * 20 ms = 3,000 ms (3 seconds)
              let chunkIndex = 0;

              testToneTimer = setInterval(() => {
                // If finished or socket closed, cleanup and send trailing mark
                if (chunkIndex >= totalChunks || socket.readyState !== 1) {
                  stopTestTone();
                  if (socket.readyState === 1) {
                    const markMsg: ServerMarkMessage = {
                      type: 'mark',
                      name: 'test_tone_completed',
                    };
                    socket.send(JSON.stringify(markMsg));
                    server.log.info('Finished streaming test tone chunks. Emitted mark: "test_tone_completed".');
                  }
                  return;
                }

                // Generate phase-continuous 20 ms tone chunk
                const payload = generateToneChunkBase64(chunkIndex * 320);
                const mediaMsg: ServerMediaMessage = {
                  type: 'media',
                  payload,
                  turnId: 1,
                };
                socket.send(JSON.stringify(mediaMsg));
                chunkIndex++;
              }, 20);
            } else if (message.action === 'request_clear') {
              server.log.info('Received debug "request_clear" request. Stopping tone and sending clear nextTurnId=2.');
              stopTestTone();

              const clearMsg: ServerClearMessage = {
                type: 'clear',
                nextTurnId: 2,
              };
              socket.send(JSON.stringify(clearMsg));
            }
            break;
          }

          default:
            server.log.info({ type: (message as { type: string }).type }, 'Received other message');
            break;
        }
      } catch (err) {
        server.log.error(err, 'Failed to parse incoming WebSocket JSON message');
      }
    });

    socket.on('close', (code: number, reason: Buffer) => {
      stopTestTone();
      server.log.info({ code, reason: reason?.toString() }, 'WebSocket client disconnected');
    });

    socket.on('error', (err: Error) => {
      stopTestTone();
      server.log.error(err, 'WebSocket client error');
    });
  });
});

// Start listening on configured port
const start = async () => {
  try {
    await server.listen({ port: config.PORT, host: '0.0.0.0' });
    console.log(`Server listening on port ${config.PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
