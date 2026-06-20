# Tier 0 E2E

Run with
`npm run test:e2e:tier0 --workspace @blakearoberts/oauth2-proxy-operator`.

This test validates the minimum operator control loop by asserting:

- annotated `HTTPRoute` is rewritten to direct traffic through oauth2-proxy,
- managed oauth2-proxy resources are created to service traffic through the
  annotated `HTTPRoute`,
- removing the `HTTPRoute` annotations restores the original routes and deletes
  the managed oauth2-proxy resources.

## System Block Diagram

```mermaid
flowchart LR
  script([Script test/e2e/tier0])

  controller[Gateway API Controller]

  subgraph cluster[Cluster]
    crds[Gateway API CRDs]
    operator[Deployment/oauth2-proxy-operator]
    proxy[Deployment/app-oauth2-proxy]
    gateway[Gateway/app]
    route[HTTPRoute/app]
    app[Deployment/app]
  end

  script --creates--> cluster
  script --installs--> controller
  script --installs--> operator
  script --installs--> gateway
  script --installs--> app

  controller --installs--> crds

  operator --reconciles--> route
  operator --manages--> proxy
```
