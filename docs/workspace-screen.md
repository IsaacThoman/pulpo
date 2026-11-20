# Workspace screen

A cloud agent workspace can have a screen: a virtual display inside the workspace's VM, 1280×800, with a window manager and Chromium. The agent opens pages and programs there and works in their windows with the same eight app tools it has on the user's own computer ([This computer → Apps](this-computer.md#apps)): it is shown a window as a picture and a numbered list of what is in it, and clicks and types. The chat's owner can watch the screen from the reply and take it over, to sign in to a site for example, then hand it back.

It is off by default. An administrator turns it on with **Settings → Agent → Give agent workspaces a screen** (`agent.workspaceDesktop`), which needs a workspace image that includes the desktop ([Deploying](#deploying)). `GET /api/models` says whether it is on as `workspaceScreen`: agent mode is available and the setting is on. A reply that runs on the user's computer never uses it.

Contracts are in `packages/contracts/src/workspace-screen.ts` (the routes' shapes, the frame header, the limits) and `packages/contracts/src/computer.ts` (the app tools' apps, actions and window states, shared with the user's computer).

## Who trusts whom

Everything inside the workspace is the agent's: the daemon, the helper, the browser and whatever page it shows can be made to say anything. The server treats every answer from it as untrusted.

- An app operation's result is parsed with the contract's schemas (`computerAppSchema`, `computerAppStateSchema`) before the tools use it; one that does not parse tells the agent to look again. The picture it names is read through the daemon at once and must be a JPEG or PNG of at most 20 MiB, counted as it arrives rather than as the daemon claims.
- A frame must be a JPEG of at most 4 MiB. Its id is computed by the server from the bytes it relays, never taken from the daemon. The status and control answers are parsed too; a daemon that answers nonsense counts as gone.
- The screen belongs to the chat's owner. The routes answer only a signed-in owner of a chat that is not deleted, being purged or expired, and refuse an administrator looking at the chat through admin chat access, because the screen can show the user signed in to a site. They never start a workspace.
- What the user types while in control can be a password. Input bodies are never logged: the request log records the method and URL only, validation errors name the field that failed and not its value, and nothing the daemon answers about input is passed on or logged. The daemon does not log what its input helper says either.
- The agent can look at the screen while the user holds control (`app_view` still works), and whatever the user signed in to stays signed in in the workspace's browser until the workspace is deleted. The agent can use that session for the rest of the workspace's life. The prompt tells it to stop and ask before anything that sends, publishes, buys or deletes on the user's behalf.
- Traffic from the browser leaves through the egress proxy like every other workspace connection.

## How a request travels

### The agent: tools, operation, helper

`createAppTools` (`apps/server/src/agent/app-tools.ts`) takes anything that can list apps and act in a window (`AppHost`): the user's computer (`ComputerWorkspace`) or the cloud `WorkspaceManager` (`apps/server/src/agent/controller.ts`). On a workspace the descriptions speak of the workspace's screen, say nothing about the user allowing apps, and `app_key` names the Linux modifiers (`ctrl`, `alt`, `shift`, and `cmd` for the Super key). The runner offers the tools on a cloud reply when the setting is on, and the system prompt gains a short section about the screen (`cloudAgentPrompt` in `apps/server/src/agent/policy.ts`).

- `listApps` and `useApp` run the operations `app_list` and `app_act` through the daemon's `POST /v1/operations`, so they get what every operation gets: the tool call's id is the operation's, so a retried request never acts twice, and the lease, its renewal after use, the lease-expired retry, long-polls and cancelling are those of a shell command.
- The action reaches the daemon with the contract's defaults applied. The daemon (`packages/workspace-daemon`) finds the app and window by name, refuses a click, drag or `set_value` unless it names the window of the last picture, carries the action out, waits for the window to settle and looks at it again, the way the desktop app does. The result names a JPEG written in the VM, which the server reads at once with `GET /v1/images?path=`; the daemon keeps only the latest few.
- The daemon runs the helper as `pulpo-desktop helper` with the shared client (`packages/workspace-daemon/src/control/helper.ts`, protocol in `protocol.ts` beside it). Cancelling a running `app_act` stops the helper, so a long text stops being typed.
- A workspace whose image has no screen fails both operations: an older daemon does not know them, and a newer one says the image does not include the desktop. Either way the agent is told once that the workspace has no screen and that an administrator has to update the workspace image, and the tools fail at once for the rest of the reply.

### The viewer: routes, daemon

The routes are in `apps/server/src/workspace-screen/routes.ts`. The workspace is the chat's current one: the `ready`, unexpired `workspace_leases` row for the chat's `workspaceScopeId`. The controller relays a request to the daemon as it is, but only the `content-type` and `content-length` headers and the status in either direction, so nothing depends on other headers.

| Route | Daemon | Answers |
|---|---|---|
| `GET /api/chats/:chatId/workspace-screen` | `GET /v1/desktop`, 5 second timeout | `{ state, width, height, controlled }`. `unavailable` when agent mode or the setting is off, or the image has no screen (the daemon answers `404` or `available: false`). `none` when the chat has no running workspace, the controller no longer holds its lease, or the daemon cannot be reached. Otherwise `ready`, with whether a viewer holds control. |
| `GET …/frame?after=<id>&waitMs=<0..10000>` | `GET /v1/desktop/frame`, same query | `200 image/jpeg` with `x-pulpo-frame: <id>` and `cache-control: no-store` as soon as the picture differs from `after`; `204` when it did not change within `waitMs`. `404 workspace_screen_unavailable` without a running workspace with a screen. A viewer that goes away stops the request to the daemon. |
| `POST …/control` `{ held }` | `POST /v1/desktop/control` | `{ held }`. `true` takes or renews control for 20 seconds; `false` gives it back. |
| `POST …/input` `{ events }` | `POST /v1/desktop/input` | `204` once the events were carried out, in order; `409 workspace_screen_not_controlled` when control is not held. |

A frame's id is the first 32 hex characters of the SHA-256 of its bytes; the daemon computes the same, so the viewer sends it back as `after` and the daemon answers only when the picture changed. The daemon starts `pulpo-desktop frames` (4 frames a second, the pointer drawn in) on the first frame request and stops it after 15 seconds without one. Input goes to a second helper of its own, so it never waits behind the agent's pictures. Requests that do not reach the daemon answer `502 workspace_screen_unreachable`.

Each route has its own rate limit per address: 120 status requests a minute, 360 frames (a viewer asks about five times a second), 60 control changes, and 1,500 input batches (about twenty a second). Input bodies may be up to 1 MiB and carry at most 64 events.

**Watching keeps the workspace.** Any of these requests counts as use: the lease's idle expiry moves on as it does after an agent operation, with the idle timeout the lease was given, but at most every 30 seconds per lease. The controller moves its own idle clock on every request it relays, so the database and the controller keep agreeing about whether the workspace is alive. The hard timeout is never extended.

## The helper and the session on Linux

The image (`infra/workspace-image`) installs the session command `pulpo-desktop`, the control helper `/opt/pulpo/desktop/control.py` (run with the system Python, not the bundled environment), a `chromium` wrapper, and `/opt/pulpo/desktop/VERSION`, whose presence is how the daemon knows the image has a screen. Login shells get `DISPLAY=:1`, so the agent's commands see the screen.

| `pulpo-desktop` | What it does |
|---|---|
| `start` | Brings up the display (`:1`, 1280×800, 24-bit), a D-Bus session bus, the accessibility (AT-SPI) bus and the window manager, detached in their own session with logs in `/tmp/pulpo-desktop/log/`. Idempotent and safe to run concurrently. |
| `status` | Exit 0 when the session is up. |
| `run <command> [args…]` | Starts a program on the screen, detached, and returns at once. |
| `helper` | The control helper, JSON lines on stdin and stdout. This is what the daemon runs. |
| `frames [fps]` | The screen as a stream of JPEGs in the format of ffmpeg's `mpjpeg` muxer, until killed. |

Every ordinary window is maximized and undecorated, so a window fills the screen and its picture is the screen; dialogs float above their parent. `chromium <url or file>` opens the page in the workspace's one browser, starting it when it is not running, and returns at once. It applies the egress proxy (`localhost` is never proxied), forces accessibility on, skips the first-run pages and leaves remote debugging on a loopback port, so Playwright for Node, which the image includes, can attach to it. With `--headless` it runs the real browser in the foreground without the screen.

The helper speaks the same protocol as the desktop app's helpers, with `platform: 'linux'`. It reports apps with an ordinary or dialog window, front to back, named as a person knows them (`Chromium`). A snapshot raises and focuses the window, pictures its rectangle as it appears on screen (so an open menu or dropdown is in the picture), and lists elements from AT-SPI in the picture's pixels, only what is showing, within a time budget after which the list is cut. An app that exposes no accessibility tree gives an empty list, and the agent uses coordinates. Actions are real pointer and keyboard input on the display: the X pointer is the agent's pointer, and the user sees it move. `set_value` uses the accessibility interface where the element has one. The `input` method carries the owner's events at screen coordinates.

## Watching and taking over

A cloud reply that used the app tools offers **Open screen**; one that ran on the user's computer (`computer: true` on its `pulpo_workspace` item) never does. The viewer, titled **Workspace screen**, shows the live picture and **Watching**. **Take control** holds control, renewed every 5 seconds while the viewer is open, and shows **You're in control**; from then on the user's pointer and keys go to the workspace in batches. **Hand back** gives control back, and a viewer that goes away loses it within 20 seconds by itself.

While the user holds control, every app action of the agent's but looking is refused with a message telling it to wait until the user says they are finished. The prompt tells the agent never to ask for a password and never to try to get past a CAPTCHA or a sign-in wall, but to ask the user to press **Open screen**, take control, sign in, hand control back and say when they are done.

Without a running workspace the viewer says *No workspace is running for this chat. The screen is there while the agent's workspace is, and goes when the workspace shuts down after sitting idle.* With an image that has no screen, *This workspace has no screen.*

## Limits

- **Signed-in sites need the user.** The agent is told not to sign in, solve CAPTCHAs or ask for passwords; the user takes over and signs in themselves.
- **Sites that challenge the egress address.** Many sites challenge or block traffic from data centres and VPNs, which is where workspace traffic comes from. Some of those challenges the user can pass while in control; some sites refuse anyway.
- **Memory and CPU.** The display, window manager and browser run in the workspace's own memory and on its own cores, and Chromium draws without a GPU. Give workspaces at least 2 CPUs and 2048 MiB (the defaults) in **Settings → Agent** before turning the screen on: at 1 CPU and 1 GiB one page works, but with several tabs open an action takes over ten seconds and the element list comes back empty. See [Footprint](#footprint).
- **The idle timeout.** The screen lives and dies with the workspace. When a reply ends asking the user to sign in, the workspace is deleted, and the browser with it, once it has sat unused for **Idle timeout**. An open viewer counts as use, so it is the time the user has to press **Open screen**, and again to answer after handing back. The default of 30 minutes is comfortable; with a timeout of a minute or two most users will find the workspace gone.
- **Turn budget.** Every look and every action is a tool call and a model turn, so a task done in windows uses up **Maximum model turns** (30 by default) and **Maximum tool calls** much faster than one done with commands. The prompt tells the agent to use the screen only for what needs one.
- **Pictures in the context.** Every app tool result puts a picture in the model's context. Past eight, the oldest are replaced with a note that they were dropped because they are out of date, until only the latest three are left (`withoutStaleAppPictures` in `apps/server/src/agent/tool-result-images.ts`); the text of each result stays. The cut comes in steps rather than one picture a turn, so the start of the request, and the provider's prompt cache for it, stays the same between cuts. This applies to the app tools on the user's computer as well, never to `view_image` or generated images.
- **One screen, shared.** The agent and the user work on the same display and the same pointer; control decides whose input counts.

## Deploying

- Roll out a workspace image that includes the desktop first, then turn the setting on. Running workspaces keep the image they started with, so a chat whose workspace started earlier has no screen until that workspace is replaced.
- With an older image and the setting on, nothing breaks: the app tools fail once per reply with the message that an administrator has to update the workspace image, and the viewer says the workspace has no screen.
- The setting is read when a reply starts and on every viewer request, so turning it off removes the tools from new replies and makes the routes answer `unavailable`.
- Web and mobile show **Open screen** only in releases that include the viewer; older apps simply do not offer it.

## Footprint

The full measurements are in [the workspace image's README](https://github.com/IsaacThoman/pulpo/blob/main/infra/workspace-image/README.md#footprint). In short:

- **Image.** The desktop adds 668 MB unpacked and 289 MB compressed (2,220 MB and 790 MB in all), nearly all of it Chromium and its libraries and fonts.
- **A workspace that never uses the screen** runs nothing extra. The session alone (display, window manager, buses) takes about 15 MB and starts in under a second.
- **Memory.** The browser with one page takes 250–450 MB; three heavy pages about 1.0–1.3 GB.
- **Time.** In a Kata workspace with 2 CPUs and 2 GiB, the first page of a new workspace is up in about 3 seconds, looking at a window takes 0.2–0.3 seconds and an action with the look that follows it under a second. With 1 CPU and 1 GiB the first page takes about 9 seconds, and with several tabs open one action takes over ten.
- **The live picture** costs 5–6% of one core while someone watches, and each frame is about 115 KB.
- **Chromium's own sandbox is on** in a Kata workspace; in an ordinary container without user namespaces the browser runs without it, and the workspace is the boundary.
