import type { ReadWriteLogRecord } from '../types';
import type { LogRecordExporter, ReadableLogRecord } from './LogRecordExporter';

/**
 * Hooks invoked while log records pass through a logging pipeline.
 *
 * @see {@link https://opentelemetry.io/docs/specs/otel/logs/sdk/#logrecordprocessor | LogRecordProcessor}
 */
export interface LogRecordProcessor {
  onEmit(logRecord: ReadWriteLogRecord, context: unknown): void;
  shutdown(): Promise<void>;
  forceFlush(): Promise<void>;
}

/**
 * Configuration for a BatchLogRecordProcessor.
 *
 * @see {@link https://opentelemetry.io/docs/specs/otel/logs/sdk/#batching-processor | Batching processor}
 */
export interface BatchLogRecordProcessorOptions {
  /**
   * Maximum queued records before newly emitted records are dropped.
   *
   * @defaultValue `2048`
   */
  readonly maxQueueSize?: number;
  /**
   * Milliseconds between scheduled exports.
   *
   * @defaultValue `1000`
   */
  readonly scheduledDelayMillis?: number;
  /**
   * Milliseconds before an export is cancelled.
   *
   * @defaultValue `30000`
   */
  readonly exportTimeoutMillis?: number;
  /**
   * Maximum records included in one export. Must not exceed maxQueueSize.
   *
   * @defaultValue `512`
   */
  readonly maxExportBatchSize?: number;
}

/**
 * Batches log records and exports them through a LogRecordExporter.
 *
 * @see {@link https://opentelemetry.io/docs/specs/otel/logs/sdk/#batching-processor | Batching processor}
 */
export class BatchLogRecordProcessor implements LogRecordProcessor {
  readonly #queue: ReadableLogRecord[] = [];
  readonly #flushInterval: number;
  readonly #maxQueueSize: number;
  readonly #exportTimeoutMillis: number;
  readonly #maxExportBatchSize: number;
  #flushTask: Promise<boolean> | undefined;

  constructor(
    private readonly exporter: LogRecordExporter,
    options: BatchLogRecordProcessorOptions = {},
  ) {
    this.#maxQueueSize = options.maxQueueSize ?? 2048;
    this.#exportTimeoutMillis = options.exportTimeoutMillis ?? 30_000;
    this.#maxExportBatchSize = options.maxExportBatchSize ?? 512;
    if (this.#maxExportBatchSize > this.#maxQueueSize) {
      throw new RangeError('maxExportBatchSize must not exceed maxQueueSize');
    }
    this.#flushInterval = window.setInterval(
      () => void this.#synchronizedFlush(),
      options.scheduledDelayMillis ?? 1000,
    );
  }

  onEmit(logRecord: ReadWriteLogRecord): void {
    if (this.#queue.length >= this.#maxQueueSize) return;
    this.#queue.push(logRecord);
  }

  async shutdown(): Promise<void> {
    window.clearInterval(this.#flushInterval);
    await this.forceFlush();
  }

  async forceFlush(): Promise<void> {
    while (this.#queue.length > 0) {
      if (!(await this.#synchronizedFlush())) return;
    }
  }

  #synchronizedFlush(): Promise<boolean> {
    return (this.#flushTask ??= this.#flush().finally(
      () => (this.#flushTask = undefined),
    ));
  }

  async #flush(): Promise<boolean> {
    const records = this.#queue.slice(0, this.#maxExportBatchSize);
    if (records.length === 0) return true;

    let timeoutId: number | undefined;
    const exportTimeout = new Promise<false>((resolve) => {
      timeoutId = window.setTimeout(
        () => resolve(false),
        this.#exportTimeoutMillis,
      );
    });
    try {
      const exported = await Promise.race([
        this.exporter.export(records),
        exportTimeout,
      ]);
      if (exported) this.#queue.splice(0, records.length);
      return exported;
    } catch {
      return false;
    } finally {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    }
  }
}
