#!/usr/bin/env bash

gateway_api_version=v1.4.0
image=oauth2-proxy-operator:latest
app_image=oauth2-proxy-operator-test-app:e2e
cpk_image=registry.k8s.io/cloud-provider-kind/cloud-controller-manager:v0.10.0

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

  helm install oauth2-proxy-operator chart --set-string "image=$image"
  helm install app test/e2e/app --set-string "image=$app_image"
  kubectl rollout status deployment/app --timeout=60s
  kubectl rollout status deployment/oauth2-proxy-operator --timeout=60s
}
