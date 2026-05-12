import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import visage from '@blakearoberts/visage';

export default defineConfig({
  plugins: [
    react(),
    visage({
      services: { whoami: { image: 'traefik/whoami' } },
      upstreams: {
        whoami: { host: 'whoami', port: 80, locations: { '/whoami/': {} } },
      },
    }),
  ],
});
