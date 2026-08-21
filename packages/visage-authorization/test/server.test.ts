import assert from 'node:assert/strict';
import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server,
} from 'node:http';
import { after, before, test } from 'node:test';

import {
  exportJWK,
  generateKeyPair,
  jwtVerify,
  SignJWT,
  type JWTPayload,
} from 'jose';

import { createAuthorizationServer } from '../src/index';

const ClientID = 'web-app';
const ClientSecret = 'client-secret';
const Resource = 'urn:visage:test:user-api';
const SubjectIssuer = 'https://subject.example/dex';
const TokenExchangeGrantType =
  'urn:ietf:params:oauth:grant-type:token-exchange';
const AccessTokenType = 'urn:ietf:params:oauth:token-type:access_token';

let authorizationServer: Server;
let authorizationHandler: RequestListener;
let authorizationIssuer: string;
let policyServer: Server;
let policyURL: string;
let subjectKeysServer: Server;
let subjectKeysURL: string;
let subjectPrivateKey: CryptoKey;
let alternatePrivateKey: CryptoKey;
let issuedPublicKey: CryptoKey;
let lastPolicyInput: unknown;
let policy: PolicyMode = { type: 'allow', scopes: ['user.read'] };

type PolicyMode =
  | { readonly type: 'allow'; readonly scopes: readonly string[] }
  | { readonly type: 'deny' }
  | { readonly type: 'malformed' }
  | { readonly type: 'status' }
  | { readonly type: 'unavailable' }
  | { readonly type: 'timeout' };

type TokenResponse = {
  readonly access_token: string;
  readonly expires_in: number;
  readonly issued_token_type: string;
  readonly scope: string;
  readonly token_type: string;
};

type ErrorResponse = {
  readonly error: string;
  readonly error_description: string;
};

before(async () => {
  const subjectKeyPair = await generateKeyPair('RS256', { extractable: true });
  subjectPrivateKey = subjectKeyPair.privateKey;
  const subjectPublicJWK = await exportJWK(subjectKeyPair.publicKey);
  subjectKeysServer = createServer((_request, response) => {
    writeJSON(response, {
      keys: [
        {
          ...subjectPublicJWK,
          alg: 'RS256',
          kid: 'subject-key',
          use: 'sig',
        },
      ],
    });
  });
  subjectKeysURL = await listen(subjectKeysServer, '/keys');

  const alternateKeyPair = await generateKeyPair('RS256');
  alternatePrivateKey = alternateKeyPair.privateKey;

  policyServer = createServer(async (request, response) => {
    lastPolicyInput = JSON.parse(await readBody(request));
    switch (policy.type) {
      case 'allow':
        writeJSON(response, {
          result: { allow: true, scopes: policy.scopes },
        });
        break;
      case 'deny':
        writeJSON(response, { result: { allow: false, scopes: [] } });
        break;
      case 'malformed':
        writeJSON(response, { result: { allow: true } });
        break;
      case 'status':
        response.writeHead(500).end();
        break;
      case 'unavailable':
        request.socket.destroy();
        break;
      case 'timeout':
        setTimeout(() => response.end(), 3_000);
        break;
    }
  });
  policyURL = await listen(policyServer, '/policy');

  authorizationServer = createServer((request, response) =>
    authorizationHandler(request, response),
  );
  const authorizationOrigin = await listen(authorizationServer);
  authorizationIssuer = `${authorizationOrigin}/authorization`;
  const authorizationKeyPair = await generateKeyPair('RS256', {
    extractable: true,
  });
  issuedPublicKey = authorizationKeyPair.publicKey;
  authorizationHandler = await createAuthorizationServer({
    issuer: authorizationIssuer,
    signingKey: authorizationKeyPair.privateKey,
    signingKeyId: 'authorization-key',
    subjectIssuer: { issuer: SubjectIssuer, jwksURL: subjectKeysURL },
    clients: { [ClientID]: { secret: ClientSecret } },
    policyURL,
    accessTokenTTLSeconds: 300,
  });
});

after(async () => {
  await Promise.all([
    close(authorizationServer),
    close(policyServer),
    close(subjectKeysServer),
  ]);
});

test('serves authorization metadata and a public JWKS', async () => {
  const metadataResponse = await fetch(
    authorizationIssuer.replace(
      '/authorization',
      '/.well-known/oauth-authorization-server/authorization',
    ),
  );
  assert.equal(metadataResponse.status, 200);
  assert.deepEqual(await metadataResponse.json(), {
    issuer: authorizationIssuer,
    token_endpoint: `${authorizationIssuer}/token`,
    jwks_uri: `${authorizationIssuer}/jwks`,
    grant_types_supported: [TokenExchangeGrantType],
    token_endpoint_auth_methods_supported: ['client_secret_basic'],
  });

  const jwksResponse = await fetch(`${authorizationIssuer}/jwks`);
  assert.equal(jwksResponse.status, 200);
  assert.deepEqual(await jwksResponse.json(), {
    keys: [
      {
        ...(await exportJWK(issuedPublicKey)),
        alg: 'RS256',
        kid: 'authorization-key',
        use: 'sig',
      },
    ],
  });
});

test('exchanges and attenuates a verified subject access token', async () => {
  policy = { type: 'allow', scopes: ['user.read'] };
  const subjectToken = await signSubjectToken({
    email: 'user@example.com',
    email_verified: true,
    groups: ['users'],
    name: 'Visage User',
    preferred_username: 'user',
    private_claim: 'must-not-be-minted',
  });
  const response = await tokenRequest({
    subjectToken,
    scopes: ['user.read', 'user.write'],
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = (await response.json()) as TokenResponse;
  assert.equal(body.issued_token_type, AccessTokenType);
  assert.equal(body.token_type, 'Bearer');
  assert.equal(body.scope, 'user.read');
  assert.equal(body.expires_in, 300);

  const { payload, protectedHeader } = await jwtVerify(
    body.access_token,
    issuedPublicKey,
    {
      algorithms: ['RS256'],
      audience: Resource,
      issuer: authorizationIssuer,
      typ: 'at+jwt',
    },
  );
  assert.equal(protectedHeader.alg, 'RS256');
  assert.equal(protectedHeader.kid, 'authorization-key');
  assert.equal(payload.sub, 'subject');
  assert.equal(payload.client_id, ClientID);
  assert.equal(payload.scope, 'user.read');
  assert.deepEqual(payload.act, { sub: ClientID });
  assert.equal(payload.email, 'user@example.com');
  assert.equal(payload.email_verified, true);
  assert.equal(payload.name, 'Visage User');
  assert.equal(typeof payload.jti, 'string');
  assert.equal(payload.exp! - payload.iat!, 300);
  assert.deepEqual(Object.keys(payload).sort(), [
    'act',
    'aud',
    'client_id',
    'email',
    'email_verified',
    'exp',
    'iat',
    'iss',
    'jti',
    'name',
    'scope',
    'sub',
  ]);

  assert.deepEqual(lastPolicyInput, {
    input: {
      subject: {
        aud: ClientID,
        email: 'user@example.com',
        email_verified: true,
        exp: assertNumber(subjectToken, 'exp'),
        groups: ['users'],
        iat: assertNumber(subjectToken, 'iat'),
        iss: SubjectIssuer,
        name: 'Visage User',
        preferred_username: 'user',
        private_claim: 'must-not-be-minted',
        sub: 'subject',
      },
      client: { id: ClientID },
      request: {
        resource: Resource,
        scopes: ['user.read', 'user.write'],
      },
    },
  });
  assert.equal(JSON.stringify(lastPolicyInput).includes(subjectToken), false);
  assert.equal(JSON.stringify(lastPolicyInput).includes(ClientSecret), false);
});

test('requires valid client_secret_basic credentials', async () => {
  const response = await tokenRequest({
    authorization: null,
    init: { headers: { 'Content-Type': 'application/json' } },
  });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('www-authenticate'), 'Basic realm="token"');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), {
    error: 'invalid_client',
    error_description: 'Invalid client credentials',
  });
});

test('accepts an omitted requested_token_type', async () => {
  policy = { type: 'allow', scopes: ['user.read'] };
  const response = await tokenRequest({ includeRequestedTokenType: false });
  assert.equal(response.status, 200);
  assert.equal(
    ((await response.json()) as TokenResponse).issued_token_type,
    AccessTokenType,
  );
});

test('rejects an incorrect client secret', async () => {
  const response = await tokenRequest({
    authorization: `Basic ${Buffer.from(`${ClientID}:wrong`).toString('base64')}`,
  });
  assert.equal(response.status, 401);
  assert.equal(
    ((await response.json()) as ErrorResponse).error,
    'invalid_client',
  );
});

test('rejects invalid token-exchange request parameters', async (t) => {
  const subjectToken = await signSubjectToken();
  const cases: readonly {
    readonly name: string;
    readonly form?: Readonly<Record<string, string>>;
    readonly init?: RequestInit;
    readonly duplicateResource?: boolean;
    readonly scopes?: readonly string[];
    readonly error: string;
  }[] = [
    {
      name: 'content type',
      init: { headers: { 'Content-Type': 'application/json' } },
      error: 'invalid_request',
    },
    {
      name: 'grant type',
      form: { grant_type: 'authorization_code' },
      error: 'unsupported_grant_type',
    },
    {
      name: 'subject token type',
      form: { subject_token_type: 'urn:example:unsupported' },
      error: 'invalid_request',
    },
    {
      name: 'requested token type',
      form: { requested_token_type: 'urn:example:unsupported' },
      error: 'invalid_request',
    },
    {
      name: 'empty requested token type',
      form: { requested_token_type: '' },
      error: 'invalid_request',
    },
    {
      name: 'resource',
      form: { resource: 'relative' },
      error: 'invalid_target',
    },
    {
      name: 'multiple resources',
      duplicateResource: true,
      error: 'invalid_request',
    },
    {
      name: 'scope',
      form: { scope: 'user.read  user.write' },
      error: 'invalid_scope',
    },
    {
      name: 'required scope',
      scopes: [],
      error: 'invalid_request',
    },
    {
      name: 'unsupported parameter',
      form: { audience: Resource },
      error: 'invalid_request',
    },
  ];
  for (const current of cases) {
    await t.test(current.name, async () => {
      const response = await tokenRequest({
        subjectToken,
        form: current.form,
        init: current.init,
        duplicateResource: current.duplicateResource,
        scopes: current.scopes,
      });
      assert.equal(response.status, 400);
      assert.equal(
        ((await response.json()) as ErrorResponse).error,
        current.error,
      );
    });
  }
});

test('rejects invalid subject tokens before querying policy', async (t) => {
  const cases = [
    {
      name: 'signature',
      token: await signSubjectToken({}, alternatePrivateKey),
    },
    {
      name: 'issuer',
      token: await signSubjectToken({ iss: 'https://other.example' }),
    },
    {
      name: 'audience',
      token: await signSubjectToken({ aud: 'other-client' }),
    },
    {
      name: 'multiple audiences',
      token: await signSubjectToken({ aud: [ClientID, 'other-client'] }),
    },
    {
      name: 'expiry',
      token: await signSubjectToken({
        exp: Math.floor(Date.now() / 1_000) - 1,
      }),
    },
  ];
  for (const current of cases) {
    await t.test(current.name, async () => {
      lastPolicyInput = undefined;
      const response = await tokenRequest({ subjectToken: current.token });
      assert.equal(response.status, 400);
      assert.equal(
        ((await response.json()) as ErrorResponse).error,
        'invalid_request',
      );
      assert.equal(lastPolicyInput, undefined);
    });
  }
});

test('fails closed on denied and invalid policy decisions', async (t) => {
  const cases = [
    { name: 'denied', mode: { type: 'deny' }, error: 'invalid_target' },
    { name: 'malformed', mode: { type: 'malformed' }, error: 'server_error' },
    { name: 'status', mode: { type: 'status' }, error: 'server_error' },
    {
      name: 'unavailable',
      mode: { type: 'unavailable' },
      error: 'server_error',
    },
    { name: 'timeout', mode: { type: 'timeout' }, error: 'server_error' },
  ] as const;
  const subjectToken = await signSubjectToken();
  for (const current of cases) {
    await t.test(current.name, async () => {
      policy = current.mode;
      const response = await tokenRequest({ subjectToken });
      assert.equal(
        ((await response.json()) as ErrorResponse).error,
        current.error,
      );
      assert.equal(
        response.status,
        current.error === 'server_error' ? 500 : 400,
      );
    });
  }
});

test('rejects an allow decision that grants no requested scope', async () => {
  policy = { type: 'allow', scopes: ['other.read'] };
  const response = await tokenRequest({
    subjectToken: await signSubjectToken(),
  });
  assert.equal(response.status, 400);
  assert.equal(
    ((await response.json()) as ErrorResponse).error,
    'invalid_scope',
  );
});

test('caps an issued token at the subject token expiry', async () => {
  policy = { type: 'allow', scopes: ['user.read'] };
  const now = Math.floor(Date.now() / 1_000);
  const response = await tokenRequest({
    subjectToken: await signSubjectToken({ exp: now + 30 }),
  });
  const body = (await response.json()) as TokenResponse;
  assert.ok(body.expires_in <= 30);
  assert.ok(body.expires_in > 0);
  const { payload } = await jwtVerify(body.access_token, issuedPublicKey, {
    audience: Resource,
    issuer: authorizationIssuer,
    typ: 'at+jwt',
  });
  assert.equal(payload.exp, now + 30);
});

async function signSubjectToken(
  claims: JWTPayload = {},
  privateKey = subjectPrivateKey,
): Promise<string> {
  const now = Math.floor(Date.now() / 1_000);
  const registeredClaims = new Set(['iss', 'sub', 'aud', 'iat', 'exp']);
  const token = new SignJWT(
    Object.fromEntries(
      Object.entries(claims).filter(([name]) => !registeredClaims.has(name)),
    ),
  )
    .setProtectedHeader({ alg: 'RS256', kid: 'subject-key' })
    .setIssuer((claims.iss as string | undefined) ?? SubjectIssuer)
    .setSubject((claims.sub as string | undefined) ?? 'subject')
    .setAudience(claims.aud ?? ClientID)
    .setIssuedAt((claims.iat as number | undefined) ?? now)
    .setExpirationTime((claims.exp as number | undefined) ?? now + 600);
  return token.sign(privateKey);
}

async function tokenRequest({
  authorization = basicAuthorization(),
  duplicateResource = false,
  includeRequestedTokenType = true,
  subjectToken,
  scopes = ['user.read'],
  form = {},
  init = {},
}: {
  readonly authorization?: string | null;
  readonly duplicateResource?: boolean;
  readonly includeRequestedTokenType?: boolean;
  readonly subjectToken?: string;
  readonly scopes?: readonly string[];
  readonly form?: Readonly<Record<string, string>>;
  readonly init?: RequestInit;
} = {}): Promise<Response> {
  const values = new URLSearchParams({
    grant_type: TokenExchangeGrantType,
    subject_token: subjectToken ?? (await signSubjectToken()),
    subject_token_type: AccessTokenType,
    ...(includeRequestedTokenType
      ? { requested_token_type: AccessTokenType }
      : {}),
    resource: Resource,
    scope: scopes.join(' '),
    ...form,
  });
  if (duplicateResource) values.append('resource', Resource);
  return fetch(`${authorizationIssuer}/token`, {
    ...init,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(authorization === null ? {} : { Authorization: authorization }),
      ...init.headers,
    },
    body: values,
  });
}

function basicAuthorization(): string {
  return `Basic ${Buffer.from(`${ClientID}:${ClientSecret}`).toString('base64')}`;
}

async function listen(server: Server, path = ''): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing port');
  return `http://127.0.0.1:${address.port}${path}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function writeJSON(response: import('node:http').ServerResponse, body: object) {
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(body));
}

function assertNumber(token: string, claim: string): number {
  const payload = JSON.parse(
    Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8'),
  );
  assert.equal(typeof payload[claim], 'number');
  return payload[claim];
}
