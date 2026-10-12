import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { config } from './config';
import { ClientMessage } from './protocol';

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

// WebSocket endpoint for browser audio streaming and control messages
server.register(async function (fastify) {
  fastify.get('/ws', { websocket: true }, (socket, req) => {
    server.log.info('WebSocket client connected to /ws');

    // State tracking for rate-limited media logging
    // Instead of logging 50 times per second, we aggregate stats once per second
    let mediaChunkCount = 0;
    let lastReportTime = Date.now();

    socket.on('message', (rawData: Buffer | string) => {
      try {
        const message = JSON.parse(rawData.toString()) as ClientMessage;

        switch (message.type) {
          case 'start':
            // Log session parameters sent by the client
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

          case 'stop':
            server.log.info('Received "stop" message from client');
            break;

          default:
            server.log.info({ type: (message as { type: string }).type }, 'Received other message');
            break;
        }
      } catch (err) {
        server.log.error(err, 'Failed to parse incoming WebSocket JSON message');
      }
    });

    socket.on('close', (code: number, reason: Buffer) => {
      server.log.info({ code, reason: reason?.toString() }, 'WebSocket client disconnected');
    });

    socket.on('error', (err: Error) => {
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
