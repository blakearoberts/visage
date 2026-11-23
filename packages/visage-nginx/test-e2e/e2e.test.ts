import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createPublicKey, verify, type webcrypto } from 'node:crypto';
import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';

const env = {
  ...process.env,
  COMPOSE_FILE: 'test-e2e/compose.yaml',
  COMPOSE_PROJECT_NAME: `visage-nginx-test-${process.pid}`,
  VISAGE_TEST_SECRET: 'test-secret',
};

function publishedAddress(service: string, port: number) {
  return execFileSync('docker', ['compose', 'port', service, String(port)], {
    env,
    encoding: 'utf8',
  }).trim();
}

const connections: string[] = [];

function curl(...args: string[]) {
  return execFileSync(
    'curl',
    [
      '--noproxy',
      '*',
      ...connections,
      '--silent',
      '--show-error',
      '--max-time',
      '10',
      ...args,
    ],
    { encoding: 'utf8', env },
  );
}

const edge = 'http://edge';
const issuer = 'http://dex:5556';
const status = ['-o', '/dev/null', '-w', '%{http_code}'];

describe('oauth2-proxy sessions and Dex token exchange', () => {
  const temp = mkdtempSync(join(tmpdir(), 'visage-nginx-'));
  const cookieFile = join(temp, 'session');
  const jar = ['-b', cookieFile, '-c', cookieFile];

  const results = join('test-results', env.COMPOSE_PROJECT_NAME);
  mkdirSync(results, { recursive: true });
  const log = openSync(join(results, 'compose.log'), 'w');

  before(() => {
    execFileSync('docker', ['compose', 'up', '-d', '--build'], {
      env,
      stdio: ['ignore', log, log],
    });
    connections.push(
      '--connect-to',
      'edge:80:' + publishedAddress('edge', 80),
      '--connect-to',
      'dex:5556:' + publishedAddress('dex', 5556),
    );
    curl(
      '--retry',
      '20',
      '--retry-all-errors',
      '--retry-delay',
      '1',
      '-f',
      edge + '/oauth/start',
    );
  });

  after(() => {
    rmSync(temp, { recursive: true, force: true });
    try {
      execFileSync('docker', ['compose', 'down', '-v'], {
        env,
        stdio: ['ignore', log, log],
      });
    } finally {
      closeSync(log);
    }
  });

  test('allows public requests without a session', () => {
    assert.equal(
      curl('-f', '-w', '%{http_code}', edge + '/public'),
      '\n\n\n200',
    );
  });

  test('requires a session unless the policy explicitly disables it', () => {
    assert.equal(curl(...status, edge + '/unmapped'), '401');
  });

  test('rejects exchange without a session token', () => {
    assert.equal(curl(...status, edge + '/exchange-without-session'), '502');
  });

  test('keeps the oauth2-proxy auth endpoint private', () => {
    assert.equal(curl(...status, edge + '/oauth/auth'), '404');
  });

  test('rejects a client bearer token without a session', () => {
    assert.equal(
      curl(
        ...status,
        '-H',
        'Authorization: Bearer unrelated',
        edge + '/resource',
      ),
      '401',
    );
  });

  test('redirects document navigation and preserves the return URL', () => {
    for (const [method, path] of [
      ['GET', '/session?a=1&b=2'],
      ['HEAD', '/reports/monthly'],
    ]) {
      const reply = curl(
        method === 'HEAD' ? '-I' : '-i',
        '-H',
        'Sec-Fetch-Mode: navigate',
        '-H',
        'Sec-Fetch-Dest: document',
        edge + path,
      );
      assert.match(reply, /^HTTP\/1.1 302 /);
      const location = /^Location: (.+)$/im.exec(reply)?.[1];
      assert.ok(location);
      const login = new URL(location.trim());
      assert.equal(login.origin + login.pathname, edge + '/oauth/start');
      assert.equal(login.searchParams.get('rd'), edge + path);
    }
  });

  test('returns 401 for requests outside GET and HEAD document navigation', () => {
    for (const [method, mode, dest] of [
      ['POST', 'navigate', 'document'],
      ['GET', 'cors', 'document'],
      ['GET', 'navigate', 'iframe'],
    ]) {
      assert.equal(
        curl(
          ...status,
          '-X',
          method,
          '-H',
          'Sec-Fetch-Mode: ' + mode,
          '-H',
          'Sec-Fetch-Dest: ' + dest,
          edge + '/session',
        ),
        '401',
      );
    }
  });

  test('clears an expired session cookie', () => {
    const expired = curl(
      '-i',
      '-b',
      '_oauth2_proxy=expired',
      edge + '/session',
    );
    assert.match(expired, /^HTTP\/1.1 401 /);
    assert.match(expired, /^Set-Cookie: _oauth2_proxy=;.*Max-Age=0/im);
  });

  function signIn(start: string) {
    const login = new URL(
      curl('-c', cookieFile, '-o', '/dev/null', '-w', '%{redirect_url}', start),
    );
    assert.equal(login.origin, issuer);
    login.pathname = '/auth/test';
    return curl(
      ...jar,
      '-fL',
      '-D',
      '-',
      '-o',
      '/dev/null',
      '-w',
      '%{http_code} %{url_effective}',
      login.href,
    );
  }

  test('completes authorization code login and returns to the protected resource', () => {
    const resource = edge + '/resource?report=monthly';
    const start = curl(
      '-H',
      'Sec-Fetch-Mode: navigate',
      '-H',
      'Sec-Fetch-Dest: document',
      '-o',
      '/dev/null',
      '-w',
      '%{redirect_url}',
      resource,
    );
    const response = signIn(start);
    assert.match(response, /^Set-Cookie: _oauth2_proxy=[^;\s]+;/im);
    assert.ok(response.endsWith('200 ' + resource));
  });

  describe('with a session', () => {
    let keys: (webcrypto.JsonWebKey & { kid: string })[];
    before(() => {
      ({ keys } = JSON.parse(curl('-f', issuer + '/keys')));
    });

    beforeEach(() => {
      signIn(edge + '/oauth/start?rd=/session');
    });

    function claims(path: string) {
      const output = curl(
        ...jar,
        '-f',
        '-H',
        'Authorization: Bearer unrelated',
        '-H',
        'X-Auth-Request-User: unrelated',
        '-w',
        '%header{x-upstream}',
        edge + path,
      );
      const [authorization, user, email, port] = output.trimEnd().split('\n');
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
      const token = JSON.parse(
        Buffer.from(payload, 'base64url').toString(),
      ) as {
        iss: string;
        aud: string | string[];
        azp?: string;
      };
      assert.equal(token.iss, issuer);
      return { token, port };
    }

    test('forwards the signed session ID token and identity', () => {
      assert.equal(claims('/session').token.aud, edge);
    });

    test('omits authorization when forwarding is off for a valid session', () => {
      const [authorization, user] = curl(
        ...jar,
        '-f',
        edge + '/identity',
      ).split('\n');
      assert.equal(authorization, '');
      assert.ok(user);
    });

    test('exchanges for the audience of the routed upstream', () => {
      for (const [path, origin, port] of [
        ['/resource/nested', 'http://resource', '8080'],
        ['/resource/another', 'http://resource', '8080'],
        ['/reports/monthly', 'http://reports', '8081'],
        ['/reports/another', 'http://reports', '8081'],
      ]) {
        const actual = claims(path);
        assert.deepEqual([...actual.token.aud].sort(), [edge, origin]);
        assert.equal(actual.token.azp, edge);
        assert.equal(actual.port, port);
      }
    });

    test('withholds auth outputs when exchange is denied', () => {
      const denied = curl(
        ...jar,
        '-o',
        '/dev/null',
        '-w',
        '%{http_code} %header{x-test-auth-outputs}',
        edge + '/denied',
      );
      assert.equal(denied, '502 empty');
    });

    test('sign-out clears the authenticated session', () => {
      curl(...jar, '-f', edge + '/oauth/sign_out');
      assert.equal(curl(...jar, ...status, edge + '/session'), '401');
    });
  });
});
