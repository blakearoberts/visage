# Tier 1 E2E

Runs the local Gateway API and Dex authentication path in a fresh kind cluster.

Use `npm run test:e2e:tier1 --workspace @blakearoberts/oauth2-proxy-operator` to
verify that traffic enters through the Gateway, reaches Dex for login, returns
through oauth2-proxy, and reuses the session cookie on a second request.

## System Block Diagram

```mermaid
flowchart LR
  script([Script test/e2e/tier1])
  controller[Gateway API Controller]

  subgraph cluster[Cluster]
    crds[Gateway API CRDs]
    operator[Deployment/oauth2-proxy-operator]
    proxy[Deployment/app-oauth2-proxy]
    gateway[Gateway/app]
    route[HTTPRoute/app]
    dexRoute[HTTPRoute/dex]
    dex[Deployment/dex]
    app[Deployment/app]
  end

  script --creates--> cluster
  script --installs--> controller
  script --installs--> operator
  script --installs--> gateway
  script --installs--> dex
  script --installs--> dexRoute
  script --installs--> app

  controller --installs--> crds

  operator --reconciles--> route
  operator --manages--> proxy

  gateway -.routes /.-> route
  gateway -."routes /dex".-> dexRoute
  route -.routes (unprotected).-> app
  route -.routes (protected).-> proxy
  proxy -.routes (protected).-> app
  proxy <-.authenticates/validates.-> dex
  dexRoute -.routes.-> dex
```
