# syntax=docker/dockerfile:1.18
FROM node:24.22.1-bookworm-slim AS daemon-build
WORKDIR /src
COPY packages/workspace-daemon/package.json packages/workspace-daemon/tsconfig.json ./
RUN npm install --include=dev
COPY packages/workspace-daemon/src ./src
RUN npm run build

FROM ubuntu:24.04

ARG TARGETARCH
ARG NODE_VERSION=24.22.1
ARG NODE_SHA256_AMD64=6c172a9ab6718f7b801fb5a7bd486af2ee5e32758086a04b84fcce2aa77095e6
ARG NODE_SHA256_ARM64=dbabf7a1cbf947e6059ffad2c27b80041db97dea1e553b62afdee7f13fca336e

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
        ffmpeg \
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
    && printf 'Defaults env_keep += "HTTP_PROXY HTTPS_PROXY http_proxy https_proxy NO_PROXY no_proxy"\n' >> /etc/sudoers.d/agent \
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

# The workspace's screen (`pulpo-desktop`, see desktop/): a virtual display, a window manager, the
# session and accessibility buses, and what the control helper uses from the system Python (not the
# venv above). These layers sit before the files that change often, so a daemon change does not
# rebuild the browser.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        at-spi2-core \
        dbus \
        openbox \
        python3-gi \
        python3-pil \
        python3-xlib \
        x11-utils \
        xdotool \
        xvfb \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Chromium from Playwright, which pins the browser build to its own version and ships it for both
# architectures (Ubuntu's chromium package is a snap stub, and Chrome has no Linux arm64 build).
# Playwright stays installed so agent scripts can drive the browser; `/node_modules` lets
# `import 'playwright'` resolve from any folder. Only the full browser is downloaded: Playwright's
# headless shell is a link to it, which runs it in its own headless mode (as `channel: 'chromium'`
# does) and saves the second copy.
ARG PLAYWRIGHT_VERSION=1.65.1
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pulpo/browsers
RUN npm install --global --no-fund --no-audit --no-update-notifier "playwright@${PLAYWRIGHT_VERSION}" \
    && playwright install --with-deps --no-shell chromium \
    && chromium_directory="$(find "${PLAYWRIGHT_BROWSERS_PATH}" -mindepth 1 -maxdepth 1 -type d -name 'chromium-*' | head -n 1)" \
    && chrome="$(find "${chromium_directory}" -mindepth 2 -maxdepth 2 -type f -name chrome -path '*/chrome-linux*/chrome')" \
    && test -x "${chrome}" \
    && case "${TARGETARCH}" in \
        amd64) shell_folder="chrome-headless-shell-linux64" ;; \
        arm64) shell_folder="chrome-headless-shell-linux-arm64" ;; \
    esac \
    && shell_directory="${PLAYWRIGHT_BROWSERS_PATH}/chromium_headless_shell-${chromium_directory##*-}" \
    && mkdir -p "${shell_directory}/${shell_folder}" \
    && ln -s "${chrome}" "${shell_directory}/${shell_folder}/chrome-headless-shell" \
    && touch "${shell_directory}/INSTALLATION_COMPLETE" "${shell_directory}/DEPENDENCIES_VALIDATED" \
    && install --directory --mode=0755 /opt/pulpo/desktop /node_modules \
    && ln -s "${chrome}" /opt/pulpo/desktop/chrome \
    && ln -s /usr/local/lib/node_modules/playwright /node_modules/playwright \
    && chown -R agent:agent "${PLAYWRIGHT_BROWSERS_PATH}" \
    && npm cache clean --force \
    && rm -rf /root/.npm /root/.cache /tmp/* \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY infra/workspace-image/desktop/control.py infra/workspace-image/desktop/openbox.xml /opt/pulpo/desktop/
COPY --chmod=0755 infra/workspace-image/desktop/pulpo-desktop infra/workspace-image/desktop/chromium /usr/local/bin/
COPY infra/workspace-image/desktop/profile.sh /etc/profile.d/pulpo-desktop.sh
# VERSION tells the daemon that this image has a screen.
RUN ln -s chromium /usr/local/bin/chromium-browser \
    && ln -s chromium /usr/local/bin/google-chrome \
    && echo 1 > /opt/pulpo/desktop/VERSION

COPY infra/workspace-image/scripts/desktop-smoke-test.py /opt/pulpo/desktop-smoke-test.py
COPY --chmod=0755 infra/workspace-image/scripts/smoke-test.sh /usr/local/bin/pulpo-workspace-smoke-test
COPY --from=daemon-build /src/dist /opt/pulpo-workspace-daemon
# `pulpo files` / `pulpo computer` let agent bash commands reach the chat's Files, or a folder the user shared from
# their computer, through the daemon's relay socket.
RUN printf '#!/bin/sh\nexec /usr/local/bin/node /opt/pulpo-workspace-daemon/cli.js "$@"\n' > /usr/local/bin/pulpo \
    && chmod 0755 /usr/local/bin/pulpo

ENV DEBIAN_FRONTEND=
USER agent
WORKDIR /workspace

ENV PORT=8787 \
    PULPO_WORKSPACE_ROOT=/workspace
EXPOSE 8787
CMD ["node", "/opt/pulpo-workspace-daemon/index.js"]
