# syntax=docker/dockerfile:1.7-labs
ARG DENO_VERSION=2.6.3

FROM denoland/deno:bin-${DENO_VERSION} AS deno-bin

FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm --prefix frontend ci

COPY . .

RUN npx prisma generate
RUN npm --prefix frontend run build

FROM node:24-bookworm-slim
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*

COPY --from=deno-bin /deno /usr/local/bin/deno
COPY --from=build /app /app

ENV PORT=8000
EXPOSE 8000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["deno", "run", "--allow-net", "--allow-read", "--allow-env", "--allow-ffi", "main.ts"]
