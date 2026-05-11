# Managed Service Example

## System Block Diagram

```mermaid
flowchart LR
  Browser
  NGINX
  Oauth2-Proxy
  Vite
  Dex
  Whoami

  Browser --> NGINX
  NGINX --> Oauth2-Proxy
  Oauth2-Proxy --> Dex
  NGINX --> Vite
  NGINX --> Whoami
```
