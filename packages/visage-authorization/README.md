# Visage Authorization

`@blakearoberts/visage-authorization` is a narrow RFC 8693 token-exchange
authorization server for Node.js. It verifies an audience-restricted JWT access
token, authenticates the exchanging client, asks Open Policy Agent (OPA) which
requested scopes may be delegated, and issues an RFC 9068 JWT access token for
one downstream resource.

## Usage

```ts
import { createServer } from 'node:http';

import { createAuthorizationServer } from '@blakearoberts/visage-authorization';

const handler = await createAuthorizationServer({
  issuer: 'https://example.test/authorization',
  signingKey,
  signingKeyId: 'current',
  subjectIssuer: {
    issuer: 'https://example.test/dex',
    jwksURL: 'https://example.test/dex/keys',
  },
  clients: {
    'web-app': { secret: process.env.WEB_APP_CLIENT_SECRET! },
  },
  policyURL: 'http://opa:8181/v1/data/visage/authorization/exchange',
});

createServer(handler).listen(8080, '127.0.0.1');
```

The signing key must be an extractable `RSASSA-PKCS1-v1_5` private `CryptoKey`.
The package publishes the corresponding public key from its JWKS endpoint and
signs access tokens with RS256.

## Token exchange

The token endpoint accepts `client_secret_basic` and an
`application/x-www-form-urlencoded` RFC 8693 request:

```text
grant_type=urn:ietf:params:oauth:grant-type:token-exchange
subject_token=<access token>
subject_token_type=urn:ietf:params:oauth:token-type:access_token
requested_token_type=urn:ietf:params:oauth:token-type:access_token
resource=urn:example:user-api
scope=user.read user.write
```

The subject token must be an RS256 JWT whose issuer matches `subjectIssuer` and
whose audience equals the authenticated client ID.

## OPA contract

The server posts verified claims and request facts to `policyURL`. It never
sends either token or the client secret.

```json
{
  "input": {
    "subject": { "iss": "https://example.test/dex", "sub": "alice" },
    "client": { "id": "web-app" },
    "request": {
      "resource": "urn:example:user-api",
      "scopes": ["user.read", "user.write"]
    }
  }
}
```

OPA must return an explicit decision:

```json
{
  "result": {
    "allow": true,
    "scopes": ["user.read"]
  }
}
```

The issued token contains only the intersection of the requested and returned
scopes. Policy errors and undefined or malformed decisions fail closed.

## MVP boundaries

This package supports one trusted JWT subject issuer, RS256, static confidential
clients, one resource per request, and mandatory OPA decisions. It does not
implement an authorization endpoint, refresh tokens, introspection, revocation,
actor-token inputs, chained exchange, dynamic client registration, or
signing-key rotation. The caller owns HTTPS, listener lifecycle, client-secret
storage, and signing-key persistence and rotation.
