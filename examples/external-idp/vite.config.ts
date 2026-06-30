import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import visage from '@blakearoberts/visage';

export default defineConfig({
  server: { port: 6174, strictPort: true },
  plugins: [
    react(),
    visage({
      port: 9002,
      idp: {
        issuer: 'http://idp.localhost:5557/idp',
        end_session_endpoint: 'http://idp.localhost:5557/idp/logout',
      },
      oauth2: { clientSecret: null }, // PKCE
      services: {
        whoami: { image: 'traefik/whoami' },

        // Note: the following extra_hosts overrides are only required for this
        // example because the "external" IdP is a container inside docker where
        // nginx needs to reach it without hitting its own loopback interface.
        nginx: { extra_hosts: ['idp.localhost:host-gateway'] },
      },
    }),
  ],
});
