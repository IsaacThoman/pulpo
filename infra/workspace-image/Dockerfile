# syntax=docker/dockerfile:1.18
FROM node:24.18.1-bookworm-slim AS daemon-build
WORKDIR /src
COPY packages/workspace-daemon/package.json packages/workspace-daemon/tsconfig.json ./
RUN npm install --include=dev
COPY packages/workspace-daemon/src ./src
RUN npm run build

FROM ubuntu:24.04

ARG TARGETARCH
ARG NODE_VERSION=24.18.1
ARG NODE_SHA256_AMD64=d6c664df3f3f61458e8c277585571328522d705166723a7c7823a9253a4d15a0
ARG NODE_SHA256_ARM64=7201e3a09dc825bac57867c81913e2b8f0ef87d04cb9082af4cda82f6ff3d88c

LABEL org.opencontainers.image.title="Pulpo Agent Workspace" \
      org.opencontainers.image.description="Disposable Ubuntu workspace for Pulpo agent sandboxes" \
      org.opencontainers.image.source="https://github.com/IsaacThoman/pulpo" \
      org.opencontainers.image.licenses="MIT"

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash \
        build-essential \
        ca-certificates \
        curl \
        git \
        jq \
        openssh-client \
        pkg-config \
        poppler-utils \
        python3 \
        python3-pip \
        python3-venv \
        ripgrep \
        sudo \
        unzip \
        wget \
        xz-utils \
        zsh \
    && case "${TARGETARCH}" in \
        amd64) node_arch="x64"; node_sha256="${NODE_SHA256_AMD64}" ;; \
        arm64) node_arch="arm64"; node_sha256="${NODE_SHA256_ARM64}" ;; \
        *) echo "Unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && node_archive="node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" \
    && curl --fail --location --silent --show-error \
        "https://nodejs.org/dist/v${NODE_VERSION}/${node_archive}" \
        --output "/tmp/${node_archive}" \
    && echo "${node_sha256}  /tmp/${node_archive}" | sha256sum --check --strict - \
    && tar --extract --file="/tmp/${node_archive}" --directory=/usr/local --strip-components=1 \
    && rm -f "/tmp/${node_archive}" \
    && existing_user="$(getent passwd 1000 | cut -d: -f1)" \
    && if [ -n "${existing_user}" ]; then userdel "${existing_user}"; rm -rf "/home/${existing_user}"; fi \
    && existing_group="$(getent group 1000 | cut -d: -f1)" \
    && if [ -n "${existing_group}" ]; then groupdel "${existing_group}"; fi \
    && groupadd --gid 1000 agent \
    && useradd --uid 1000 --gid 1000 --create-home --shell /bin/bash agent \
    && install --directory --owner=agent --group=agent --mode=0755 /workspace \
    && printf 'agent ALL=(ALL) NOPASSWD: ALL\n' > /etc/sudoers.d/agent \
    && chmod 0440 /etc/sudoers.d/agent \
    && visudo --check \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Keep the runtime environment in an image layer; each sandbox gets its own
# writable copy. Never share session-modified environments between users.
COPY infra/workspace-image/requirements.txt /opt/pulpo/requirements.txt
RUN python3 -m venv /opt/pulpo/python \
    && /opt/pulpo/python/bin/pip install --no-cache-dir --only-binary=:all: -r /opt/pulpo/requirements.txt \
    && /opt/pulpo/python/bin/pip check \
    && chown -R agent:agent /opt/pulpo/python \
    && for executable in python python3 pip pip3; do \
        printf '#!/bin/sh\nexec /opt/pulpo/python/bin/%s "$@"\n' "$executable" > /usr/local/bin/$executable; \
        chmod 0755 /usr/local/bin/$executable; \
    done

COPY infra/workspace-image/scripts/package-inventory.py /opt/pulpo/package-inventory.py
RUN /opt/pulpo/python/bin/python /opt/pulpo/package-inventory.py > /opt/pulpo/PACKAGES.md
COPY infra/workspace-image/scripts/package-smoke-test.py /opt/pulpo/package-smoke-test.py

COPY --chmod=0755 infra/workspace-image/scripts/smoke-test.sh /usr/local/bin/pulpo-workspace-smoke-test
COPY --from=daemon-build /src/dist /opt/pulpo-workspace-daemon

ENV DEBIAN_FRONTEND=
USER agent
WORKDIR /workspace

ENV PORT=8787 \
    PULPO_WORKSPACE_ROOT=/workspace
EXPOSE 8787
CMD ["node", "/opt/pulpo-workspace-daemon/index.js"]
