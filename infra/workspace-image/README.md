# Pulpo Agent Workspace

This directory builds the disposable Ubuntu filesystem used by Pulpo agent
sandboxes. Kubernetes can run the resulting OCI image in a Kata Containers
pod, giving each Pulpo session a separate lightweight virtual machine.

The image deliberately does **not** include the Pi harness. Pi remains in the
Pulpo worker, where it owns the model loop and Pulpo's provider accounting. The
workspace contains only the operating system, coding tools, and—eventually—the
authenticated Pulpo workspace daemon that executes requested tools.

## Contents

- Ubuntu 24.04 LTS
- Node.js 24.18.1 LTS (Pi requires Node.js 22.19.0 or newer)
- Python 3, Git, ripgrep, curl, compilers, and common shell utilities
- An unprivileged `agent` user with UID/GID 1000
- A writable `/workspace`
- Passwordless `sudo` inside the disposable sandbox

The image supports `linux/amd64` and `linux/arm64`. Node.js archives are pinned
to an exact version and checked against the SHA-256 values published by the
Node.js project before installation.

## Build and test locally

From the Pulpo repository root, run:

```bash
npm run workspace-image:build
npm run workspace-image:test
```

Build a specific architecture directly:

```bash
docker build --platform linux/amd64 \
  --tag pulpo-agent-workspace:test \
  infra/workspace-image
```

Inspect the interactive environment:

```bash
docker run --rm -it pulpo-agent-workspace:test bash
```

The expected user is `agent`, `sudo whoami` returns `root`, and the working
directory is `/workspace`.

The current `sleep infinity` command is a temporary development entrypoint. It
will be replaced by the authenticated Pulpo workspace daemon. Do not expose
this image directly to untrusted networks before that protocol exists.

## Publishing

Pull requests build and smoke-test both supported architectures without
publishing. Relevant pushes to `main` publish the `main` tag. A Pulpo semantic
version tag such as `v0.1.0` publishes image tags `0.1.0` and `0.1`. The
workflow also emits provenance, SBOMs, an attestation, and the immutable
manifest digest.

Do not configure Pulpo with a mutable tag. Copy the digest reference from the
GitHub Actions job summary:

```text
ghcr.io/isaacthoman/pulpo-agent-workspace@sha256:...
```

It can also be obtained locally:

```bash
docker pull ghcr.io/isaacthoman/pulpo-agent-workspace:0.1.0
docker image inspect ghcr.io/isaacthoman/pulpo-agent-workspace:0.1.0 \
  --format '{{index .RepoDigests 0}}'
docker pull ghcr.io/isaacthoman/pulpo-agent-workspace@sha256:EXPECTED_DIGEST
```

### Package visibility

The official base image is public even though the Pulpo source repository is
private. Organization-specific derivative images may remain private.

For a private derivative, create a token with only `read:packages` and install
it as a Kubernetes image-pull secret:

```bash
kubectl --namespace pulpo-sandboxes create secret docker-registry workspace-registry \
  --docker-server=ghcr.io \
  --docker-username=GITHUB_USER \
  --docker-password=READ_PACKAGES_TOKEN
```

Reference `workspace-registry` through `imagePullSecrets` on the sandbox pod.
Never copy the token into this image.

## Customizing the image

Use an immutable base reference and switch back to the `agent` user after
installing packages:

```dockerfile
FROM ghcr.io/isaacthoman/pulpo-agent-workspace@sha256:BASE_DIGEST

USER root

RUN apt-get update \
    && apt-get install -y --no-install-recommends imagemagick \
    && rm -rf /var/lib/apt/lists/*

USER agent
```

Keep additions reproducible and combine package installation with APT-index
cleanup. Rebuild promptly when Ubuntu, Node.js, or another included tool ships
a security update. Updating Node.js requires changing its version and both
official architecture checksums in the Dockerfile.

## Security model

- Never add model-provider keys, Pulpo credentials, SSH private keys,
  Kubernetes credentials, or registry tokens.
- Never mount a Docker/containerd socket into the workspace.
- Supply narrowly scoped, short-lived session credentials only at assignment
  time.
- Enforce network, CPU, memory, disk, and lifetime limits outside the guest.
- Assign each sandbox to one session and destroy it afterward; never return an
  assigned sandbox to the clean warm pool.

Passwordless `sudo` is intentional because this image runs in a dedicated,
disposable Kata microVM. It is not an appropriate default for a shared
ordinary-container deployment.

## Updating the base image

The Ubuntu tag can receive security updates without changing its name. Run a
fresh no-cache build regularly, review the resulting SBOM, execute both
architecture tests, and publish a new Pulpo semantic version:

```bash
docker build --pull --no-cache \
  --tag pulpo-agent-workspace:test \
  infra/workspace-image
docker run --rm pulpo-agent-workspace:test pulpo-workspace-smoke-test
```

Existing Pulpo sessions should remain pinned to their original digest. Only
new sessions should switch to the validated replacement digest.
