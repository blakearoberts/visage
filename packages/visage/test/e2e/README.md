# E2E Tests

These Playwright tests run the example apps through the local Visage auth stack:

1. Navigate to the authenticated local URL.
2. Complete the Dex username/password login with the test user.
3. Return to the Vite app.
4. Exercise the app-specific authenticated upstream or SSR identity path.
5. Assert that the rendered output contains authenticated identity data.

## Defaults

- Simple app URL: `https://localhost:9001/simple/`
- SSR app URL: `https://localhost:9001/ssr/`
- External IdP app URL: `https://localhost:9002/external-idp/`
- Direct app ports: managed Dex examples `6173`, external IdP `6174`
- Test logins: simple `simple@example.com` / `pass`, SSR `ssr@example.com` /
  `pass`, external IdP `user@example.com` / `pass`

## Runtime

Playwright global setup starts stable suite-level harness processes before the
browser tests run. One managed-Dex Visage edge serves the simple and SSR apps on
route prefixes, while the external-IdP scenario uses a separate Visage edge
because each edge has one IdP configuration. Once those routes are ready, the
specs run in parallel without owning app-process or Docker Compose lifecycle.

Harness logs, Visage Compose output, generated TLS material, and the runtime URL
manifest are written under `test-results/e2e-harness`.

CI points `VISAGE_E2E_PACKAGE_ENTRY` at the `npm pack` artifact extracted from
the CI job, so e2e validates the packed package. Local runs omit that variable
and use the workspace package build created by `pretest:e2e`.

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
