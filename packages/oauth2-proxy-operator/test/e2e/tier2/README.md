# Tier 2 E2E

Runs the local session lifecycle and upstream identity check in a fresh kind
cluster.

Use `npm run test:e2e:tier2 --workspace @blakearoberts/oauth2-proxy-operator` to
verify that an authenticated session refreshes without returning to Dex login,
keeps forwarding identity headers, and updates the upstream authorization token.

## System Block Diagram

```mermaid
flowchart LR
  script([Script test/e2e/tier2])
  client([Client])
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
  script --runs--> controller
  script --applies--> crds
  script --applies--> operator
  script --applies--> gateway
  script --applies--> app
  script --patches--> app
  script --installs--> dex
  script --installs--> dexRoute

  controller --programs--> gateway

  operator --reconciles--> route
  operator --manages--> proxy

  client --requests--> gateway
  gateway -.routes (/).-> route
  gateway -.routes (/dex).-> dexRoute
  route -.routes (unprotected).-> app
  route -.routes (protected).-> proxy
  proxy -.routes (protected).-> app
  proxy -.authenticates.-> dex
  proxy -.refreshes session.-> dex
  proxy -.forwards identity.-> app
  dexRoute -.routes.-> dex
```
