FROM node:22-bookworm-slim AS build
ARG NODE_ENV
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/workspace-controller/package.json packages/workspace-controller/package.json
COPY packages/workspace-daemon/package.json packages/workspace-daemon/package.json
COPY server/package.json server/package.json
# Build tooling is a dev dependency. Install it even when a platform injects
# NODE_ENV=production as a build argument.
RUN npm ci --include=dev
COPY packages/contracts packages/contracts
COPY server server
RUN npm run build -w @pulpo/contracts && npm run build -w @pulpo/server

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/workspace-controller/package.json packages/workspace-controller/package.json
COPY packages/workspace-daemon/package.json packages/workspace-daemon/package.json
COPY server/package.json server/package.json
RUN npm ci --omit=dev
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/drizzle server/drizzle
USER node
CMD ["npm", "run", "start:api", "-w", "@pulpo/server"]
