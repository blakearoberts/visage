FROM node:24-alpine AS build

ARG WORKSPACE=packages/oauth2-proxy-operator
ARG PROJECT=@blakearoberts/oauth2-proxy-operator
WORKDIR /app
COPY package-lock.json package.json ./
COPY ${WORKSPACE}/package.json ./${WORKSPACE}/package.json
COPY ${WORKSPACE}/tsconfig.build.json ./${WORKSPACE}/tsconfig.build.json
COPY ${WORKSPACE}/src ./${WORKSPACE}/src
RUN npm ci --workspace ${PROJECT} --include-workspace-root=false
RUN npm run build --workspace ${PROJECT}
RUN npm prune --omit=dev --workspace ${PROJECT} --include-workspace-root=false

FROM node:24-alpine

ARG WORKSPACE=packages/oauth2-proxy-operator
WORKDIR /app
ENV NODE_ENV=production
COPY package-lock.json package.json ./
COPY ${WORKSPACE}/package.json ./${WORKSPACE}/package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/${WORKSPACE}/dist ./${WORKSPACE}/dist
CMD ["node", "packages/oauth2-proxy-operator/dist/operator.js"]
