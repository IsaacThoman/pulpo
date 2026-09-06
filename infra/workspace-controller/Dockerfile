FROM node:24.18.1-bookworm-slim AS build
WORKDIR /app
COPY packages/workspace-controller/package.json packages/workspace-controller/tsconfig.json ./
RUN npm install --include=dev --ignore-scripts
COPY packages/workspace-controller/src ./src
RUN npm test && npm run build

FROM node:24.18.1-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8786
COPY packages/workspace-controller/package.json ./
RUN npm install --omit=dev --ignore-scripts
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8786
CMD ["node", "dist/index.js"]
