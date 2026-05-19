import type { IncomingMessage } from 'node:http';

import type { VisageMiddleware, VisageUpgradeHandler } from './server';

const VisageEdgeKeyHeader = 'X-Visage-Edge-Key';

export function createVisageMiddleware(edgeKey: string): VisageMiddleware {
  return function visageMiddleware(request, response, next) {
    if (isVisageEdgeRequest(request, edgeKey)) {
      next();
      return;
    }
    response.statusCode = 403;
    response.end('Forbidden');
  };
}

export function createVisageUpgradeHandler(
  edgeKey: string,
): VisageUpgradeHandler {
  return function visageUpgrade(request, socket) {
    if (isVisageEdgeRequest(request, edgeKey)) {
      return;
    }
    socket.write(
      'HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
    );
    socket.destroy();
  };
}

function isVisageEdgeRequest(
  request: IncomingMessage,
  edgeKey: string,
): boolean {
  const header = request.headers[VisageEdgeKeyHeader.toLowerCase()];
  return typeof header === 'string' && header === edgeKey;
}
