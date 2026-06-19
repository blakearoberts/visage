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

Playwright global setup first runs real `ensureCerts()` calls with the installed
`mkcert` executable to prepare the local CA and generate TLS material. In CI,
Visage skips trust-store installation by default and Playwright ignores local
HTTPS errors. After that, the simple, SSR, and external-IdP specs run in
parallel with their own app processes and Docker Compose projects. The simple
spec uses the plugin-managed Dex stack, the SSR spec starts Visage through
`createVisageServer()`, and the external IdP spec starts Dex separately from
`examples/external-idp`. From there, Visage serves each app through NGINX.

Child process and container lifecycle output is written to each test's
Playwright output directory as `simple.log`, `ssr.log`, or `external-idp.log`.

## First-Time Setup

Install project dependencies, make sure `mkcert` is available, and install the
Playwright Chromium browser before running the suite on a new machine. On macOS:

```console
brew install mkcert
npm run test:e2e
```

`npm run test:e2e` runs `test:e2e:setup` first through npm's `pretest:e2e`
script, so each run rebuilds `dist` from local source changes and a first run
downloads Chromium automatically before the slower Docker-backed tests begin.
Example-app dependencies are installed by the root workspace install.

Run the suite from the repo root:

```console
npm run test:e2e
```
