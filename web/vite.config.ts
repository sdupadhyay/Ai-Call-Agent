import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// Read the server port from server/.env dynamically using built-in node:fs
function getServerPort(): string {
  try {
    const envPath = path.resolve(__dirname, '../server/.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      const match = content.match(/^PORT=(\d+)/m);
      if (match && match[1]) {
        return match[1];
      }
    }
  } catch {
    // Fallback to default port if file cannot be read
  }
  return '3001';
}

const serverPort = getServerPort();

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/ws': {
        // Use 127.0.0.1 instead of localhost to avoid IPv6 resolution issues on macOS
        target: `ws://127.0.0.1:${serverPort}`,
        ws: true,
        rewriteWsOrigin: true,
      },
    },
  },
});
