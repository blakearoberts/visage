#!/usr/bin/env bash

gateway_api_version=v1.4.0
image=oauth2-proxy-operator:latest
app_image=oauth2-proxy-operator-test-app:e2e

compose_image() {
  MANIFEST=$1 SERVICE=$2 node --input-type=module -e '
    import { readFileSync } from "node:fs";
    import { parse } from "yaml";
    const manifest = parse(readFileSync(process.env.MANIFEST, "utf8"));
    const image = manifest.services[process.env.SERVICE]?.image;
    if (!image) process.exit(1);
    console.log(image);
  '
}

operator_image() {
  compose_image docker-compose.images.yml "$1"
}

visage_image() {
  compose_image ../visage/docker-compose.images.yml "$1"
}

cpk_image=$(operator_image cloud_provider_kind)
oauth2_proxy_image=$(visage_image oauth2_proxy)

image_repository() {
  printf '%s\n' "${1%:*}"
}

image_tag() {
  printf '%s\n' "${1##*:}"
}

cleanup_e2e() {
  if [ -n "${cpk:-}" ] && [ -n "${gateway_label:-}" ]; then
    docker rm -f "$cpk" $(docker ps -aq --filter "label=$gateway_label") >/dev/null 2>&1 || true
  fi

  kind delete cluster --name "$cluster" --kubeconfig "$KUBECONFIG" >/dev/null 2>&1 || true
}

setup_kind_cluster() {
  trap cleanup_e2e EXIT

  mkdir -p "$scratch"
  cleanup_e2e
  kind create cluster --name "$cluster" --kubeconfig "$KUBECONFIG"

  kubectl apply -f "https://github.com/kubernetes-sigs/gateway-api/releases/download/$gateway_api_version/standard-install.yaml"
  kubectl wait --for=condition=Established \
    crd/gatewayclasses.gateway.networking.k8s.io \
    crd/gateways.gateway.networking.k8s.io \
    crd/httproutes.gateway.networking.k8s.io \
    --timeout=10s
}

install_gateway_api() {
  kubectl label node "$cluster-control-plane" node.kubernetes.io/exclude-from-external-load-balancers- >/dev/null 2>&1 || true
  docker run -d --rm \
    --name "$cpk" \
    --network kind \
    -v /var/run/docker.sock:/var/run/docker.sock \
    "$cpk_image" \
    --enable-lb-port-mapping >/dev/null
}

install_e2e_stack() {
  docker build -t "$image" -f Dockerfile ../..
  kind load docker-image "$image" --name "$cluster"
  docker build -t "$app_image" test/e2e/app
  kind load docker-image "$app_image" --name "$cluster"

  helm install oauth2-proxy-operator chart \
    --set-string "image=$image" \
    --set-string "oauth2ProxyImage=$oauth2_proxy_image"
  helm install app test/e2e/app --set-string "image=$app_image"
  kubectl rollout status deployment/app --timeout=60s
  kubectl rollout status deployment/oauth2-proxy-operator --timeout=60s
}
