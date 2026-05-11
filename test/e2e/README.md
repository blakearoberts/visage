# E2E Tests

These Playwright tests run the example Vite app through the local Visage auth
stack:

1. Navigate to the authenticated local URL.
2. Complete the Dex username/password login with the test user.
3. Return to the Vite app.
4. Click the `Who are you?` button.
5. Assert that the rendered JSON contains the authenticated `/whoami/` response.

## Defaults

- `VISAGE_E2E_URL`: `https://localhost:9001/`
- `VISAGE_E2E_EMAIL`: `user@example.com`
- `VISAGE_E2E_PASSWORD`: `pass`

## Runtime

The Playwright setup project first runs one real `ensureCerts()` call to
download `mkcert`, install the local CA, and generate TLS material. After that,
the managed-service and external-IdP specs run in parallel with their own Vite
processes and Docker Compose projects. The managed service spec uses the
plugin-managed Dex stack, while the external IdP spec starts Dex separately from
`examples/external-idp`. From there, the Visage plugin starts the app auth stack
and serves the app through NGINX.

Child process and container lifecycle output is written to each test's
Playwright output directory as `managed-service.log` or `external-idp.log`.

Run the suite from the repo root:

```console
npm run test:e2e
```
