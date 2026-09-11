import type {
  IncomingMessage,
  RequestListener,
  ServerResponse,
} from 'node:http';

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

export type ResourceAPIOptions = {
  readonly issuer: string;
  readonly jwksURL: string;
  readonly audience: string;
  readonly clientId: string;
};

export type UserResource = {
  readonly user: {
    readonly subject: string;
    readonly email?: string;
    readonly name?: string;
  };
  readonly delegation: {
    readonly audience: string;
    readonly actor: string;
    readonly clientId: string;
    readonly scopes: readonly string[];
  };
};

export function createResourceAPI(
  options: ResourceAPIOptions,
): RequestListener {
  const keys = createRemoteJWKSet(new URL(options.jwksURL));
  return (request, response) => {
    handleRequest(request, response, options, keys).catch(() => {
      writeJSON(response, 401, { error: 'invalid_token' });
    });
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: ResourceAPIOptions,
  keys: ReturnType<typeof createRemoteJWKSet>,
): Promise<void> {
  if (request.method !== 'GET' || request.url !== '/resource/user') {
    writeJSON(response, 404, { error: 'not_found' });
    return;
  }
  const token = readBearerToken(request);
  const { payload } = await jwtVerify(token, keys, {
    algorithms: ['RS256'],
    audience: options.audience,
    issuer: options.issuer,
    typ: 'at+jwt',
  });
  const scopes = readScopes(payload);
  if (
    payload.aud !== options.audience ||
    payload.client_id !== options.clientId ||
    readActor(payload) !== options.clientId ||
    !scopes.includes('user.read') ||
    typeof payload.sub !== 'string'
  ) {
    throw new Error('Invalid access token claims');
  }

  writeJSON(response, 200, {
    user: {
      subject: payload.sub,
      ...(typeof payload.email === 'string' ? { email: payload.email } : {}),
      ...(typeof payload.name === 'string' ? { name: payload.name } : {}),
    },
    delegation: {
      audience: options.audience,
      actor: options.clientId,
      clientId: options.clientId,
      scopes,
    },
  } satisfies UserResource);
}

function readBearerToken(request: IncomingMessage): string {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer ') || authorization.length === 7) {
    throw new Error('Missing bearer token');
  }
  return authorization.slice(7);
}

function readScopes(payload: JWTPayload): readonly string[] {
  if (typeof payload.scope !== 'string') throw new Error('Missing scope');
  return payload.scope.split(' ');
}

function readActor(payload: JWTPayload): unknown {
  if (!payload.act || typeof payload.act !== 'object') return undefined;
  return 'sub' in payload.act ? payload.act.sub : undefined;
}

function writeJSON(
  response: ServerResponse,
  status: number,
  body: object,
): void {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(body));
}
