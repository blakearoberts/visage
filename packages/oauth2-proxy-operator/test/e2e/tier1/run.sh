#!/usr/bin/env bash
set -euo pipefail
source test/e2e/setup.sh

cluster=e2e-1
cpk=kind-$cluster-cpk
gateway_label=io.x-k8s.cloud-provider-kind.gateway.name=$cluster/default/app
host=host.docker.internal
scratch=test/e2e/.scratch/kind-$cluster
export KUBECONFIG=$scratch/kubeconfig

setup_kind_cluster
install_gateway_api
install_e2e_stack
kubectl wait --for=condition=Programmed gateway/app --timeout=30s

gateway_container=$(docker ps --filter "label=$gateway_label" --format '{{.ID}}')
test -n "$gateway_container"
port=$(docker inspect --format '{{with index .NetworkSettings.Ports "80/tcp"}}{{(index . 0).HostPort}}{{end}}' "$gateway_container")
test -n "$port"

base=http://$host:$port

helm install dex dex \
  --repo https://charts.dexidp.io \
  --version 0.24.1 \
  --values test/e2e/dex.values.yaml \
  --set-string "config.issuer=$base/dex" \
  --set-string "config.staticClients[0].redirectURIs[0]=$base/oauth2/callback" \
  --wait \
  --timeout=60s

kubectl annotate httproute/app \
  oauth2-proxy.operator/issuer="$base/dex" \
  oauth2-proxy.operator/client-id=e2e \
  oauth2-proxy.operator/redirect-url="$base/oauth2/callback" \
  oauth2-proxy.operator/cookie-secure=false \
  --overwrite
kubectl wait --for=jsonpath='{.spec.rules[0].backendRefs[0].name}'=oauth2-app httproute/app --timeout=15s
route_generation=$(kubectl get httproute/app -o jsonpath='{.metadata.generation}')
kubectl wait --for=jsonpath='{.status.parents[0].conditions[?(@.type=="Accepted")].observedGeneration}'="$route_generation" httproute/app --timeout=15s
kubectl wait --for=jsonpath='{.status.parents[0].conditions[?(@.type=="Accepted")].status}'=True httproute/app --timeout=15s
kubectl wait --for=condition=Available deployment/oauth2-app --timeout=60s

kubectl get deployment oauth2-app >/dev/null
kubectl get secret oauth2-app >/dev/null
kubectl get service oauth2-app >/dev/null
args=$(kubectl get deployment oauth2-app -o jsonpath='{.spec.template.spec.containers[0].args}')
grep -F -- "--oidc-issuer-url=$base/dex" <<<"$args" >/dev/null
grep -F -- '--client-id=e2e' <<<"$args" >/dev/null
grep -F -- "--redirect-url=$base/oauth2/callback" <<<"$args" >/dev/null
grep -F -- '--cookie-secure=false' <<<"$args" >/dev/null
grep -F -- '--upstream=http://app.default.svc.cluster.local:80' <<<"$args" >/dev/null
test -n "$(kubectl get httproute app -o jsonpath='{.metadata.annotations.oauth2-proxy\.operator/original-rules}')"

curl_gateway=(curl --resolve "$host:$port:127.0.0.1")

jar="$scratch/cookies.txt"
login="$scratch/login.html"
final="$scratch/final.txt"
again="$scratch/again.txt"
printf '' > "$jar"

if ! login_url=$("${curl_gateway[@]}" -sL --fail-with-body \
  --retry 15 --retry-all-errors --retry-delay 1 \
  -c "$jar" -b "$jar" -o "$login" -w '%{url_effective}' \
  "$base/"); then
  echo "Dex login form was not reached" >&2
  cat "$login" >&2
  exit 1
fi
if ! grep -Eq 'name="login"|Log in' "$login"; then
  echo "Dex login form was not reached" >&2
  cat "$login" >&2
  exit 1
fi

"${curl_gateway[@]}" -fsSL -c "$jar" -b "$jar" \
  --data-urlencode login=user@example.com \
  --data-urlencode password=pass \
  -o "$final" \
  "$login_url"

grep -Fq 'hello world' "$final"
grep -Fq '_oauth2_proxy' "$jar"

status=$("${curl_gateway[@]}" -fsSL -c "$jar" -b "$jar" -o "$again" -w '%{http_code}' "$base/")
test "$status" = 200
grep -Fq 'hello world' "$again"
if grep -Eq 'name="login"|Log in' "$again"; then
  echo "Second request showed the Dex login form" >&2
  cat "$again" >&2
  exit 1
fi

kubectl annotate httproute app \
  oauth2-proxy.operator/issuer- \
  oauth2-proxy.operator/client-id- \
  oauth2-proxy.operator/redirect-url- \
  oauth2-proxy.operator/cookie-secure-

kubectl wait --for=jsonpath='{.spec.rules[0].backendRefs[0].name}'=app httproute/app --timeout=15s
kubectl wait --for=delete deployment/oauth2-app service/oauth2-app secret/oauth2-app --timeout=15s
test -z "$(kubectl get httproute app -o jsonpath='{.metadata.annotations.oauth2-proxy\.operator/original-rules}')"

echo "Tier 1 E2E passed: $base"
