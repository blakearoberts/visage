# Remove this wrapper once Grafana supports provisioning repositories from mounted manifests:
# https://github.com/grafana/grafana/pull/126549
FROM grafana/otel-lgtm

COPY repository.yaml /tmp/repository.yaml

RUN <<'SH'
set -e
mkdir -p /otel-lgtm/visage/dashboards
GF_PATHS_PERMITTED_PROVISIONING_PATHS=/otel-lgtm/visage/dashboards ./run-grafana.sh &
curl --fail --silent --show-error --retry 30 --retry-connrefused --retry-delay 1 \
  http://127.0.0.1:3000/api/health
curl --fail --silent --show-error --request PATCH --header 'Content-Type: application/apply-patch+yaml' \
  --data-binary @/tmp/repository.yaml \
  'http://127.0.0.1:3000/apis/provisioning.grafana.app/v0alpha1/namespaces/default/repositories/repo?fieldManager=visage'
SH
