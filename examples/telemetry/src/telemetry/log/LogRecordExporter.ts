import type {
  InstrumentationScope,
  ReadWriteLogRecord,
  Resource,
} from '../types';

/**
 * An immutable view of a complete log record.
 *
 * @see {@link https://opentelemetry.io/docs/specs/otel/logs/sdk/#readablelogrecord | ReadableLogRecord}
 */
export type ReadableLogRecord = Readonly<ReadWriteLogRecord>;

/**
 * Exports batches of readable log records.
 *
 * @see {@link https://opentelemetry.io/docs/specs/otel/logs/sdk/#logrecordexporter | LogRecordExporter}
 */
export interface LogRecordExporter {
  /**
   * Exports records.
   *
   * @see {@link https://opentelemetry.io/docs/specs/otel/logs/sdk/#export | Export}
   */
  export(records: readonly ReadableLogRecord[]): Promise<boolean>;
}

/**
 * Exports batches of log records using OTLP/HTTP JSON.
 *
 * @see {@link https://opentelemetry.io/docs/specs/otel/logs/sdk/#logrecordexporter | LogRecordExporter}
 * @see {@link https://opentelemetry.io/docs/specs/otlp/#otlphttp | OTLP/HTTP}
 * @see {@link https://opentelemetry.io/docs/specs/otlp/#json-protobuf-encoding | OTLP JSON encoding}
 */
export class OTLPHTTPJSONExporter implements LogRecordExporter {
  constructor(private readonly endpoint: string) {}

  async export(records: readonly ReadableLogRecord[]): Promise<boolean> {
    if (records.length === 0) return true;

    const resources = new Map<
      Resource,
      Map<InstrumentationScope, OTLPLogRecord[]>
    >();
    for (const record of records) {
      let scopes = resources.get(record.resource);
      if (scopes === undefined) {
        scopes = new Map();
        resources.set(record.resource, scopes);
      }
      let scope = scopes.get(record.instrumentationScope);
      if (scope === undefined) {
        scope = [];
        scopes.set(record.instrumentationScope, scope);
      }
      scope.push(toOTLPLogRecord(record));
    }

    const resourceLogs = [];
    for (const [resource, scopes] of resources) {
      const scopeLogs = [];
      for (const [scope, logRecords] of scopes) {
        scopeLogs.push({ scope, logRecords });
      }
      resourceLogs.push({
        resource: { attributes: toAttributes(resource.attributes) },
        scopeLogs,
      });
    }
    const body = new Blob([JSON.stringify({ resourceLogs })], {
      type: 'application/json',
    });
    return navigator.sendBeacon(this.endpoint, body);
  }
}

type OTLPLogRecord = ReturnType<typeof toOTLPLogRecord>;
function toOTLPLogRecord(record: ReadableLogRecord) {
  return {
    timeUnixNano: toUnixNano(record.timestamp),
    observedTimeUnixNano: toUnixNano(record.observedTimestamp),
    severityNumber: record.severityNumber,
    severityText: record.severityText,
    eventName: record.eventName,
    body: { stringValue: record.body },
    attributes: toAttributes(record.attributes),
  } as const;
}

function toAttributes(attributes: Readonly<Record<string, string>>) {
  return Object.entries(attributes).map(([key, stringValue]) => ({
    key,
    value: { stringValue },
  }));
}

function toUnixNano(timeMs: number): string {
  const milliseconds = Math.trunc(timeMs);
  const fractional = Math.round((timeMs - milliseconds) * 1_000_000);
  return (BigInt(milliseconds) * 1_000_000n + BigInt(fractional)).toString();
}
