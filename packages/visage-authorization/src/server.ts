import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  IncomingMessage,
  RequestListener,
  ServerResponse,
} from 'node:http';

import {
  createRemoteJWKSet,
  exportJWK,
  jwtVerify,
  SignJWT,
  type JWTPayload,
} from 'jose';

import type { AuthorizationServerOptions } from './types';

const TokenExchangeGrantType =
  'urn:ietf:params:oauth:grant-type:token-exchange';
const AccessTokenType = 'urn:ietf:params:oauth:token-type:access_token';

const FormContentType = 'application/x-www-form-urlencoded';
const PolicyTimeoutMilliseconds = 2_000;
const MaximumRequestBytes = 16 * 1024;
const Scope = /^[\x21\x23-\x5b\x5d-\x7e]+$/;

type OAuthErrorCode =
  | 'invalid_client'
  | 'invalid_request'
  | 'invalid_scope'
  | 'invalid_target'
  | 'server_error'
  | 'unsupported_grant_type';

class OAuthError extends Error {
  constructor(
    readonly code: OAuthErrorCode,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

type ResolvedOptions = {
  readonly issuer: string;
  readonly tokenPath: string;
  readonly jwksPath: string;
  readonly metadataPath: string;
  readonly subjectIssuer: AuthorizationServerOptions['subjectIssuer'];
  readonly clients: AuthorizationServerOptions['clients'];
  readonly policyURL: string;
  readonly accessTokenTTLSeconds: number;
};

type PolicyDecision = {
  readonly allow: boolean;
  readonly scopes: readonly string[];
};

export async function createAuthorizationServer(
  options: AuthorizationServerOptions,
): Promise<RequestListener> {
  const resolved = resolveOptions(options);
  const subjectKeys = createRemoteJWKSet(
    new URL(resolved.subjectIssuer.jwksURL),
  );
  const publicKey = await exportJWK(options.signingKey);
  if (publicKey.kty !== 'RSA' || !publicKey.n || !publicKey.e) {
    throw new Error('signingKey must be an extractable RSA private key');
  }
  const jwks = {
    keys: [
      {
        kty: publicKey.kty,
        n: publicKey.n,
        e: publicKey.e,
        alg: 'RS256',
        kid: options.signingKeyId,
        use: 'sig',
      },
    ],
  };

  return (request, response) => {
    handleRequest(
      request,
      response,
      resolved,
      options.signingKey,
      options.signingKeyId,
      subjectKeys,
      jwks,
    ).catch((error: unknown) => {
      if (!response.headersSent) {
        writeOAuthError(
          response,
          error instanceof OAuthError
            ? error
            : new OAuthError('server_error', 'Authorization server error', 500),
        );
      } else if (!response.writableEnded) {
        response.end();
      }
    });
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: ResolvedOptions,
  signingKey: CryptoKey,
  signingKeyId: string,
  subjectKeys: ReturnType<typeof createRemoteJWKSet>,
  jwks: object,
): Promise<void> {
  const url = new URL(request.url ?? '/', new URL(options.issuer).origin);
  if (url.pathname === options.tokenPath) {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      throw new OAuthError(
        'invalid_request',
        'Token endpoint requires POST',
        405,
      );
    }
    await exchangeToken(
      request,
      response,
      options,
      signingKey,
      signingKeyId,
      subjectKeys,
    );
    return;
  }
  if (url.pathname === options.jwksPath) {
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      writeStatus(response, 405);
      return;
    }
    writeJSON(response, 200, jwks, false);
    return;
  }
  if (url.pathname === options.metadataPath) {
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      writeStatus(response, 405);
      return;
    }
    writeJSON(
      response,
      200,
      {
        issuer: options.issuer,
        token_endpoint: `${options.issuer}/token`,
        jwks_uri: `${options.issuer}/jwks`,
        grant_types_supported: [TokenExchangeGrantType],
        token_endpoint_auth_methods_supported: ['client_secret_basic'],
      },
      false,
    );
    return;
  }
  writeStatus(response, 404);
}

async function exchangeToken(
  request: IncomingMessage,
  response: ServerResponse,
  options: ResolvedOptions,
  signingKey: CryptoKey,
  signingKeyId: string,
  subjectKeys: ReturnType<typeof createRemoteJWKSet>,
): Promise<void> {
  const { clientId } = authenticateClient(request, options.clients);
  const contentType = request.headers['content-type']
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== FormContentType) {
    throw new OAuthError(
      'invalid_request',
      `Content-Type must be ${FormContentType}`,
    );
  }
  const form = new URLSearchParams(await readBody(request));
  const allowedParameters = new Set([
    'grant_type',
    'requested_token_type',
    'resource',
    'scope',
    'subject_token',
    'subject_token_type',
  ]);
  for (const name of form.keys()) {
    if (!allowedParameters.has(name)) {
      throw new OAuthError('invalid_request', `Unsupported parameter: ${name}`);
    }
  }

  const grantType = requiredParameter(form, 'grant_type');
  if (grantType !== TokenExchangeGrantType) {
    throw new OAuthError(
      'unsupported_grant_type',
      'Only the token-exchange grant is supported',
    );
  }
  const subjectTokenType = requiredParameter(form, 'subject_token_type');
  if (subjectTokenType !== AccessTokenType) {
    throw new OAuthError(
      'invalid_request',
      'subject_token_type must identify an access token',
    );
  }
  const requestedTokenType = optionalParameter(form, 'requested_token_type');
  if (
    requestedTokenType !== undefined &&
    requestedTokenType !== AccessTokenType
  ) {
    throw new OAuthError(
      'invalid_request',
      'requested_token_type must identify an access token',
    );
  }
  const resource = requiredParameter(form, 'resource');
  validateResource(resource);
  const requestedScopes = parseScopes(requiredParameter(form, 'scope'));
  const subjectToken = requiredParameter(form, 'subject_token');

  let subject: JWTPayload;
  try {
    ({ payload: subject } = await jwtVerify(subjectToken, subjectKeys, {
      algorithms: ['RS256'],
      audience: clientId,
      issuer: options.subjectIssuer.issuer,
    }));
  } catch {
    throw new OAuthError('invalid_request', 'Invalid subject token');
  }
  if (
    typeof subject.sub !== 'string' ||
    typeof subject.exp !== 'number' ||
    subject.aud !== clientId
  ) {
    throw new OAuthError('invalid_request', 'Invalid subject token claims');
  }

  const decision = await queryPolicy(
    options.policyURL,
    subject,
    clientId,
    resource,
    requestedScopes,
  );
  if (!decision.allow) {
    throw new OAuthError(
      'invalid_target',
      'Policy denied the requested resource',
    );
  }
  const allowedScopes = new Set(decision.scopes);
  const grantedScopes = requestedScopes.filter((scope) =>
    allowedScopes.has(scope),
  );
  if (grantedScopes.length === 0) {
    throw new OAuthError('invalid_scope', 'Policy denied the requested scopes');
  }

  const now = Math.floor(Date.now() / 1_000);
  const expiresAt = Math.min(now + options.accessTokenTTLSeconds, subject.exp);
  if (expiresAt <= now) {
    throw new OAuthError('invalid_request', 'Subject token has expired');
  }
  const identity = {
    ...(typeof subject.email === 'string' ? { email: subject.email } : {}),
    ...(typeof subject.email_verified === 'boolean'
      ? { email_verified: subject.email_verified }
      : {}),
    ...(typeof subject.name === 'string' ? { name: subject.name } : {}),
  };
  const scope = grantedScopes.join(' ');
  const accessToken = await new SignJWT({
    ...identity,
    act: { sub: clientId },
    client_id: clientId,
    scope,
  })
    .setProtectedHeader({ alg: 'RS256', kid: signingKeyId, typ: 'at+jwt' })
    .setIssuer(options.issuer)
    .setSubject(subject.sub)
    .setAudience(resource)
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .setJti(randomUUID())
    .sign(signingKey);

  writeJSON(
    response,
    200,
    {
      access_token: accessToken,
      issued_token_type: AccessTokenType,
      token_type: 'Bearer',
      expires_in: expiresAt - now,
      scope,
    },
    true,
  );
}

function authenticateClient(
  request: IncomingMessage,
  clients: AuthorizationServerOptions['clients'],
): { readonly clientId: string } {
  const authorization = request.headers.authorization;
  const match = authorization?.match(/^Basic ([A-Za-z0-9+/]+={0,2})$/i);
  if (!match) throw invalidClient();
  let credentials: string;
  try {
    credentials = Buffer.from(match[1]!, 'base64').toString('utf8');
  } catch {
    throw invalidClient();
  }
  const separator = credentials.indexOf(':');
  if (separator < 1) throw invalidClient();
  let clientId: string;
  let clientSecret: string;
  try {
    clientId = decodeFormComponent(credentials.slice(0, separator));
    clientSecret = decodeFormComponent(credentials.slice(separator + 1));
  } catch {
    throw invalidClient();
  }
  const client = clients[clientId];
  if (!client || !secretsEqual(clientSecret, client.secret)) {
    throw invalidClient();
  }
  return { clientId };
}

function invalidClient(): OAuthError {
  return new OAuthError('invalid_client', 'Invalid client credentials', 401);
}

function decodeFormComponent(value: string): string {
  return decodeURIComponent(value.replace(/\+/g, ' '));
}

function secretsEqual(actual: string, expected: string): boolean {
  const actualHash = createHash('sha256').update(actual).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MaximumRequestBytes) {
      throw new OAuthError('invalid_request', 'Request body is too large');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function requiredParameter(form: URLSearchParams, name: string): string {
  const value = optionalParameter(form, name);
  if (!value) {
    throw new OAuthError('invalid_request', `Missing parameter: ${name}`);
  }
  return value;
}

function optionalParameter(
  form: URLSearchParams,
  name: string,
): string | undefined {
  const values = form.getAll(name);
  if (values.length > 1) {
    throw new OAuthError('invalid_request', `Duplicate parameter: ${name}`);
  }
  return values[0];
}

function validateResource(resource: string): void {
  try {
    const url = new URL(resource);
    if (url.hash) throw new Error();
  } catch {
    throw new OAuthError(
      'invalid_target',
      'resource must be an absolute URI without a fragment',
    );
  }
}

function parseScopes(value: string): readonly string[] {
  const scopes = value.split(' ');
  if (scopes.some((scope) => !Scope.test(scope))) {
    throw new OAuthError('invalid_scope', 'Invalid scope syntax');
  }
  return [...new Set(scopes)];
}

async function queryPolicy(
  policyURL: string,
  subject: JWTPayload,
  clientId: string,
  resource: string,
  scopes: readonly string[],
): Promise<PolicyDecision> {
  let response: Response;
  try {
    response = await fetch(policyURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: {
          subject,
          client: { id: clientId },
          request: { resource, scopes },
        },
      }),
      signal: AbortSignal.timeout(PolicyTimeoutMilliseconds),
    });
  } catch {
    throw new OAuthError('server_error', 'Policy service unavailable', 500);
  }
  if (!response.ok) {
    throw new OAuthError('server_error', 'Policy service failed', 500);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new OAuthError('server_error', 'Invalid policy response', 500);
  }
  if (!isPolicyResponse(body)) {
    throw new OAuthError('server_error', 'Invalid policy response', 500);
  }
  return body.result;
}

function isPolicyResponse(
  value: unknown,
): value is { readonly result: PolicyDecision } {
  if (!value || typeof value !== 'object' || !('result' in value)) return false;
  const result = value.result;
  return (
    !!result &&
    typeof result === 'object' &&
    'allow' in result &&
    typeof result.allow === 'boolean' &&
    'scopes' in result &&
    Array.isArray(result.scopes) &&
    result.scopes.every(
      (scope) => typeof scope === 'string' && Scope.test(scope),
    )
  );
}

function resolveOptions(options: AuthorizationServerOptions): ResolvedOptions {
  const issuer = normalizeIssuer(options.issuer, 'issuer');
  const issuerURL = new URL(issuer);
  const issuerPath = issuerURL.pathname === '/' ? '' : issuerURL.pathname;
  const accessTokenTTLSeconds = options.accessTokenTTLSeconds ?? 300;
  if (
    !Number.isSafeInteger(accessTokenTTLSeconds) ||
    accessTokenTTLSeconds <= 0
  ) {
    throw new Error('accessTokenTTLSeconds must be a positive integer');
  }
  if (!options.signingKeyId) throw new Error('signingKeyId is required');
  if (
    options.signingKey.type !== 'private' ||
    options.signingKey.algorithm.name !== 'RSASSA-PKCS1-v1_5' ||
    !options.signingKey.extractable
  ) {
    throw new Error(
      'signingKey must be an extractable RSASSA-PKCS1-v1_5 private key',
    );
  }
  if (Object.keys(options.clients).length === 0) {
    throw new Error('At least one client is required');
  }
  for (const [clientId, client] of Object.entries(options.clients)) {
    if (!clientId || !client.secret) {
      throw new Error('Client identifiers and secrets must not be empty');
    }
  }
  return {
    issuer,
    tokenPath: `${issuerPath}/token`,
    jwksPath: `${issuerPath}/jwks`,
    metadataPath: `/.well-known/oauth-authorization-server${issuerPath}`,
    subjectIssuer: {
      issuer: normalizeIssuer(
        options.subjectIssuer.issuer,
        'subjectIssuer.issuer',
      ),
      jwksURL: normalizeEndpoint(
        options.subjectIssuer.jwksURL,
        'subjectIssuer.jwksURL',
      ),
    },
    clients: options.clients,
    policyURL: normalizeEndpoint(options.policyURL, 'policyURL'),
    accessTokenTTLSeconds,
  };
}

function normalizeIssuer(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  if (
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname.endsWith('/'))
  ) {
    throw new Error(
      `${name} must not include a query, fragment, or trailing slash`,
    );
  }
  return url.pathname === '/' ? url.origin : url.href;
}

function normalizeEndpoint(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  if (url.hash) throw new Error(`${name} must not include a fragment`);
  return url.href;
}

function writeOAuthError(response: ServerResponse, error: OAuthError): void {
  if (error.code === 'invalid_client') {
    response.setHeader('WWW-Authenticate', 'Basic realm="token"');
  }
  writeJSON(
    response,
    error.status,
    { error: error.code, error_description: error.message },
    true,
  );
}

function writeJSON(
  response: ServerResponse,
  status: number,
  body: object,
  noStore: boolean,
): void {
  const data = JSON.stringify(body);
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Content-Length', Buffer.byteLength(data));
  if (noStore) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Pragma', 'no-cache');
  }
  response.end(data);
}

function writeStatus(response: ServerResponse, status: number): void {
  response.statusCode = status;
  response.end();
}
