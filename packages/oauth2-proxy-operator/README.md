# OAuth2 Proxy Operator

OAuth2 Proxy Operator watches annotated Gateway API `HTTPRoute` resources and
places `oauth2-proxy` in front of protected application services. It keeps the
opt-in surface small: issuer, client ID, redirect URL, and optional client
secret reference. The MVP favors OIDC discovery, PKCE public clients, and no
project-local CRDs.

## System Diagram

```mermaid
---
config:
  flowchart:
    curve: monotoneX
---
flowchart LR
  browser(["Browser"])
  issuer["OIDC Issuer"]

  subgraph cluster["Kubernetes Cluster"]
    operator["OAuth2 Proxy Operator"]
    gateway["Gateway"]
    route["Annotated HTTPRoute"]

    subgraph protected["Protected Application Boundary"]
      proxy["Managed OAuth2 Proxy"]
      app["Application"]
    end
  end

  browser --> gateway
  gateway ---> route
  route --> proxy
  proxy --> app
  proxy --->|refresh| issuer
  browser -->|signin| issuer
  operator -..->|patches| route
  operator -.->|creates| proxy
```
