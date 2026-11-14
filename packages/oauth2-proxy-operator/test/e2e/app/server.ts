import { createServer } from 'node:http';

const headers = ['authorization', 'x-forwarded-email', 'x-forwarded-user'];

createServer((req, res) => {
  const authorization = req.headers.authorization ?? '';
  const initial = new URL(req.url ?? '/', 'http://app').searchParams.get(
    'initial',
  );

  if (initial && authorization === `Bearer ${initial}`) {
    res.writeHead(425, { 'content-type': 'text/plain' });
    res.end('token has not refreshed\n');
    return;
  }

  const lines = [
    'hello world',
    `url=${req.url}`,
    ...headers.map((name) => `${name}=${req.headers[name] ?? ''}`),
  ];

  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end(`${lines.join('\n')}\n`);
}).listen(80, '0.0.0.0');
