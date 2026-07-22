/**
 * An immutable collection of telemetry attributes.
 *
 * @see {@link https://opentelemetry.io/docs/specs/otel/common/#attribute-collections | Attribute Collections}
 */
export type Attributes = Readonly<Record<string, string>>;

/**
 * A mutable log record processed during emission.
 *
 * @see {@link https://opentelemetry.io/docs/specs/otel/logs/sdk/#readwritelogrecord | ReadWriteLogRecord}
 */
export type ReadWriteLogRecord = {
  timestamp: number;
  observedTimestamp: number;
  severityNumber: number;
  severityText: string;
  eventName: string;
  body: string;
  attributes: Attributes;
  resource: Resource;
  instrumentationScope: InstrumentationScope;
};

/**
 * An immutable representation of the entity for which telemetry is produced.
 *
 * @see {@link https://opentelemetry.io/docs/specs/otel/resource/sdk/ | Resource SDK}
 */
export type Resource = {
  readonly attributes: Attributes;
};

/**
 * An immutable logical unit of software associated with emitted telemetry.
 *
 * @see {@link https://opentelemetry.io/docs/specs/otel/common/instrumentation-scope/ | Instrumentation Scope}
 */
export type InstrumentationScope = {
  readonly name: string;
};
