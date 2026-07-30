# syntax=docker/dockerfile:1

ARG FAAS_CLI_VERSION=0.18.12

FROM ghcr.io/openfaas/faas-cli:${FAAS_CLI_VERSION} AS faas-cli

FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY client/package.json client/package-lock.json ./
RUN npm ci

COPY client/ ./
RUN npm run build

FROM node:22-bookworm-slim AS templates
WORKDIR /templates

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

COPY --from=faas-cli /usr/bin/faas-cli /usr/local/bin/faas-cli
RUN faas-cli template store pull node24 \
    && faas-cli template store pull golang-middleware \
    && faas-cli template store pull python3-http

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=faas-cli /usr/bin/faas-cli /usr/local/bin/faas-cli
COPY client/package.json client/package-lock.json ./
RUN npm ci --omit=dev \
    && npm cache clean --force

COPY client/server.js client/auth.js ./
COPY --from=build /app/dist ./dist
# Cache the function template in the image so startup does not depend on GitHub.
COPY --from=templates --chown=node:node /templates ./templates

USER node
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3001/healthz').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"]

CMD ["node", "server.js"]
