import { defineConfig } from 'vite';

// Vite configuration
// Configures dev server and proxies WebSocket connections on /ws to the backend Fastify server
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
        rewriteWsOrigin: true,
      },
    },
  },
});
