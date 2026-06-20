#!/usr/bin/env bash
set -euo pipefail
source test/e2e/setup.sh

cluster=e2e-2
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
  oauth2-proxy.operator/cookie-expire=2m \
  oauth2-proxy.operator/cookie-refresh=5s \
  oauth2-proxy.operator/cookie-secure=false \
  oauth2-proxy.operator/pass-authorization-header=true \
  --overwrite
kubectl wait --for=jsonpath='{.spec.rules[0].backendRefs[0].name}'=oauth2-app httproute/app --timeout=15s
route_generation=$(kubectl get httproute/app -o jsonpath='{.metadata.generation}')
kubectl wait --for=jsonpath='{.status.parents[0].conditions[?(@.type=="Accepted")].observedGeneration}'="$route_generation" httproute/app --timeout=15s
kubectl wait --for=jsonpath='{.status.parents[0].conditions[?(@.type=="Accepted")].status}'=True httproute/app --timeout=15s
kubectl wait --for=condition=Available deployment/oauth2-app --timeout=60s

args=$(kubectl get deployment oauth2-app -o jsonpath='{.spec.template.spec.containers[0].args}')
grep -F -- '--scope=openid email profile offline_access' <<<"$args" >/dev/null
grep -F -- '--cookie-expire=2m' <<<"$args" >/dev/null
grep -F -- '--cookie-refresh=5s' <<<"$args" >/dev/null
grep -F -- '--cookie-secure=false' <<<"$args" >/dev/null
grep -F -- '--pass-authorization-header=true' <<<"$args" >/dev/null

curl_gateway=(curl --resolve "$host:$port:127.0.0.1")

jar="$scratch/cookies.txt"
login="$scratch/login.html"
initial="$scratch/initial.txt"
refreshed="$scratch/refreshed.txt"
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
  -o "$initial" \
  "$login_url"

grep -Fq 'hello world' "$initial"
grep -Fq 'x-forwarded-email=user@example.com' "$initial"
grep -Fq '_oauth2_proxy' "$jar"
initial_token=$(sed -n 's/^authorization=Bearer //p' "$initial")
test -n "$initial_token"

if ! status=$("${curl_gateway[@]}" -sL --fail-with-body \
  --retry 20 --retry-all-errors --retry-delay 1 \
  -c "$jar" -b "$jar" -G -o "$refreshed" -w '%{http_code}' \
  --data-urlencode "initial=$initial_token" \
  "$base/"); then
  echo "Authorization token did not change after refresh" >&2
  cat "$refreshed" >&2
  exit 1
fi
test "$status" = 200
grep -Fq 'hello world' "$refreshed"
grep -Fq 'x-forwarded-email=user@example.com' "$refreshed"
if grep -Eq 'name="login"|Log in' "$refreshed"; then
  echo "Refresh request showed the Dex login form" >&2
  cat "$refreshed" >&2
  exit 1
fi

refreshed_token=$(sed -n 's/^authorization=Bearer //p' "$refreshed")
test -n "$refreshed_token"
if [ "$initial_token" = "$refreshed_token" ]; then
  echo "Authorization token did not change after refresh" >&2
  cat "$initial" >&2
  cat "$refreshed" >&2
  exit 1
fi

echo "Tier 2 E2E passed: $base"
