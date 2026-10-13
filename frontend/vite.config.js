import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Backend origin for the dev proxy. When it is unreachable (backend not
// started yet, restarting, or crashed) the default proxy answers a bare
// HTTP 500 that looks like an application bug. Answer an explicit 503 JSON
// instead so the UI can show the real cause.
const BACKEND = 'http://localhost:5000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,

    // Cloudflare QUICK tunnels (trycloudflare.com) mint a NEW random hostname
    // on every restart (e.g. gave-reactions-juan-strips-…), so pinning one
    // exact hostname goes stale immediately and Vite answers "Blocked request"
    // (or the tunnel reports 530) for the new URL. The dot-prefix form allows
    // any *.trycloudflare.com tunnel hostname; plain hosts stay blocked.
    allowedHosts: [
      'para-tent-muze-raising.trycloudflare.com',
      '.trycloudflare.com',
    ],

    proxy: {
      '/api': {
        target: BACKEND,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            if (res && !res.headersSent && typeof res.writeHead === 'function') {
              res.writeHead(503, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                success: false,
                message: 'Backend API is not reachable on port 5000. Start it with: cd backend && npm run dev',
              }));
            }
          });
        },
      },
      '/uploads': BACKEND,
    },
  },
});