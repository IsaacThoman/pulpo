FROM node:22-bookworm-slim AS build
ARG NODE_ENV
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/client-core/package.json packages/client-core/package.json
COPY packages/workspace-controller/package.json packages/workspace-controller/package.json
COPY packages/workspace-daemon/package.json packages/workspace-daemon/package.json
# Build tooling is a dev dependency. Install it even when a platform injects
# NODE_ENV=production as a build argument.
RUN npm ci --include=dev
COPY packages/contracts packages/contracts
COPY packages/client-core packages/client-core
COPY apps/server apps/server
RUN npm run build -w @pulpo/contracts && npm run build -w @pulpo/client-core && npm run build -w @pulpo/server

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/client-core/package.json packages/client-core/package.json
COPY packages/workspace-controller/package.json packages/workspace-controller/package.json
COPY packages/workspace-daemon/package.json packages/workspace-daemon/package.json
RUN npm ci --omit=dev
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/packages/client-core/dist packages/client-core/dist
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/server/drizzle apps/server/drizzle
COPY deploy/healthcheck.mjs /app/deploy/healthcheck.mjs
USER node
CMD ["node", "apps/server/dist/api.js"]

FROM runtime AS production-worker
ENV PULPO_WORKER_HEALTH_PORT=3000
HEALTHCHECK --interval=5s --timeout=3s --start-period=30s --retries=120 CMD node /app/deploy/healthcheck.mjs
CMD ["node", "apps/server/dist/worker.js"]

FROM runtime AS production-api
COPY --chmod=755 deploy/start-api.sh /app/deploy/start-api.sh
HEALTHCHECK --interval=5s --timeout=3s --start-period=30s --retries=120 CMD node /app/deploy/healthcheck.mjs
CMD ["/app/deploy/start-api.sh"]

# Preserve the default image contract for local Compose and PR previews.
FROM runtime AS default
