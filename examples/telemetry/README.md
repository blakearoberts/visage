# Telemetry Example

## System Block Diagram

```mermaid
flowchart LR
  Browser
  NGINX
  Oauth2-Proxy
  Vite
  Dex

  Browser --> NGINX
  NGINX --> Oauth2-Proxy
  Oauth2-Proxy --> Dex
  NGINX --> Vite
```
