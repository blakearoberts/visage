# Telemetry Example

This example demonstrates how to configure a full stack telemetry pipeline with
an authenticated Grafana frontend, and protected OTLP HTTP JSON export endpoints
for browser telemetry signals. Visage acts as the relying party between the
browser user-agent and the IdP, Dex. Visage forwards identity headers to
Grafana; Grafana is configured to trust the headers as user identity for
authorization.

## System Block Diagram

```mermaid
flowchart LR
  subgraph network["NGINX shared network (Docker network)"]
    NGINX --> Oauth2-Proxy
  end

  browser([Browser]) ==> network
  NGINX ===> vite([Vite])
  NGINX --> idp([Dex])
  Oauth2-Proxy --> idp

  subgraph "LGTM (Docker container)"
    storage[(Loki / Tempo / Mimir)]
    otelcol[OpenTelemetry Collector]
    otelcol -.->|exports</br>telemetry| storage
    Grafana -.->|queries</br>telemetry| storage
  end

  NGINX --> Grafana
  network -.->|exports</br>logs / traces| otelcol
  otelcol -...->|scrapes</br>metrics| network
```

## Next Steps (TO-DO)

Visage supports out-of-the-box configuration to enable reporting and forwarding
of internal telemetry signals, and configuration of protected OTLP HTTP JSON
export endpoints for browser session integration.

```mermaid
flowchart LR
  subgraph network["NGINX shared network (Docker network)"]
    NGINX --> Oauth2-Proxy
    NGINX -.->|exports</br>logs / traces| otelcol[OpenTelemetry Collector]
    otelcol -..->|scrapes</br>metrics| NGINX
  end

  browser([Browser]) ==> network
  NGINX ====> vite([Vite])
  NGINX --> idp([Dex])
  Oauth2-Proxy ---> idp
  otelcol -..->|exports</br>telemetry| tp(["OTLP Compatible Telemetry Provider (LGTM)"])
```
