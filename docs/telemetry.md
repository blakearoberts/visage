# Telemetry

Visage should provide first-class, opt-in configuration for telemetry emitted by
its managed NGINX and OAuth2 Proxy services. The
[telemetry example](../examples/telemetry) proves the integration, but Visage
could do better to support configuration of telemetry signals out-of-the-box.

## Traces

Current state:

- The NGINX renderer hard-codes the njs `load_module` directive and a wildcard
  `include /etc/nginx/http.d/*.conf;`. It cannot declare explicit additional
  modules or named configuration files.
- The telemetry example builds a custom NGINX image that installs and loads the
  OTel module and copies in `otel.conf`.
- The `Publish` workflow publishes a package-owned image from
  `packages/visage/nginx` that installs the module but neither loads nor
  configures it. RCs update its `next` tag, while stable versions publish
  versioned and `latest` tags. Visage does not select that image by default yet.
- `otel.conf` hard-codes the collector endpoint, service name, context
  propagation, and `ParentBased(root=AlwaysOff)` sampling policy.
- The example still builds its local image on demand. Dependabot monitors the
  package-owned image's NGINX base image separately from the Docker Compose
  manifest.

Desired state:

- Visage supports configuring the export of NGINX proxied traffic as spans.
- Additional NGINX configuration is expressed as explicit files instead of a
  global wildcard include.

## Metrics

Current state:

- OAuth2 Proxy always receives `metrics_address = "0.0.0.0:4181"`, even when
  nothing scrapes it.
- The telemetry example's collector scrapes that listener through the shared
  NGINX network namespace at `nginx:4181` and exports the metrics to Prometheus.

Desired state:

- Visage supports configuring the export of OAuth2 Proxy metrics to consumers.
- Visage supports configuring the export of NGINX proxied traffic spans as
  aggregated metrics.

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
