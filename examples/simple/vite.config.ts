import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import visage from '@blakearoberts/visage';

export default defineConfig({
  server: { port: 6173, strictPort: true },
  plugins: [
    react(),
    visage({
      services: { whoami: { image: 'traefik/whoami' } },

      // The following cookie settings can be used to test session locking.
      // cookie: { expire: '10s', refresh: '0' },
    }),
  ],
});
