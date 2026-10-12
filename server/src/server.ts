import Fastify from 'fastify';
import { config } from './config';

// Initialize the Fastify server instance
const server = Fastify({
  logger: true, // Enable built-in request/response logging
});

// Define health check endpoint
server.get('/health', async () => {
  return { status: 'ok' };
});

// Start the HTTP server listening on configured port
const start = async () => {
  try {
    await server.listen({ port: config.PORT, host: '0.0.0.0' });
    console.log(`Server listening on port ${config.PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
