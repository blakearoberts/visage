import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createPublicKey, verify, type webcrypto } from 'node:crypto';
import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';

describe('sessions and exchange', () => {
  const env = {
    ...process.env,
    COMPOSE_FILE: 'test-e2e/compose.yaml',
    COMPOSE_PROJECT_NAME: `visage-nginx-test-${process.pid}`,
    VISAGE_TEST_SECRET: 'test-secret',
  };

  const connections: string[] = [];

  function curl(...args: string[]) {
    return execFileSync(
      'curl',
      [
        ...connections,
        '--fail',
        '--max-time',
        '3',
        '--no-progress-meter',
        '--noproxy',
        '*',
        ...args,
      ],
      { encoding: 'utf8', env },
    );
  }

  const edge = 'http://localhost';
  const issuer = 'http://dex:5556';

  let temp: string;
  let log: number;
  let cookieFile: string;
  let keys: (webcrypto.JsonWebKey & { kid: string })[];

  before(() => {
    temp = mkdtempSync(join(tmpdir(), 'visage-nginx-'));
    cookieFile = join(temp, 'session');

    const results = join('test-results', env.COMPOSE_PROJECT_NAME);
    mkdirSync(results, { recursive: true });
    log = openSync(join(results, 'compose.log'), 'w');

    function hostPort(service: string, port: number) {
      return execFileSync(
        'docker',
        ['compose', 'port', service, String(port)],
        { env, encoding: 'utf8' },
      ).trim();
    }

    execFileSync('docker', ['compose', 'up', '--build', '--detach'], {
      env,
      stdio: ['ignore', log, log],
    });
    connections.push(
      '--connect-to',
      'dex:5556:' + hostPort('dex', 5556),
      '--connect-to',
      'localhost:80:' + hostPort('edge', 80),
    );
    curl(
      '--retry',
      '3',
      '--retry-all-errors',
      '--retry-delay',
      '1',
      edge + '/oauth/start',
    );
    ({ keys } = JSON.parse(curl(issuer + '/keys')));
  });

  after(() => {
    if (temp) rmSync(temp, { recursive: true, force: true });
    if (log === undefined) return;
    try {
      execFileSync('docker', ['compose', 'down', '--volumes'], {
        env,
        stdio: ['ignore', log, log],
      });
    } finally {
      closeSync(log);
    }
  });

  beforeEach(() => {
    const login = new URL(
      curl(
        '--cookie-jar',
        cookieFile,
        '--output',
        '/dev/null',
        '--write-out',
        '%{redirect_url}',
        edge + '/oauth/start?rd=/session',
      ),
    );
    assert.equal(login.origin, issuer);
    login.pathname = '/auth/test';
    curl(
      '--cookie',
      cookieFile,
      '--cookie-jar',
      cookieFile,
      '--location',
      login.href,
    );
  });

  function claims(path: string) {
    const output = curl(
      '--cookie',
      cookieFile,
      '--cookie-jar',
      cookieFile,
      '--header',
      'Authorization: Bearer unrelated',
      '--header',
      'X-Auth-Request-User: unrelated',
      edge + path,
    );
    const [authorization, user, email] = output.trimEnd().split('\n');
    assert.ok(user && user !== 'unrelated');
    assert.equal(email, 'kilgore@kilgore.trout');
    assert.match(authorization, /^Bearer /i);
    const [header, payload, signature] = authorization.slice(7).split('.');
    const { kid, alg } = JSON.parse(
      Buffer.from(header, 'base64url').toString(),
    ) as { kid: string; alg: string };
    assert.equal(alg, 'RS256');
    const jwk = keys.find((key) => key.kid === kid);
    assert.ok(jwk);
    const key = createPublicKey({
      key: jwk,
      format: 'jwk',
    });
    assert.ok(
      verify(
        'RSA-SHA256',
        Buffer.from(header + '.' + payload),
        key,
        Buffer.from(signature, 'base64url'),
      ),
    );
    const token = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      iss: string;
      aud: string | string[];
      azp?: string;
    };
    assert.equal(token.iss, issuer);
    return token;
  }

  test('forwards the signed session ID token and identity', () => {
    assert.equal(claims('/session').aud, edge);
  });

  test('exchanges for the audience of the routed upstream', () => {
    for (const [path, audience] of [
      ['/resource/nested', 'http://resource'],
      ['/exchange/monthly', 'http://exchange'],
    ]) {
      const token = claims(path);
      assert.deepEqual([...token.aud].sort(), [edge, audience].sort());
      assert.equal(token.azp, edge);
    }
  });

  test('sign-out clears the authenticated session', () => {
    curl(
      '--cookie',
      cookieFile,
      '--cookie-jar',
      cookieFile,
      edge + '/oauth/sign_out',
    );
    assert.equal(
      curl(
        '--cookie',
        cookieFile,
        '--no-fail',
        '--output',
        '/dev/null',
        '--write-out',
        '%{http_code}',
        edge + '/session',
      ),
      '401',
    );
  });
});
