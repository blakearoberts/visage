# Visage authorization example

This example demonstrates delegated authorization without forwarding one bearer
token through every service:

1. Visage's oauth2-proxy authenticates with managed Dex and forwards Dex's JWT
   access token to the protected Vite SSR route.
2. The SSR server authenticates as `web-app` and exchanges that token at the
   `@blakearoberts/visage-authorization` RFC 8693 token endpoint.
3. The authorization server verifies Dex's token and asks the managed OPA
   service to authorize `user.read user.write` for the user API.
4. OPA attenuates the grant to `user.read`.
5. The resource API independently verifies the Visage-issued RFC 9068 access
   token before returning user and delegation data to SSR.

Run the example from the repository root:

```sh
npm run dev --workspace examples/authorization
```

Then open `https://localhost:9005` and sign in as `user@example.com` with
password `pass`. The example uses an ephemeral authorization signing key; a
production deployment must supply a persistent protected key and HTTPS.
