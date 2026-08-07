import { createHash, randomBytes } from 'node:crypto';
import type { RequestListener } from 'node:http';

import { exportJWK, generateKeyPair } from 'jose';
import { Provider, errors } from 'oidc-provider';
import {
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  ClientSecretBasic,
  discovery,
  enableNonRepudiationChecks,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
} from 'openid-client';

import type { AuthorizationServerOptions } from './types';

const Lifetime = 12 * 60 * 60;
const Idle = 15 * 60;
const now = () => Math.floor(Date.now() / 1000);

export async function createAuthorizationServer(
  options: AuthorizationServerOptions,
): Promise<RequestListener> {
  const callback = new URL(options.redirectUri);
  if (
    callback.protocol !== 'https:' ||
    callback.pathname !== '/interaction/callback' ||
    callback.search ||
    callback.hash ||
    callback.username ||
    callback.password
  ) {
    throw new Error('redirectUri must be https://<host>/interaction/callback');
  }
  const issuer = callback.origin;
  const upstream = await discovery(
    new URL(options.issuer),
    options.clientId,
    options.clientSecret,
    ClientSecretBasic(options.clientSecret),
  );
  enableNonRepudiationChecks(upstream);
  const { privateKey } = await generateKeyPair('ES256', { extractable: true });
  const key = await exportJWK(privateKey);
  key.kid = randomBytes(16).toString('hex');
  key.alg = 'ES256';
  key.use = 'sig';

  const pending = new Map<
    string,
    {
      verifier: string;
      nonce: string;
      state: string;
      expires: number;
    }
  >();
  const provider = new Provider(issuer, {
    jwks: { keys: [key] },
    responseTypes: ['code'],
    clientAuthMethods: ['none', 'private_key_jwt'],
    pkce: { required: () => true },
    extraParams: {
      nonce: (_ctx, value) => {
        if (!value) throw new errors.InvalidRequest('nonce is required');
      },
      dpop_jkt: (_ctx, value) => {
        if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value))
          throw new errors.InvalidRequest('dpop_jkt is required');
      },
    },
    cookies: {
      keys: [randomBytes(32).toString('base64url')],
      names: {
        session: '__Host-visage',
        interaction: '__Secure-visage-interaction',
        resume: '__Secure-visage-resume',
      },
      long: { secure: true, path: '/' },
      short: { secure: true },
    },
    features: {
      devInteractions: { enabled: false },
      userinfo: { enabled: false },
      rpInitiatedLogout: { enabled: false },
      clientIdMetadataDocument: {
        enabled: true,
        ack: 'draft-02',
        allowFetch: (_ctx, id) => new URL(id).pathname !== '/',
        allowClient: (_ctx, client) =>
          client.dpopBoundAccessTokens === true &&
          !!client.redirectUris?.length &&
          client.redirectUris.every(
            (uri) => new URL(uri).protocol === 'https:',
          ),
      },
      resourceIndicators: {
        enabled: true,
        defaultResource: (_ctx, client) => client.clientId,
        useGrantedResource: () => true,
        getResourceServerInfo: (_ctx, resource, client) => {
          if (resource !== client.clientId) throw new errors.InvalidTarget();
          return {
            scope: 'openid',
            audience: resource,
            accessTokenFormat: 'jwt',
            accessTokenTTL: 60,
            jwt: { sign: { alg: 'ES256' } },
          };
        },
      },
    },
    enabledJWA: {
      idTokenSigningAlgValues: ['ES256'],
      clientAuthSigningAlgValues: ['ES256', 'RS256', 'PS256'],
      dPoPSigningAlgValues: ['ES256'],
    },
    ttl: {
      AccessToken: 60,
      IdToken: 60,
      AuthorizationCode: 60,
      Interaction: 300,
      Session: (_ctx, session) =>
        Math.max(
          0,
          Math.min(Idle, (session.loginTs ?? now()) + Lifetime - now()),
        ),
      Grant: Lifetime,
      RefreshToken: (ctx, token) => {
        // Bind confidential refresh tokens too; rotations retain this thumbprint.
        token.jkt ??= ctx.oidc.entities.AccessToken?.jkt;
        if (!token.jkt)
          throw new errors.InvalidGrant('Missing refresh key binding');
        return Math.max(
          0,
          Math.min(Idle, (token.authTime ?? now()) + Lifetime - now()),
        );
      },
    },
    rotateRefreshToken: true,
    expiresWithSession: () => true,
    findAccount: (_ctx, id) => ({ accountId: id, claims: () => ({ sub: id }) }),
    interactions: { url: () => '/interaction' },
  });

  const handle = provider.callback();
  return (request, response) => {
    const url = new URL(request.url ?? '/', issuer);
    if (!url.pathname.startsWith('/interaction')) {
      handle(request, response);
      return;
    }
    void interact().catch(() => {
      if (!response.headersSent) {
        response.writeHead(400, {
          'Content-Type': 'text/plain',
          'Cache-Control': 'no-store',
        });
      }
      response.end('Unable to complete sign-in');
    });

    async function interact() {
      response.setHeader('Cache-Control', 'no-store');
      if (request.method !== 'GET')
        throw new Error('Invalid interaction method');
      const details = await provider.interactionDetails(request, response);
      if (url.pathname === '/interaction/callback') {
        const transaction = pending.get(details.uid);
        pending.delete(details.uid);
        if (!transaction || transaction.expires < now())
          throw new Error('Expired login');
        const tokens = await authorizationCodeGrant(upstream, url, {
          pkceCodeVerifier: transaction.verifier,
          expectedState: transaction.state,
          expectedNonce: transaction.nonce,
          idTokenExpected: true,
          maxAge: 0,
        });
        const claims = tokens.claims();
        if (
          !claims ||
          typeof claims.auth_time !== 'number' ||
          claims.auth_time > now() + 5 ||
          claims.auth_time + Lifetime <= now()
        ) {
          throw new Error('Invalid authentication time');
        }
        const id = createHash('sha256')
          .update(JSON.stringify([claims.iss, claims.sub]))
          .digest('base64url');
        await provider.interactionFinished(
          request,
          response,
          {
            login: {
              accountId: id,
              ts: claims.auth_time,
              acr: typeof claims.acr === 'string' ? claims.acr : undefined,
              amr:
                Array.isArray(claims.amr) &&
                claims.amr.every(
                  (value): value is string => typeof value === 'string',
                )
                  ? claims.amr
                  : undefined,
            },
          },
          { mergeWithLastSubmission: false },
        );
        return;
      }
      if (url.pathname !== '/interaction')
        throw new Error('Unknown interaction');
      if (details.prompt.name === 'login') {
        for (const [id, transaction] of pending) {
          if (transaction.expires < now()) pending.delete(id);
        }
        if (pending.size >= 1000) throw new Error('Too many pending logins');
        const verifier = randomPKCECodeVerifier();
        const nonce = randomNonce();
        const state = randomState();
        pending.set(details.uid, {
          verifier,
          nonce,
          state,
          expires: now() + 300,
        });
        const location = buildAuthorizationUrl(upstream, {
          redirect_uri: callback.href,
          scope: 'openid',
          response_type: 'code',
          code_challenge: await calculatePKCECodeChallenge(verifier),
          code_challenge_method: 'S256',
          nonce,
          state,
          max_age: '0',
        });
        response.writeHead(303, { Location: location.href });
        response.end();
        return;
      }
      if (details.prompt.name !== 'consent' || !details.session)
        throw new Error('Unsupported interaction');
      const grant = details.grantId
        ? await provider.Grant.find(details.grantId)
        : new provider.Grant({
            accountId: details.session.accountId,
            clientId: String(details.params.client_id),
          });
      if (!grant) throw new Error('Expired grant');
      grant.addOIDCScope(String(details.params.scope));
      grant.addResourceScope(String(details.params.client_id), 'openid');
      const grantId = await grant.save();
      await provider.interactionFinished(request, response, {
        consent: { grantId },
      });
    }
  };
}
