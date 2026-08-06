FROM nginx:1.31.3-alpine

ARG OTEL_MODULE_VERSION=0.1.2

ENV NGINX_ENVSUBST_OUTPUT_DIR=/etc/nginx/http.d

RUN set -eux; \
    alpine_version="$(cut -d. -f1,2 /etc/alpine-release)"; \
    apk add --no-cache \
      --repository "https://nginx.org/packages/mainline/alpine/v${alpine_version}/main" \
      "nginx-module-otel=${NGINX_VERSION}.${OTEL_MODULE_VERSION}-r${DYNPKG_RELEASE}"; \
    mkdir -p "$NGINX_ENVSUBST_OUTPUT_DIR"
