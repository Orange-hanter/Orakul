# syntax=docker/dockerfile:1.7
# Multi-stage build for Orakul Pilot App.
# Final image: ~80MB (node:20-alpine + prod deps + built client + server.js).

ARG NODE_VERSION=20.18-alpine

# ── Stage 1: client deps (cached unless client/package*.json changes) ──────────
FROM node:${NODE_VERSION} AS client-deps
WORKDIR /build/client
COPY client/package.json client/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

# ── Stage 2: build the Vite client ────────────────────────────────────────────
FROM client-deps AS client-build
COPY client/ ./
RUN npm run build

# ── Stage 3: server prod deps (cached unless package*.json changes) ───────────
FROM node:${NODE_VERSION} AS server-deps
WORKDIR /build/server
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund

# ── Stage 4: minimal runtime ──────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runtime

# tini → proper PID 1 / signal forwarding / zombie reaping. wget for HEALTHCHECK.
RUN apk add --no-cache tini wget && \
    addgroup -S -g 1001 orakul && \
    adduser -S -u 1001 -G orakul orakul

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3001 \
    NPM_CONFIG_UPDATE_NOTIFIER=false

# Order copies cheapest → heaviest so changing server.js doesn't bust npm layers.
COPY --from=server-deps  --chown=orakul:orakul /build/server/node_modules ./node_modules
COPY --from=client-build --chown=orakul:orakul /build/client/dist        ./client/dist
COPY --chown=orakul:orakul package.json server.js crypto.js ./

# data/ is a volume mount — create the dir so the app can write to it.
RUN mkdir -p /app/data && chown orakul:orakul /app/data
VOLUME ["/app/data"]

USER orakul
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3001/ >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
