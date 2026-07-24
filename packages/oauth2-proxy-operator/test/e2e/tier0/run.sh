#!/usr/bin/env bash
set -euo pipefail
source test/e2e/setup.sh

cluster=e2e-0
scratch=test/e2e/.scratch/$cluster
export KUBECONFIG=$scratch/kubeconfig

setup_kind_cluster
install_e2e_stack

kubectl annotate httproute/app \
  oauth2-proxy.operator/issuer=https://issuer.example.test \
  oauth2-proxy.operator/client-id=e2e-client \
  oauth2-proxy.operator/redirect-url=https://app.example.test/oauth2/callback
kubectl wait --for=jsonpath='{.spec.rules[0].backendRefs[0].name}'=oauth2-app httproute/app --timeout=15s

kubectl get deployment oauth2-app >/dev/null
kubectl get secret oauth2-app >/dev/null
kubectl get service oauth2-app >/dev/null
args=$(kubectl get deployment oauth2-app -o jsonpath='{.spec.template.spec.containers[0].args}')
grep -F -- '--oidc-issuer-url=https://issuer.example.test' <<<"$args" >/dev/null
grep -F -- '--client-id=e2e-client' <<<"$args" >/dev/null
grep -F -- '--redirect-url=https://app.example.test/oauth2/callback' <<<"$args" >/dev/null
grep -F -- '--upstream=http://app.default.svc.cluster.local:80' <<<"$args" >/dev/null
test -n "$(kubectl get httproute app -o jsonpath='{.metadata.annotations.oauth2-proxy\.operator/original-rules}')"

kubectl annotate httproute app \
  oauth2-proxy.operator/issuer- \
  oauth2-proxy.operator/client-id- \
  oauth2-proxy.operator/redirect-url-

kubectl wait --for=jsonpath='{.spec.rules[0].backendRefs[0].name}'=app httproute/app --timeout=15s
kubectl wait --for=delete deployment/oauth2-app service/oauth2-app secret/oauth2-app --timeout=15s
test -z "$(kubectl get httproute app -o jsonpath='{.metadata.annotations.oauth2-proxy\.operator/original-rules}')"

echo "Tier 0 E2E passed"
