import { getGlobalLoggerProvider } from '../log';
import type { Instrumentation } from './instrumentation';

/**
 * Instruments fetch and XMLHttpRequest to emit HTTP request logs.
 *
 * @see {@link https://opentelemetry.io/docs/specs/semconv/http/http-spans/ | HTTP client span conventions}
 */
export function createHTTPInstrumentation(): Instrumentation {
  const logger = getGlobalLoggerProvider().logger('http');
  const fetch = window.fetch;
  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  const requests = new WeakMap<
    XMLHttpRequest,
    { method: string; url: URL | null }
  >();
  const events = ['readystatechange', 'load', 'error', 'timeout', 'abort'];
  let disposed = false;

  function report(
    request: { method?: string; url?: URL | null; started: number },
    status: number,
    contentLength: string | null,
    errorType?: string,
  ): void {
    if (disposed) return;
    const { method, url, started } = request;
    const now = performance.now();
    // Match the browser's method normalization.
    const name =
      method !== undefined &&
      /^(DELETE|GET|HEAD|OPTIONS|POST|PUT)$/i.test(method)
        ? method.toUpperCase()
        : method;
    if (url?.username) url.username = 'REDACTED';
    if (url?.password) url.password = 'REDACTED';
    const failure = errorType ?? (status >= 400 ? String(status) : undefined);
    const size =
      status > 0 && (name === 'HEAD' || status === 204 || status === 304)
        ? 0
        : contentLength !== null && /^\d+$/.test(contentLength)
          ? Number(contentLength)
          : undefined;
    logger.emit({
      timestamp: performance.timeOrigin + now,
      severityNumber: 5,
      severityText: 'DEBUG',
      eventName: 'http.client.request.duration',
      body: url ? `${name ?? 'HTTP'} ${url.pathname}` : (name ?? 'HTTP'),
      attributes: {
        ...(name !== undefined ? { 'http.request.method': name } : {}),
        ...(url ? { 'url.full': url.href } : {}),
        ...(url?.hostname
          ? { 'server.address': url.hostname.replace(/^\[|\]$/g, '') }
          : {}),
        ...(url?.port ? { 'server.port': Number(url.port) } : {}),
        ...(status > 0 ? { 'http.response.status_code': status } : {}),
        ...(size !== undefined && Number.isSafeInteger(size)
          ? { 'http.response.body.size': size }
          : {}),
        ...(failure !== undefined ? { 'error.type': failure } : {}),
        duration: (now - started) / 1000,
      },
    });
  }

  window.fetch = async function (input, init) {
    const source = input instanceof Request ? input : undefined;
    const request = {
      method: init?.method ?? source?.method ?? 'GET',
      url: URL.parse(
        input instanceof Request ? input.url : input,
        document.baseURI,
      ),
      started: performance.now(),
    };
    const signal = init?.signal === undefined ? source?.signal : init.signal;
    let response: Response | undefined;
    let errorType: string | undefined;
    try {
      response = await fetch.call(this, input, init);
      return response;
    } catch (error) {
      if (!signal?.aborted || signal.reason?.name === 'TimeoutError') {
        errorType = error instanceof Error ? error.name : '_OTHER';
      }
      throw error;
    } finally {
      report(
        request,
        response?.status ?? 0,
        response?.headers.get('content-length') ?? null,
        errorType,
      );
    }
  };

  XMLHttpRequest.prototype.open = function (
    method,
    url,
    ...args: [
      async?: boolean,
      username?: string | null,
      password?: string | null,
    ]
  ) {
    const parsed = URL.parse(url, document.baseURI);
    Reflect.apply(open, this, [method, url, ...args]);
    requests.set(this, { method, url: parsed });
  };

  XMLHttpRequest.prototype.send = function (body) {
    const request = { ...requests.get(this), started: performance.now() };
    const finish = (event: Event) => {
      if (
        event.type === 'readystatechange' &&
        (this.readyState !== XMLHttpRequest.DONE || this.status === 0)
      )
        return;
      cleanup();
      report(
        request,
        this.status,
        this.getResponseHeader('content-length'),
        event.type === 'error'
          ? 'network_error'
          : event.type === 'timeout'
            ? 'timeout'
            : undefined,
      );
    };
    const cleanup = () => {
      for (const event of events) this.removeEventListener(event, finish);
    };
    for (const event of events) this.addEventListener(event, finish);
    try {
      send.call(this, body);
    } catch (error) {
      cleanup();
      throw error;
    }
  };

  return {
    dispose() {
      disposed = true;
      window.fetch = fetch;
      XMLHttpRequest.prototype.open = open;
      XMLHttpRequest.prototype.send = send;
    },
  };
}
