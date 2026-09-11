import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, test } from 'node:test';

import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';

import { createResourceAPI, type UserResource } from '../resource';

const Issuer = 'https://authorization.example';
const Audience = 'urn:visage:example:user-api';
const ClientID = 'web-app';

let privateKey: CryptoKey;
let alternatePrivateKey: CryptoKey;
let jwksServer: Server;
let resourceServer: Server;
let resourceURL: string;

before(async () => {
  const keyPair = await generateKeyPair('RS256', { extractable: true });
  privateKey = keyPair.privateKey;
  const publicJWK = await exportJWK(keyPair.publicKey);
  const alternateKeyPair = await generateKeyPair('RS256');
  alternatePrivateKey = alternateKeyPair.privateKey;

  jwksServer = createServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify({
        keys: [
          {
            ...publicJWK,
            alg: 'RS256',
            kid: 'resource-test-key',
            use: 'sig',
          },
        ],
      }),
    );
  });
  const jwksURL = `${await listen(jwksServer)}/jwks`;
  resourceServer = createServer(
    createResourceAPI({
      issuer: Issuer,
      jwksURL,
      audience: Audience,
      clientId: ClientID,
    }),
  );
  resourceURL = `${await listen(resourceServer)}/resource/user`;
});

after(async () => {
  await Promise.all([close(resourceServer), close(jwksServer)]);
});

test('returns user data and verified delegation details', async () => {
  const response = await requestResource(await signAccessToken());
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()) as UserResource, {
    user: {
      subject: 'user-subject',
      email: 'user@example.com',
      name: 'Visage User',
    },
    delegation: {
      audience: Audience,
      actor: ClientID,
      clientId: ClientID,
      scopes: ['user.read'],
    },
  });
});

test('rejects access tokens with invalid resource constraints', async (t) => {
  const cases = [
    {
      name: 'issuer',
      token: await signAccessToken({ iss: 'https://other.example' }),
    },
    {
      name: 'audience',
      token: await signAccessToken({ aud: 'urn:other-resource' }),
    },
    { name: 'scope', token: await signAccessToken({ scope: 'user.write' }) },
    {
      name: 'actor',
      token: await signAccessToken({ act: { sub: 'other-client' } }),
    },
    {
      name: 'signature',
      token: await signAccessToken({}, alternatePrivateKey),
    },
    { name: 'typ', token: await signAccessToken({}, privateKey, 'JWT') },
  ];

  for (const current of cases) {
    await t.test(current.name, async () => {
      const response = await requestResource(current.token);
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: 'invalid_token' });
    });
  }
});

async function signAccessToken(
  claims: JWTPayload = {},
  signingKey = privateKey,
  typ = 'at+jwt',
): Promise<string> {
  const now = Math.floor(Date.now() / 1_000);
  const registeredClaims = new Set(['iss', 'sub', 'aud', 'iat', 'exp']);
  return new SignJWT({
    client_id: ClientID,
    scope: 'user.read',
    act: { sub: ClientID },
    email: 'user@example.com',
    name: 'Visage User',
    ...Object.fromEntries(
      Object.entries(claims).filter(([name]) => !registeredClaims.has(name)),
    ),
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'resource-test-key', typ })
    .setIssuer((claims.iss as string | undefined) ?? Issuer)
    .setSubject((claims.sub as string | undefined) ?? 'user-subject')
    .setAudience((claims.aud as string | undefined) ?? Audience)
    .setIssuedAt((claims.iat as number | undefined) ?? now)
    .setExpirationTime((claims.exp as number | undefined) ?? now + 300)
    .sign(signingKey);
}

function requestResource(token: string): Promise<Response> {
  return fetch(resourceURL, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing port');
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
