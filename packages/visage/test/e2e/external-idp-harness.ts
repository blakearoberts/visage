import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { createServer as createViteServer, type ViteDevServer } from 'vite';

import {
  appLocationPolicy,
  externalIdpDirectPort,
  externalIdpPort,
  packageEntrySpecifier,
  repo,
} from './harness';
import {
  closeServer,
  createMiddlewareServer,
  listen,
  prefixed,
  type Middleware,
} from './harness-server';

const { createVisageServer } = (await import(
  packageEntrySpecifier()
)) as typeof import('../../src/index');

const example = join(repo, 'examples/external-idp');
const externalDexProject = 'external-idp';

const { server, use } = createMiddlewareServer();
const visage = createVisageServer({
  port: externalIdpPort,
  idp: {
    issuer: 'http://idp.localhost:5557/idp',
    end_session_endpoint: 'http://idp.localhost:5557/idp/logout',
  },
  oauth2: { clientSecret: null },
  services: {
    whoami: { image: 'traefik/whoami' },
    nginx: { extra_hosts: ['idp.localhost:host-gateway'] },
    oauth2_proxy: { extra_hosts: ['idp.localhost:host-gateway'] },
  },
  upstreams: {
    vite: {
      port: externalIdpDirectPort,
      locations: { '/external-idp/': appLocationPolicy },
    },
  },
});

let vite: ViteDevServer | undefined;

try {
  dockerCompose(['down', '--remove-orphans']);
  dockerCompose(['up', '-d']);

  vite = await createViteServer({
    root: example,
    base: '/external-idp/',
    configFile: false,
    appType: 'spa',
    server: { middlewareMode: true, hmr: false, ws: false },
  });

  server.prependListener('upgrade', visage.upgrade);
  use(visage.middleware);
  use(prefixed('/external-idp/', vite.middlewares as Middleware));

  await listen(server, externalIdpDirectPort);
  await visage.listen();
  console.log(`External IdP harness listening on ${externalIdpPort}`);
  await waitForShutdown();
} catch (error) {
  await shutdown();
  throw error;
}

async function waitForShutdown(): Promise<void> {
  await new Promise<void>((resolve) => {
    const handle = () => {
      shutdown().then(resolve, (error: unknown) => {
        console.error(error);
        resolve();
      });
    };
    process.once('SIGINT', handle);
    process.once('SIGTERM', handle);
  });
}

async function shutdown(): Promise<void> {
  visage.close();
  await vite?.close();
  await closeServer(server);
  writeDockerComposeLogs();
  dockerCompose(['down', '--remove-orphans']);
}

function dockerCompose(args: readonly string[]): void {
  const result = spawnSync(
    'docker',
    ['compose', '-p', externalDexProject, '-f', 'compose.idp.yaml', ...args],
    { cwd: example, encoding: 'utf8' },
  );
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error('External IdP Docker Compose failed');
}

function writeDockerComposeLogs(): void {
  const result = spawnSync(
    'docker',
    [
      'compose',
      '-p',
      externalDexProject,
      '-f',
      'compose.idp.yaml',
      'logs',
      '--no-color',
    ],
    { cwd: example, encoding: 'utf8' },
  );
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
}
