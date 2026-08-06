# Telemetry

Visage should provide first-class, opt-in configuration for telemetry emitted by
its managed NGINX and OAuth2 Proxy services. The
[telemetry example](../examples/telemetry) proves the integration, but Visage
could do better to support configuration of telemetry signals out-of-the-box.

## Traces

Current state:

- `otel.conf` hard-codes context propagation and the
  `ParentBased(root=AlwaysOff)` sampling policy.
- Visage defaults resource attributes for access spans:
  - `service.name`: The value, `nginx`.
  - `service.namespace`: The consumer's exact npm package name.
  - `service.instance.id`: The Docker container ID provided through `HOSTNAME`.
  - `service.version`: The value of `NGINX_VERSION`.

Desired state:

- Visage supports configuring the NGINX otel module.

## Metrics

Current state:

- OAuth2 Proxy always receives `metrics_address = "0.0.0.0:4181"`, even when
  nothing scrapes it.
- The telemetry example's collector scrapes that listener through the shared
  NGINX network namespace at `nginx:4181` and exports the metrics to Prometheus.

Desired state:

- Visage supports configuring OAuth2 Proxy metrics.
- Visage supports converting NGINX spans to metrics.
- Visage supports converting OAuth2 Proxy logs to metrics.

## Logs

Current state:

- Compose lifecycle output is written to `logs/compose.log`; joined container
  output is followed into `logs/container.log`.
- Plugin mode places these under `<Vite cacheDir>/visage`, while server mode
  uses `<cwd>/.visage`.
- NGINX access logs and OAuth2 Proxy request logs use hard-coded, aligned
  formats for skimming the joined file.
- Request URLs are persisted without redacting sensitive query values such as
  OIDC authorization codes. Logs are not exported through OpenTelemetry.

Desired state:

- Log location, format, and collection are explicit and consistent across plugin
  and server modes.
- Sensitive values are redacted before persistence, with structured,
  collector-friendly output available for application-owned pipelines.
- Visage supports exporting container logs of Visage managed services.
