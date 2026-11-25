FROM --platform=$BUILDPLATFORM node:26-alpine AS build

COPY package.json package-lock.json tsconfig.base.json /workspace/
COPY packages/visage-nginx/package.json /workspace/packages/visage-nginx/
RUN npm --prefix /workspace ci --workspace packages/visage-nginx --include=dev

COPY packages/visage-nginx/tsconfig.json packages/visage-nginx/tsconfig.build.json /workspace/packages/visage-nginx/
COPY packages/visage-nginx/src/ /workspace/packages/visage-nginx/src/
RUN npm --prefix /workspace run build --workspace packages/visage-nginx

FROM nginx:1.31.9-alpine

ARG OTEL_MODULE_VERSION=0.1.2

ENV NGINX_ENVSUBST_OUTPUT_DIR=/etc/nginx/http.d

COPY --from=build /workspace/packages/visage-nginx/dist/ /etc/nginx/visage/
COPY packages/visage-nginx/nginx/health.conf /etc/nginx/conf.d/health.conf
COPY packages/visage-nginx/nginx/otel.conf.template /etc/nginx/templates/otel.conf.template

RUN set -eux; \
    rm /etc/nginx/conf.d/default.conf; \
    alpine_version="$(cut -d. -f1,2 /etc/alpine-release)"; \
    apk add --no-cache \
      --repository "https://nginx.org/packages/mainline/alpine/v${alpine_version}/main" \
      "nginx-module-otel=${NGINX_VERSION}.${OTEL_MODULE_VERSION}-r${DYNPKG_RELEASE}"; \
    mkdir -p "$NGINX_ENVSUBST_OUTPUT_DIR"

HEALTHCHECK --interval=1s --timeout=1s \
    CMD ["curl", "--fail", "--silent", "--show-error", "http://localhost"]
