# E2E Tests

These Playwright tests run the example apps through the local Visage auth stack:

1. Navigate to the authenticated local URL.
2. Complete the Dex username/password login with the test user.
3. Return to the Vite app.
4. Exercise the app-specific authenticated upstream or SSR identity path.
5. Assert that the rendered output contains authenticated identity data.

## Defaults

- Simple app URL: `VISAGE_E2E_URL` or `https://localhost:9001/`
- External IdP app URL: `https://localhost:9002/`
- SSR app URL: `https://localhost:9003/`
- Direct example ports: simple `6173`, external IdP `6174`, SSR `6175`
- `VISAGE_E2E_EMAIL`: `user@example.com`
- `VISAGE_E2E_PASSWORD`: `pass`

## Runtime

The Playwright setup project first runs real `ensureCerts()` calls to download
`mkcert`, prepare the local CA, and generate TLS material. In CI, Visage skips
trust-store installation by default and Playwright ignores local HTTPS errors.
After that, the simple, SSR, and external-IdP specs run in parallel with their
own app processes and Docker Compose projects. The simple spec uses the
plugin-managed Dex stack, the SSR spec starts Visage through
`createVisageServer()`, and the external IdP spec starts Dex separately from
`examples/external-idp`. From there, Visage serves each app through NGINX.

Child process and container lifecycle output is written to each test's
Playwright output directory as `simple.log`, `ssr.log`, or `external-idp.log`.

Run the suite from the repo root:

```console
npm run test:e2e
```
