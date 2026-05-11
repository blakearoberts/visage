import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import visage from '@blakearoberts/visage';

export default defineConfig({
  plugins: [
    react(),
    visage({
      host: 'localhost',
      port: 9002,
      idp: {
        kind: 'external',
        path: '/idp',
        upstream: 'idp',
      },
      oauth2: {
        clientId: 'visage-external-idp',
        clientSecret: null,
        scopes: ['openid', 'email', 'profile', 'offline_access'],
      },
      services: { whoami: { image: 'traefik/whoami' } },
      upstreams: {
        idp: {
          host: 'host.docker.internal',
          port: 5557,
          locations: { '/idp/': { auth: { enabled: false } } },
        },
        whoami: {
          host: 'whoami',
          port: 80,
          locations: { '/whoami/': {} },
        },
      },
    }),
  ],
});
