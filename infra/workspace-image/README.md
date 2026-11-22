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
- FFmpeg and ffprobe for audio/video processing and inspection
- An installed-package inventory at `/opt/pulpo/PACKAGES.md`
- The `pulpo` CLI (`/usr/local/bin/pulpo`): `pulpo files` for the Files attached to a chat, `pulpo computer` for a folder the user shared from their computer
- A screen (see [The screen](#the-screen)): a virtual display, a window manager, Chromium with Playwright, and the control helper behind the agent's app tools, all started only when first used
- Passwordless `sudo` inside the disposable sandbox

The image supports `linux/amd64` and `linux/arm64`. Node.js archives are pinned
to an exact version and checked against the SHA-256 values published by the
Node.js project before installation. Chromium is the build that the pinned
Playwright version names for each architecture.

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

`pulpo computer` has the same commands for a folder the user shared from the
Pulpo desktop app ("This computer" with read only, suggest or edit access). Its
copies land in `/workspace/computer` with the manifest
`/workspace/.pulpo/computer.json`, and its relay requests are named
`computer:<command>`; the server forwards them to the user's desktop app.

No Pulpo credential enters the workspace. The CLI sends each request over the
daemon's unix socket (`PULPO_RELAY_SOCKET`, default `/tmp/pulpo-relay.sock`),
naming the bash operation it runs in (`PULPO_OPERATION_ID`, set by the daemon).
The daemon holds the request until the Pulpo server, which is already polling
that operation, answers it, so the CLI only works while its bash command runs.
Everything inside the workspace, the daemon included, is agent-controlled: the
server validates each request and applies the chat's Files access itself.
`PULPO_RELAY_TIMEOUT_MS` (default 15 minutes) bounds how long a request waits.

## The screen

The workspace has a screen of its own: display `:1`, 1280×800, 24-bit (Xvfb),
with Openbox maximizing every ordinary window without decorations, so a window
is the whole screen; dialogs float above their parent. Nothing of it runs until
something needs it, so a workspace that never uses it pays nothing at run time.
Its sources are in [`desktop/`](desktop).

| Path | What |
| --- | --- |
| `/usr/local/bin/pulpo-desktop` | The session command, below |
| `/usr/local/bin/chromium` (also `chromium-browser`, `google-chrome`) | The browser, below |
| `/opt/pulpo/desktop/control.py` | The control helper, run by `pulpo-desktop helper` with the system Python |
| `/opt/pulpo/desktop/VERSION` | `1`; tells the daemon that the image has a screen |
| `/etc/profile.d/pulpo-desktop.sh` | `DISPLAY=:1` and the session bus for login shells, so what agent commands start opens on the screen |

`pulpo-desktop`:

- `start` brings up the display, a D-Bus session bus, the accessibility
  (AT-SPI) bus and the window manager, and returns once the display answers
  (about 0.1 s cold, a few milliseconds when it is already up). It is safe to
  run repeatedly and concurrently. Everything it starts runs in a session of
  its own with its output in `/tmp/pulpo-desktop/log/`, so it outlives the
  command that started it and never holds that command's output open (the
  daemon waits for an agent command's output to close and kills its process
  group on timeout).
- `status` exits 0 when the screen is running, 1 when not.
- `run <command> [args…]` starts a program on the screen, detached, with the
  session's environment, and returns at once.
- `helper` runs the control helper on standard input and output; the daemon
  spawns this for the app tools.
- `frames [fps]` (default 4) writes the screen, pointer included, to standard
  output as JPEGs in the format of FFmpeg's `mpjpeg` muxer (multipart headers
  with `Content-Length`, then the JPEG) until it is killed; the daemon spawns
  this for the live view. An unchanged screen gives byte-identical frames.
- `stop` ends the screen and everything on it.

`chromium [url…]` opens the URLs in the browser on the screen, starting the
screen and the browser when they are not running, and returns at once (a
browser that is already running takes them as new tabs). `chromium --headless
…` runs a headless browser in the foreground with no screen and a profile of
its own. Both apply defaults that make the browser work in a workspace:

- the egress proxy from `HTTPS_PROXY`/`HTTP_PROXY`, with `localhost`,
  `127.0.0.1`, `[::1]` and the `NO_PROXY` entries reached directly, so the
  agent's own dev servers open without the proxy (workspaces have no DNS);
- Chromium's sandbox only when unprivileged user namespaces work, probed each
  time; otherwise `--no-sandbox`;
- shared memory off `/dev/shm` (64 MB in a pod), the accessibility tree the
  helper reads, no first-run, sign-in, default-browser or Chrome for Testing
  prompts, and no background updates;
- on the screen, the profile `~/.config/pulpo-chromium` and the DevTools
  protocol on `127.0.0.1:9222`.

Playwright is installed globally and resolves from any folder (`/node_modules`
links to it), so agent scripts can drive the browser on the screen with
`chromium.connectOverCDP('http://127.0.0.1:9222')` or launch their own with
`chromium.launch()`. Browsers live in `PLAYWRIGHT_BROWSERS_PATH=/opt/pulpo/browsers`.
Only the full Chromium is downloaded; Playwright's headless shell is a link to
it, which runs it in its own headless mode as `channel: 'chromium'` would, and
saves 283 MB. A script that needs another Playwright version can
`npx playwright install chromium`, which downloads into the same folder.

The control helper speaks the protocol in
`packages/workspace-daemon/src/control/protocol.ts` (`platform: 'linux'`). It
lists windows from the window manager's EWMH hints, pictures a window as the
screen shows it (so menus and pop-ups over it are included), and reads elements
from AT-SPI over D-Bus: the showing ones, in one Collection query where the app
supports it (Chromium does), within a 2-second budget, after which the list is
cut and marked `truncated`. Clicks, keys, scrolling and drags are real input
through XTEST; the X pointer is the agent's pointer. Text is typed on the US
layout, and characters it lacks are typed on spare keys by loading a keymap
that adds them. `cmd` in a chord is the Super key. `set_value` uses an
element's accessibility interface where it has one; Chromium's text fields
have none, so for those the helper focuses the field, selects its text and
types the new value, and says so.

### Footprint

Measured on linux/arm64 (Docker in OrbStack on Apple silicon) in a container
limited like a default workspace (`--cpus 2 --memory 2g`); Chromium 159.0.8154.6
from Playwright 1.65.1.

| Image | Before | After |
| --- | --- | --- |
| Unpacked (sum of layers) | 1,552 MB | 2,220 MB (+668 MB) |
| Compressed (`docker save \| gzip -1`) | 501 MB | 790 MB (+289 MB) |

The added layers are the screen's packages (116 MB unpacked, 35 MB compressed)
and Playwright with Chromium and its libraries and fonts (551 MB, 241 MB); the
scripts are under 0.1 MB. On linux/amd64 the image unpacks to 2,226 MB.

| At run time | Memory in use (`docker stats`) |
| --- | --- |
| Screen never used | nothing runs |
| Session idle (Xvfb, Openbox, D-Bus, AT-SPI) | 15 MB (28 MB PSS across its processes) |
| Browser with one blank tab | 247 MB |
| One ordinary page (a Wikipedia article) | 445 MB |
| Three heavy pages (YouTube, CNN, GitHub issues) | 1.26 GB, settling to 1.03 GB; no process killed |
| Playing video, Google Maps and a news site | 1.86 GB of 2 GB; no process killed |

- `pulpo-desktop start`: 0.08–0.10 s cold, 3–5 ms warm.
- `chromium <url>` on a cold workspace to the loaded page in a helper snapshot:
  0.7–1.2 s for example.com, 1.3–1.5 s for a Wikipedia article.
- A snapshot with `maxElements: 300` (the app tools' limit):

  | Page | With elements | Elements | `outline: false` |
  | --- | --- | --- | --- |
  | example.com | 0.02–0.05 s | 24 | < 0.01 s |
  | Wikipedia, United States (long article) | 0.4–0.6 s | 222 | 0.01 s |
  | GitHub issues (web app) | 0.08–0.10 s | 166 | 0.01 s |
  | Hacker News (dense) | 0.42 s | 300, truncated | 0.01 s |
  | YouTube, Google Maps | 0.04–0.05 s | 33, 29 | < 0.01 s |

  A page whose accessibility tree is huge and slow for Chromium to search (a
  synthetic page of 20,000 buttons) answers in 2.1 s with no elements and
  `truncated: true`; Chromium is busy with the query for about 15 s after.
- `frames` at 4 fps uses 5–6% of one CPU whether the screen is still or a page
  scrolls (drawing the scroll costs Chromium and Xvfb about 30% more). A frame
  of a text-heavy page is about 115 KB (up to 135 KB while scrolling).

Not measured here: amd64 timings in an ordinary container on real hardware (the
amd64 image was only run under emulation, where the desktop smoke test takes
21–37 s against 6–9 s on arm64), and cold image pulls.

#### Under Kata

Measured on linux/amd64 in a Kata pod on the reference cluster (K3s, the
`kata-pulpo-bounded` runtime, the default seccomp profile, no DNS, the egress
proxy and tunnel), driving the daemon as the Pulpo server does.

- **Chromium's sandbox is on.** Unprivileged user namespaces work in the guest,
  so the `chromium` wrapper does not add `--no-sandbox`.
- **Proxy only.** Lookups and direct connections fail; pages load through the
  proxy. `/dev/shm` is half the guest's memory there, not 64 MB.
- `pulpo-desktop start`: 0.29 s cold, 14 ms warm.

| | 1 CPU, 1 GiB | 2 CPUs, 2 GiB |
| --- | --- | --- |
| Memory the guest sees | 946 MiB | 1,953 MiB |
| `chromium <url>` on a new workspace to the loaded page | 9.1 s | 3.1 s |
| Browser with one small page | 327 MiB in use | 432 MiB in use |
| Two tabs, one a Wikipedia article | 450 MiB left | 1,095 MiB left |
| Eight tabs (search, shop, news, video and an animated page in front) | 225 MiB left | 541 MiB left |
| One app operation with one or two tabs open | 0.1–0.6 s to look, 0.7–1.3 s to act | 0.2–0.3 s to look, 0.6–0.9 s to act |
| One app operation with the eight tabs open | 12–14 s, and the element list comes back empty | 0.2–1.5 s |
| First live frame for a viewer | 1.2 s with one tab; none within 5 s with eight | 2.2 s with eight tabs |

Nothing was killed for memory in any of these. At 1 CPU the limit is the
processor: Chromium draws without a GPU, and a busy page in front leaves no
time for the element list or the live picture. Give workspaces at least 2 CPUs
and 2 GiB when the screen is on.

Seven sites were opened once each through the egress address: a Google
search, Amazon, GitHub, Hacker News, Cloudflare's own site and Wikipedia loaded
as usual, and Reddit answered with its block page.

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
official architecture checksums in the Dockerfile. Updating Chromium means
changing `PLAYWRIGHT_VERSION`, which names the browser build.

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

The screen changes what the workspace holds and who can see it:

- Chromium runs without its own sandbox wherever unprivileged user namespaces
  are blocked (the container runtime's default seccomp profile blocks them), so
  a compromised renderer has the agent's rights. The workspace VM is the
  boundary, as it is for everything else the agent runs.
- Whatever a person does on the screen while in control, signing in to a site
  for example, stays in the browser's profile: the agent sees the pages and can
  use the session (cookies, saved form data) until the workspace is destroyed.
  Passwords the browser offers to save are kept in the profile with no keyring
  (Chromium's `basic` store).
- The DevTools port and the X display are open to every process in the
  workspace; all of them are the agent's.
- `/opt/pulpo/browsers` belongs to `agent`, so scripts can install other
  Playwright browsers there.

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
packages during user requests. `/usr/local/bin/{python,python3,pip,pip3}` wrap
the executables in that environment, including for the daemon's `bash -lc` commands. Agents
can install extra dependencies in their own disposable environment.

`PACKAGES.md` is generated from the installed distributions during the build.
The agent policy directs models to consult it before installing dependencies;
older and custom images without the inventory remain supported.

Run `npm run workspace-image:build` followed by `npm run workspace-image:test`.
The smoke test disables networking and exercises spreadsheet, chart, image,
Word, PowerPoint, PDF extraction, and PDF rendering workflows, and the screen:
the session, the browser, the control helper as the daemon speaks to it
(snapshots, clicks by element and by position, typing, chords, scrolling,
dragging, `set_value`, a second window, a minimized window, a person's input),
the live frames, headless Chromium and Playwright. CI runs these
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
