import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createAuthorizationServer } from '@blakearoberts/visage-authorization';
import { createVisageServer } from '@blakearoberts/visage';
import connect from 'connect';
import { generateKeyPair } from 'jose';
import { createServer as createViteServer, type ViteDevServer } from 'vite';

import { createResourceAPI, type UserResource } from './resource';
import type { AuthorizationData } from './src/App';

const AppPort = 6177;
const VisagePort = 9005;
const ClientID = 'web-app';
const ClientSecret = 'web-app-secret';
const Resource = 'urn:visage:example:user-api';
const AuthorizationIssuer = `https://localhost:${VisagePort}/authorization`;
const SubjectIssuer = `https://localhost:${VisagePort}/dex`;
const RequestedScopes = ['user.read', 'user.write'] as const;
const TokenExchangeGrantType =
  'urn:ietf:params:oauth:grant-type:token-exchange';
const AccessTokenType = 'urn:ietf:params:oauth:token-type:access_token';

const signingKey = await generateKeyPair('RS256', { extractable: true });
const authorization = await createAuthorizationServer({
  issuer: AuthorizationIssuer,
  signingKey: signingKey.privateKey,
  signingKeyId: 'example-ephemeral-key',
  subjectIssuer: {
    issuer: SubjectIssuer,
    jwksURL: `${SubjectIssuer}/keys`,
  },
  clients: { [ClientID]: { secret: ClientSecret } },
  policyURL: `https://localhost:${VisagePort}/opa/v1/data/visage/authorization/exchange`,
});
const resource = createResourceAPI({
  issuer: AuthorizationIssuer,
  jwksURL: `${AuthorizationIssuer}/jwks`,
  audience: Resource,
  clientId: ClientID,
});

const app = connect();
const server = app.listen(AppPort, '127.0.0.1');
const policyDirectory = resolve(import.meta.dirname, 'policy');
const visage = createVisageServer({
  port: VisagePort,
  oauth2: {
    clientId: ClientID,
    clientSecret: ClientSecret,
    scopes: ['openid', 'email'],
  },
  services: {
    opa: {
      image: 'openpolicyagent/opa:1.19.0',
      command: [
        'run',
        '--server',
        '--addr=0.0.0.0:8181',
        '/policy/policy.rego',
        '/policy/data.yaml',
      ],
      volumes: [`${policyDirectory}:/policy:ro`],
      upstream: {
        port: 8181,
        locations: {
          '= /opa/v1/data/visage/authorization/exchange': {
            auth: { enabled: false },
            csrf: false,
            directives: { rewrite: '^/opa/(.*)$ /$1 break' },
          },
        },
      },
    },
  },
  upstreams: {
    vite: {
      port: AppPort,
      locations: {
        '/': { auth: { forward: 'access' } },
        '= /.well-known/oauth-authorization-server/authorization': {
          auth: { enabled: false },
          csrf: false,
        },
        '= /authorization/token': {
          auth: { enabled: false },
          csrf: false,
          headers: { Authorization: '$http_authorization' },
        },
        '= /authorization/jwks': {
          auth: { enabled: false },
          csrf: false,
        },
        '= /resource/user': {
          auth: { enabled: false },
          csrf: false,
          headers: { Authorization: '$http_authorization' },
        },
      },
    },
  },
});
app.use(visage.middleware);
server.prependListener('upgrade', visage.upgrade);
await visage.listen();

app.use((request, response, next) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (
    path === '/authorization/token' ||
    path === '/authorization/jwks' ||
    path === '/.well-known/oauth-authorization-server/authorization'
  ) {
    authorization(request, response);
    return;
  }
  if (path === '/resource/user') {
    resource(request, response);
    return;
  }
  next();
});

const vite = await createViteServer({
  server: { middlewareMode: true, ws: { server } },
  appType: 'custom',
});
app.use(vite.middlewares);
app.use(ssrHandler(vite));

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

async function shutdown(): Promise<void> {
  await vite.close();
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  visage.close();
  process.exit(0);
}

function ssrHandler(viteServer: ViteDevServer): connect.SimpleHandleFunction {
  return async function ssr(request, response) {
    try {
      const subjectToken = readForwardedAccessToken(request);
      const exchange = await exchangeToken(subjectToken);
      const user = await readUserResource(exchange.access_token);
      const data = {
        requestedScopes: RequestedScopes,
        grantedScopes: exchange.scope.split(' '),
        user: user.user,
        delegation: {
          audience: user.delegation.audience,
          actor: user.delegation.actor,
          clientId: user.delegation.clientId,
        },
      } satisfies AuthorizationData;

      type Module = typeof import('./src/entry-server');
      const { render } = (await viteServer.ssrLoadModule(
        '/src/entry-server.tsx',
      )) as Module;
      const template = await readFile(
        new URL('index.html', import.meta.url),
        'utf8',
      );
      const html = (
        await viteServer.transformIndexHtml(request.url ?? '/', template)
      )
        .replace(
          '<!--ssr-authorization-data-->',
          JSON.stringify(data).replace(/</g, '\\u003c'),
        )
        .replace('<!--ssr-outlet-->', render(data));

      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(html);
    } catch (error) {
      if (error instanceof Error) viteServer.ssrFixStacktrace(error);
      response.writeHead(500, { 'Content-Type': 'text/plain' });
      response.end('Authorization example failed');
    }
  };
}

function readForwardedAccessToken(request: connect.IncomingMessage): string {
  const authorizationHeader = request.headers.authorization;
  if (
    typeof authorizationHeader !== 'string' ||
    !authorizationHeader.startsWith('Bearer ') ||
    authorizationHeader.length === 7
  ) {
    throw new Error('Missing forwarded access token');
  }
  return authorizationHeader.slice(7);
}

async function exchangeToken(subjectToken: string): Promise<ExchangeResponse> {
  const response = await fetch(`${AuthorizationIssuer}/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${ClientID}:${ClientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: TokenExchangeGrantType,
      subject_token: subjectToken,
      subject_token_type: AccessTokenType,
      requested_token_type: AccessTokenType,
      resource: Resource,
      scope: RequestedScopes.join(' '),
    }),
  });
  if (!response.ok)
    throw new Error(`Token exchange failed: ${response.status}`);
  return (await response.json()) as ExchangeResponse;
}

async function readUserResource(accessToken: string): Promise<UserResource> {
  const response = await fetch(
    `https://localhost:${VisagePort}/resource/user`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!response.ok)
    throw new Error(`Resource request failed: ${response.status}`);
  return (await response.json()) as UserResource;
}

type ExchangeResponse = {
  readonly access_token: string;
  readonly scope: string;
};
