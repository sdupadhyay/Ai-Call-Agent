import Fastify from 'fastify';
import { config } from './config';

// Initialize the Fastify server instance
const server = Fastify({
  logger: true, // Enable built-in logging
});

// Define a simple health check route
// This is useful to verify the server is running
server.get('/health', async (request, reply) => {
  return { status: 'ok' };
});

// Start the server
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
