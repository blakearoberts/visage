# Telemetry

Visage should provide first-class, opt-in configuration for telemetry emitted by
its managed NGINX and OAuth2 Proxy services. Applications should own collectors,
storage, dashboards, and products such as Grafana. The
[telemetry example](../examples/telemetry) proves the integration, but several
Visage-side seams remain hard-coded.

## Traces

Current state:

- The NGINX renderer hard-codes the njs `load_module` directive and a wildcard
  `include /etc/nginx/http.d/*.conf;`. It cannot declare explicit additional
  modules or named configuration files.
- The telemetry example builds a custom NGINX image that installs the OTel
  module, loads it from the image command, and copies in `otel.conf`.
- `otel.conf` hard-codes the collector endpoint, service name, context
  propagation, and `ParentBased(root=AlwaysOff)` sampling policy.
- The custom image is built on demand and is not published by this project. Its
  base image is outside the Docker Compose manifest covered by Dependabot.

Desired state:

- Visage explicitly configures opt-in NGINX tracing, including the module,
  collector endpoint, resource identity, propagation, and sampling policy.
- Additional NGINX configuration is expressed as explicit files instead of a
  global wildcard include.
- Collector and tracing-backend configuration remains application-owned.

## Metrics

Current state:

- OAuth2 Proxy always receives `metrics_address = "0.0.0.0:4181"`, even when
  nothing scrapes it.
- The telemetry example's collector scrapes that listener through the shared
  NGINX network namespace at `nginx:4181` and exports the metrics to Prometheus.

Desired state:

- Visage has an explicit option for enabling and configuring OAuth2 Proxy
  metrics, and exposes the resulting scrape target to consumers.
- Visage does not configure Prometheus, collectors, or dashboards.

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
