# syntax=docker/dockerfile:1.18
# LibreOffice behind a small HTTP API, for converting untrusted office documents.
# See README.md for the security model and how to run it.

FROM node:24.22.1-trixie-slim AS build
WORKDIR /src
COPY packages/office-converter/package.json packages/office-converter/tsconfig.json ./
RUN npm install --include=dev --ignore-scripts
COPY packages/office-converter/src ./src
COPY packages/office-converter/fixtures ./fixtures
RUN npm run build \
    && find dist -name '*.test.js' -delete \
    && rm -rf dist/testing

FROM node:24.22.1-trixie-slim AS runtime

LABEL org.opencontainers.image.title="Pulpo Office Converter" \
      org.opencontainers.image.description="Locked-down LibreOffice conversion service for Pulpo Files" \
      org.opencontainers.image.source="https://github.com/IsaacThoman/pulpo" \
      org.opencontainers.image.licenses="MIT AND MPL-2.0"

# The -nogui packages leave out the desktop UI; the import filters (including WordPerfect
# and Apple iWork) come with them. Metric-compatible fonts keep Office layouts in place:
# Carlito for Calibri, Caladea for Cambria, Liberation for Arial/Times/Courier.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libreoffice-writer-nogui \
        libreoffice-calc-nogui \
        libreoffice-impress-nogui \
        fonts-crosextra-carlito \
        fonts-crosextra-caladea \
        fonts-liberation \
        fonts-dejavu-core \
        fonts-noto-core \
        fonts-noto-cjk \
        fonts-noto-color-emoji \
        fontconfig \
        tini \
    && fc-cache --force \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 converter \
    && useradd --uid 10001 --gid 10001 --no-create-home --home-dir /tmp --shell /usr/sbin/nologin converter

WORKDIR /app
ENV NODE_ENV=production \
    HOME=/tmp \
    PORT=8790 \
    OFFICE_CONVERTER_SOFFICE=/usr/bin/soffice \
    OFFICE_CONVERTER_WORK_DIR=/tmp/office-converter \
    OFFICE_CONVERTER_MEMORY_LIMIT_MB=4096

# Runs the unit tests against this LibreOffice; CI builds it with `--target test`.
FROM runtime AS test
COPY --from=build --chown=10001:10001 /src /src
WORKDIR /src
USER 10001:10001
ENV OFFICE_CONVERTER_REQUIRE_SOFFICE=1
RUN npm test

FROM runtime
COPY --from=build /src/package.json ./package.json
COPY --from=build /src/dist ./dist
COPY packages/office-converter/fixtures /opt/office-converter/fixtures
COPY --chmod=0755 infra/office-converter/smoke-test.mjs /usr/local/bin/office-converter-smoke-test
USER 10001:10001
EXPOSE 8790
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8790) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# LibreOffice processes orphaned by a killed job are re-parented to PID 1; tini reaps them.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
