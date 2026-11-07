# Pulpo Agent Workspace

This directory builds the disposable Ubuntu filesystem used by Pulpo agent
sandboxes. Kubernetes can run the resulting OCI image in a Kata Containers
pod, giving each Pulpo session a separate lightweight virtual machine.

The image deliberately does **not** include the Pi harness. Pi remains in the
Pulpo worker, where it owns the model loop and Pulpo's provider accounting. The
workspace contains only the operating system, coding tools, and the
authenticated Pulpo workspace daemon that executes requested tools.

## Contents

- Ubuntu 24.04 LTS
- Node.js 24.22.1 LTS (Pi requires Node.js 22.19.0 or newer)
- Python 3, Git, ripgrep, curl, compilers, and common shell utilities
- An unprivileged `agent` user with UID/GID 1000
- A writable `/workspace`
- A preinstalled Python environment for data analysis, images, spreadsheets, PDFs, Word, and PowerPoint
- Poppler PDF inspection and rendering tools
- LibreOffice headless Writer, Calc, and Impress for document rendering and format conversion
- Carlito, Caladea, Liberation, DejaVu, Noto CJK, and Noto Color Emoji fonts, with a prebuilt fontconfig cache
- Jupyter nbformat, nbclient, ipykernel, and nbconvert for executing notebooks, with a registered Python 3 kernel
- FFmpeg and ffprobe for audio/video processing and inspection
- An installed-package inventory at `/opt/pulpo/PACKAGES.md`
- The `pulpo files` CLI (`/usr/local/bin/pulpo`) for the Files attached to a chat
- Passwordless `sudo` inside the disposable sandbox

The image supports `linux/amd64` and `linux/arm64`. Node.js archives are pinned
to an exact version and checked against the SHA-256 values published by the
Node.js project before installation.

CI logs provide a measured comparison against the last successful `main` image build
([baseline run 41704247578](https://github.com/IsaacThoman/pulpo/actions/runs/41704247578),
[PR run 41937081540](https://github.com/IsaacThoman/pulpo/actions/runs/41937081540)):

| Architecture | Baseline layer-load total | PR layer-load total | Increase |
| --- | ---: | ---: | ---: |
| amd64 | 513.95 MB | 771.26 MB | 257.31 MB (50.1%) |
| arm64 | 498.92 MB | 755.74 MB | 256.82 MB (51.5%) |

These decimal MB totals sum the unique layers reported by BuildKit's `loading layer` lines,
including unchanged base layers. They measure the reported transfer/load representation,
not the unpacked Docker `.Size` or a registry manifest. The amd64 apt layer grows from
376.79 to 611.08 MB, and the Python layer from 107.35 to 130.37 MB. Other repository changes
between the two commits can affect small application layers, so this is not a controlled
same-base rebuild. The PR's apt install reports 1,386 MB of installed packages on amd64
(1,361 MB arm64), which includes packages present before this change. The earlier ~535 MB
estimate for additional unpacked files is still an estimate; the workspace workflow does
not log `docker image inspect .Size`. Both architectures pass their offline image smoke tests.

### Rendering and converting documents

Run conversions and notebook execution inside the workspace:

```bash
soffice --headless --convert-to pdf file.docx
pdftoppm -png -r 80 file.pdf page
jupyter nbconvert --to notebook --execute --inplace analysis.ipynb
```

Writer, Calc, and Impress also support format conversions such as DOCX to ODT
and back. For concurrent LibreOffice commands, give each process its own profile
with `-env:UserInstallation=file:///tmp/unique-lo-profile` to avoid profile locks.

## Build and test locally

From the Pulpo repository root, run:

```bash
npm run workspace-image:build
npm run workspace-image:test
```

Build a specific architecture directly:

```bash
docker build --platform linux/amd64 -f infra/workspace-image/Dockerfile \
  --tag pulpo-agent-workspace:test \
  .
```

Inspect the interactive environment:

```bash
docker run --rm -it --entrypoint bash pulpo-agent-workspace:test
```

The expected user is `agent`, `sudo whoami` returns `root`, and the working
directory is `/workspace`.

The daemon requires a per-workspace `PULPO_WORKSPACE_TOKEN` and is intended to
be reachable only through the private workspace controller.

## Files CLI

Agents reach the user's Pulpo Files with `pulpo files ls|tree|cat|grep|pull|status|push|mkdir|mv|rm`
inside bash commands (`pulpo files --help` documents it for the model). Pulled
items land in `/workspace/files`, and `/workspace/.pulpo/files.json` remembers
what was pulled so `status` and `push` can work out local changes.

No Pulpo credential enters the workspace. The CLI sends each request over the
daemon's unix socket (`PULPO_RELAY_SOCKET`, default `/tmp/pulpo-relay.sock`),
naming the bash operation it runs in (`PULPO_OPERATION_ID`, set by the daemon).
The daemon holds the request until the Pulpo server, which is already polling
that operation, answers it, so the CLI only works while its bash command runs.
Everything inside the workspace, the daemon included, is agent-controlled: the
server validates each request and applies the chat's Files access itself.
`PULPO_RELAY_TIMEOUT_MS` (default 15 minutes) bounds how long a request waits.

## Publishing

Pull requests build and smoke-test both supported architectures without
publishing. Relevant pushes to `main` publish the `main` tag. Semantic Release
creates Pulpo version tags from Conventional Commits and dispatches this
workflow for the exact release tag; `v0.1.1`, for example, publishes image tags
`0.1.1` and `0.1`. The workflow also emits registry-hosted provenance, SBOMs,
the immutable manifest digest, and a GitHub build-provenance attestation for the
published manifest. A validated manual dispatch is available for release
recovery and republishes only the supplied semantic version.

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

Run LibreOffice as the sandbox's `agent` user, never as root; it operates under
the sandbox's own network and egress limits. Documents may contain macros:
workspace `soffice` runs them only if a user or agent explicitly enables them.
[LibreOffice's default macro security](https://help.libreoffice.org/latest/en-US/text/shared/optionen/macrosecurity_sl.html)
blocks unsigned document macros.

## Updating the base image

The Ubuntu tag can receive security updates without changing its name. Run a
fresh no-cache build regularly, review the resulting SBOM, execute both
architecture tests, and publish a new Pulpo semantic version:

```bash
docker build --pull --no-cache -f infra/workspace-image/Dockerfile \
  --tag pulpo-agent-workspace:test \
  .
docker run --rm pulpo-agent-workspace:test pulpo-workspace-smoke-test
```

Existing Pulpo sessions should remain pinned to their original digest. Only
new sessions should switch to the validated replacement digest.

## Bundled dependencies

`requirements.txt` pins the Python runtime dependencies, including transitives.
They are installed into `/opt/pulpo/python` at image build time, using binary
wheels only so missing architecture support fails the build instead of compiling
packages during user requests. `/usr/local/bin/{python,python3,pip,pip3,jupyter}` wrap
the executables in that environment, including for the daemon's `bash -lc` commands. Agents
can install extra dependencies in their own disposable environment.

`PACKAGES.md` is generated from the installed distributions during the build.
The agent policy directs models to consult it before installing dependencies;
older and custom images without the inventory remain supported.

Run `npm run workspace-image:build` followed by `npm run workspace-image:test`.
The smoke test disables networking and exercises spreadsheet, chart, image,
Word, PowerPoint, LibreOffice PDF conversion and document round trips, PDF
extraction and rendering, and notebook execution and HTML export. CI runs these
checks on both amd64 and arm64. Update the pins together and run both architecture
checks when refreshing packages.

Publishing this image does not switch existing deployments automatically. After
publishing, configure the agent image digest to the new immutable reference and
prepare matching warm capacity before routing new sessions to it. Existing
leases keep their original environment. Track image size and cold readiness time
alongside tool installation durations; the larger image trades cold-pull cost
for avoiding repeated installs on requests. Use existing tool execution arguments
and timestamps to prioritize future bundle additions. No shared writable cache
or session filesystem is introduced.
