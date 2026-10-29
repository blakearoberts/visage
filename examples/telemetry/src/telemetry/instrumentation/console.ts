import { getGlobalLoggerProvider } from '../log';
import type { Instrumentation } from './instrumentation';

export function createConsoleInstrumentation(): Instrumentation {
  const logger = getGlobalLoggerProvider().logger('console');

  function toString(args: any[]): string {
    const value = args.length > 1 ? args : args[0];
    if (typeof value === 'string') {
      return value;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  const restores = (
    [
      [5, 'DEBUG', 'debug'],
      [9, 'INFO', 'info'],
      [9, 'INFO', 'log'],
      [13, 'WARN', 'warn'],
      [17, 'ERROR', 'error'],
    ] as const
  ).map(([severityNumber, severityText, method]) => {
    const original = console[method];
    const write = original.bind(console);
    console[method] = (...args) => {
      write(...args);
      logger.emit({
        timestamp: performance.timeOrigin + performance.now(),
        severityNumber,
        severityText,
        eventName: 'browser.console',
        body: toString(args),
        attributes: { 'browser.console.method': method },
      });
    };
    return () => (console[method] = original);
  });

  return {
    dispose() {
      for (const restore of restores) restore();
    },
  };
}
