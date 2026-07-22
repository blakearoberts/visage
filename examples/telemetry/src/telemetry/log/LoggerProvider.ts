import type {
  Attributes,
  InstrumentationScope,
  ReadWriteLogRecord,
  Resource,
} from '../types';
import type { LogRecordProcessor } from './LogRecordProcessor';

/**
 * A log record accepted by a Logger's emit operation.
 *
 * @see {@link https://opentelemetry.io/docs/specs/otel/logs/api/#emit-a-logrecord | Emit a LogRecord}
 */
export type LogRecord = {
  readonly timestamp: number;
  readonly observedTimestamp?: number;
  readonly severityNumber: number;
  readonly severityText: string;
  readonly eventName: string;
  readonly body: string;
  readonly attributes: Attributes;
  readonly resource?: Resource;
  readonly instrumentationScope?: InstrumentationScope;
};

/**
 * Emits log records through the configured logging pipeline.
 *
 * @see {@link https://opentelemetry.io/docs/specs/otel/logs/api/#logger | Logger}
 */
export interface Logger {
  /**
   * Emits a log record.
   *
   * @see {@link https://opentelemetry.io/docs/specs/otel/logs/api/#emit-a-logrecord | Emit a LogRecord}
   */
  emit(logRecord: LogRecord): void;
}

/**
 * The entry point for obtaining named loggers.
 *
 * @see {@link https://opentelemetry.io/docs/specs/otel/logs/api/#loggerprovider | LoggerProvider}
 */
export interface LoggerProvider {
  logger(name: string): Logger;
}

/**
 * Creates a LoggerProvider for a resource and processor.
 *
 * @see {@link https://opentelemetry.io/docs/specs/otel/logs/sdk/#loggerprovider-creation | LoggerProvider creation}
 */
export function createLoggerProvider(
  resource: Resource,
  processor: LogRecordProcessor,
): LoggerProvider {
  return {
    logger(name) {
      const instrumentationScope = { name } as const;
      return {
        emit: (logRecord) => {
          processor.onEmit(
            {
              ...logRecord,
              observedTimestamp: Date.now(),
              resource,
              instrumentationScope,
            } satisfies ReadWriteLogRecord,
            undefined,
          );
        },
      };
    },
  };
}

let globalLoggerProvider: LoggerProvider = {
  logger: () => ({ emit() {} }), // no-op
};

/**
 * Returns the global LoggerProvider.
 *
 * @see {@link https://opentelemetry.io/docs/specs/otel/logs/api/#loggerprovider | LoggerProvider}
 */
export function getGlobalLoggerProvider(): LoggerProvider {
  return globalLoggerProvider;
}

/**
 * Sets the global LoggerProvider.
 *
 * @see {@link https://opentelemetry.io/docs/specs/otel/logs/api/#loggerprovider | LoggerProvider}
 */
export function setGlobalLoggerProvider(loggerProvider: LoggerProvider): void {
  globalLoggerProvider = loggerProvider;
}
