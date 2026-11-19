# This computer

The desktop app can lend the agent the computer it runs on. In the composer's Pulpo Agent menu, **Access** has one row for each thing the agent can reach, and each row says what it can reach there and what it may do:

- **Files**: the items the chat mentions, or all of the user's Files once that was mentioned or allowed, with **Read only**, **Suggest changes** or **Edit directly**.
- **This computer**: **Off** (the default), or one of the access modes below. Once it is on, the same submenu offers the folder.

The two are chosen separately, and Files stay available whichever way the computer is used. Outside the desktop app there is no computer to offer, so the Files row stands alone. Choosing an option leaves the menu open, showing the choice take; it closes when the user clicks away, clicks the pill again, or presses Escape. Only **Files access…** closes it, because it opens a dialog.

| Access | Folder | What the agent does |
|---|---|---|
| **Full access** | optional; `~/Pulpo` when none is chosen | The computer is the workspace. Shell, read, write, edit, ls, find, grep, view_image and attach_file run there as the user, starting in the folder and free to leave it. No cloud workspace is used and no workspace minutes are billed. `pulpo files` works in its commands as it does in the cloud. The agent can also see and work in other apps' windows, one app at a time and only after the user allowed that app ([Apps](#apps)). |
| **Read only** / **Suggest changes** / **Edit directly** | required | The agent keeps its cloud workspace and reaches the folder with `pulpo computer` in bash, the way it reaches Files with `pulpo files`. Nothing runs on the computer. |

The choice is kept per chat on that device (`localStorage`, per instance and account) and is not synced. It is offered only where `window.pulpoDesktop.computer` exists, the instance allows it (`agent.computerAccess`, on by default, exposed as `computerAccess` on `GET /api/models`) and the chat is the user's own. macOS and Windows are supported.

Contracts are in `packages/contracts/src/computer.ts`: the access modes, the selection a message carries, every request the server may send with its parameters and result, the limits, and the bridge type `DesktopComputerApi`.

## Who trusts whom

The desktop **main process** is the policy point. It treats the server and its own renderer as untrusted.

- A folder is usable only after the user picked it in the native folder dialog; full access only after the native confirmation ("Let Pulpo Agent run commands on this Mac?"). Both are stored per instance origin and account in `<userData>/computer/grants.json`. The account id is asked of the instance with the stored token (`GET /api/mobile/me`), never of the renderer. Settings → Agent lists what was allowed, with **Turn off** for full access and **Remove** per folder; taking something back ends the replies using it.
- Before a message is sent, the renderer registers a **session** for it (`begin({ sessionId, access, folder })`). The main process accepts it only if the grants cover it, and serves requests only for sessions it knows, only with the methods the session's access allows (`full`: `describe`, `operation.*`, `file.*`, `app.*`; folder modes: `folder.*`). Sessions live in memory, end with their reply or with the sign-in they were begun under, and expire after a day idle.
- Folder modes never execute anything. Every path is relative to the session's folder and resolved through `realpath`; absolute paths, `..`, drive letters, reserved Windows names and symlinks leading out are refused (`apps/desktop/src/computer/paths.ts`). A change (`resolveForChange`) is refused as well when it names the folder itself, anything inside `.git` (a config or hook there would make git run things), or a path that is or goes through a symbolic link, so removing a link can never remove what it points at.
- An app is usable by the agent only after the user allowed that app in its own native prompt ("Let Pulpo Agent use TextEdit?"), which the main process shows when a full-access reply first reaches for it. Allowed apps are stored with the other grants and listed in Settings → Agent with **Remove**.
- No IPC channel runs a command or reads a file directly. The renderer can only pass a server request to `handle`, open the native dialogs, review changes, and take access back.
- Choosing a folder allows the agent that folder; the access mode is how the user wants it used in a chat, not a limit the main process holds against its own renderer. Code running in the renderer could begin an edit session on any allowed folder, or a full-access one once that was confirmed, which is why access can be taken back.

On the server, the sandbox and other users are untrusted: the realtime room is `computer:<userId>:<sessionId>`, so only the user's own app hears a request or may answer it, and the relay validates every `pulpo computer` argument. A `computer` selection is accepted only on an Agent reply sent by a desktop app that lists the `computer` client feature; otherwise the request fails with `computer_unavailable` rather than running in the cloud. The folder path is never included in chat output; replies expose only `computerSessionId` to their owner.

## How a request travels

The worker never dials the computer. `computerCall` (`apps/server/src/computer/tunnel.ts`) publishes the request to Redis; the API process holding the app's socket emits `computer.request`; the renderer hands it to the main process and emits the answer as `computer.response`; the worker, subscribed to the answers channel, resolves the call. The app announces the sessions it serves with `computer.host` on connect and every 15 seconds; presence lasts 45 seconds. A call waits up to 10 seconds for the session to appear, fails as soon as the app has been gone for two presence checks, and otherwise times out (30 seconds, more for long-polls and transfers).

File bytes do not cross the socket unless they are small (up to 256 KiB, inline as base64). Larger files use one-time URLs, `PUT` or `GET /api/computer/transfers/:id?token=…`, that the main process calls directly against the instance origin stored with the session. The token is the only credential, is kept out of the request log, and the bytes sit in the blob store for at most 15 minutes (`sweepComputerTransfers` in maintenance deletes leftovers). `deploy/nginx.conf` raises the upload limit for that path.

## Full access

`ComputerWorkspace` (`apps/server/src/agent/computer-workspace.ts`) implements the same `AgentWorkspace` interface as the cloud `WorkspaceManager`. It asks the computer to describe itself (system, shell, home, starting folder, attachments folder) before the prompt is written, stages the chat's attachments into `<userData>/computer/attachments`, and runs the workspace daemon's operation protocol over the tunnel: `operation.start` returns at once, `operation.get` long-polls for output, `operation.cancel` ends the process tree. The desktop side (`apps/desktop/src/computer/operations.ts`) reuses the daemon's bounded `read` and saved-output modules.

- Commands run in the user's login shell on macOS, with the environment that shell would have in a terminal, and in PowerShell on Windows (PowerShell 7 when installed), where the shell tool is named `powershell` instead of `bash`.
- Each answer carries at most 200,000 characters of output, cut in the middle; the whole output is saved under `<userData>/computer/tool-output` and named in the result.
- `find` and `grep` are implemented in Node (users do not have ripgrep) and skip `.git` and `node_modules`. They run on the main process, so neither can be made to hang it: `find` matches its glob without backtracking, and `grep` runs its regular expression with a time limit.
- A computer that is not connected fails the reply when it starts, with the workspace step showing why. One that drops mid-run, or whose app was restarted and no longer knows the session, turns the tools off for the rest of the reply. Cancelling sends the command's process group SIGTERM, then SIGKILL after five seconds; quitting the app kills every command it started.
- On macOS and Linux, what a finished command left running in its process group (`sleep 60 &`, a dev server) is stopped the same way when its session ends: with the reply, when the access is taken back, on sign-out, or when the app quits. The prompt says so, so the agent hands the user the command for anything that should keep running. Windows has no process groups: a program started there with `Start-Process` keeps running.

### Pulpo Files in full access

A full-access reply reaches the user's Files the way a cloud reply does, by running `pulpo files ls|tree|cat|grep|pull|status|push|mkdir|mv|rm` in its shell command, with the same scope, access modes, permission request and changes bar. The desktop app plays the part the workspace daemon plays in the cloud:

- The app's build bundles the daemon's CLI into one file (`pulpo-cli.cjs`, from `apps/desktop/src/computer/pulpo-cli.ts`). Before a full-access session's first command the main process copies it to `<userData>/computer/bin` beside launchers (`apps/desktop/src/computer/launcher.ts`) that run it with the app's own executable as Node: `pulpo` (sh), and on Windows `pulpo.ps1`, which PowerShell picks, and `pulpo.cmd`. `ELECTRON_RUN_AS_NODE` is set inside the launchers only, never in the agent's commands.
- Commands get that folder first on `PATH`, `PULPO_RELAY_SOCKET` (a unix socket under `<userData>/computer/relay`, or in a private temporary folder when that path is too long for one; a randomly named pipe on Windows) and `PULPO_WORKSPACE_ROOT` (`<userData>/computer/workspaces/<account>`), where the CLI keeps its copies in `files` and its manifest in `.pulpo/files.json`. The copies are per account, and the prompt and `pulpo files --help` name that folder instead of `/workspace/files`.
- The CLI posts each request to the relay endpoint (`relay.ts`). `Operations` holds it, lists it as `relay.pending` on the operation and returns the server's long-poll early. `ComputerWorkspace.execute` runs the same Files relay as the cloud and sends the answer with `operation.relay`; only the session that started the command may answer. Pulled bytes arrive through `file.receive` and pushed files leave through `file.send`, so they move like any other file.
- Local paths in `pull` and `push` are absolute paths on the computer in its own form (`ComputerWorkspace.localPath`); in the cloud they stay confined to `/workspace`.
- The endpoint is open to the user's own programs only (socket mode 0600 in a 0700 folder; an unguessable pipe name on Windows), and only while a full-access command runs. Whatever uses it gets what the reply itself gets: the server holds every request to the chat's Files scope and access mode.
- `describe` names `filesDir` only once the launchers are written and the endpoint listens. Without it the reply is told nothing about Files, as when Files are off, so an app that cannot offer them fails nothing.

### Apps

With full access the agent can also use the apps on the computer, the way a person would: it is shown a window and clicks and types in it. It has eight tools for that (`apps/server/src/agent/app-tools.ts`), offered only when the desktop app's `describe` answer has `apps`:

| Tool | What it does |
|---|---|
| `app_list` | The apps running with a window open, whether each was allowed, and the window titles of the allowed ones. |
| `app_view` | One window: a picture of that window alone and a numbered list of what is in it (role, label, value, box). |
| `app_click`, `app_type`, `app_key`, `app_scroll`, `app_drag`, `app_set_value` | One action in a window, by element number or by coordinates in the last picture. Each answers with the window as it is afterwards. |

All of them travel as two requests, `app.list` and `app.act`, which `ComputerService` serves through `apps/desktop/src/computer/control/apps.ts`. That file is the policy point for apps:

- **One app at a time, each allowed by the user.** The first request for an app shows a native prompt and waits up to two minutes for the answer. Allow is remembered per instance and account (`grants.json`); a refusal lasts for that reply. A reply that ends withdraws its open prompt. Before an app is allowed the agent learns its name but not its window titles.
- **Never the Pulpo app or the system's security prompts.** The app's own windows are where the user answers the agent, so they are excluded twice: the helper is told the app's process id and reports none of its windows, and `appNeverAllowed` drops Pulpo, the login window, and the permission and credential prompts of macOS and Windows by id.
- **Only the window the agent was shown.** A click, drag or `set_value` is refused unless it names the window of the last picture sent for that app, so a number or a coordinate always means what the agent saw. After an action, a window that opened in front (a dialog) is the one shown; a window that closed gives way to the app's front one, and the answer says so.
- **Stopping stops it.** When a reply ends, its access is taken back, or the app it is working in is removed in Settings while the helper is still carrying out its action (a long text being typed), the helper is stopped: its input closes, it stops typing where it is and leaves. A helper also leaves after an action that did not finish in time, so the stuck action cannot carry on later. A request still waiting its turn behind another reply's is not sent. Element numbers are good only for the reply the window was last pictured for, so two replies working in one window cannot act on each other's lists.
- **A window, not the screen.** Pictures are of the one window, at most 1280 pixels on the long edge, JPEG. One that fits in a socket message rides inline; a larger one is written under `<userData>/computer/app-images`, fetched by the server with `file.send`, and deleted when the next is taken or the reply ends. Like `view_image` results, the pictures become part of the chat: the model's context and a small preview in the reply's timeline.

The seeing and the input are done by a native helper process, one per system, that the main process starts on first use and talks to in JSON lines (`control/protocol.ts` is the whole protocol, `control/helper.ts` the client: one request at a time, a helper that does not answer is replaced, an idle one is stopped after ten minutes, and closing its input ends it).

| | macOS | Windows |
|---|---|---|
| Helper | `apps/desktop/native/macos`, Swift, built by `scripts/build-control-helper.mjs` into one universal binary that ships in the app's resources | `apps/desktop/native/windows`, C# sources that ship in the app's resources and are compiled by the built-in Windows PowerShell when the helper starts (no build step, nothing to sign) |
| Sees | ScreenCaptureKit for the window's picture, the Accessibility tree for its elements | `PrintWindow` for the picture, UI Automation for the elements |
| Acts | In the background: accessibility actions where an element has one, else mouse and key events posted to the app's process. The user's pointer does not move, their keyboard is not used and the app is not brought forward. | UI Automation patterns where an element has one (no pointer needed); else the window comes to the front and the user's own pointer and keyboard are used |
| The agent's pointer | A yellow pointer of its own, drawn in a click-through window ordered just above the window it works in | The same pointer as an overlay on top of the screen; the system pointer is left alone |
| Needs | Accessibility and Screen Recording for Pulpo in System Settings → Privacy & Security. The system asks the first time; until both are on the tools fail with a message telling the agent to wait for the user. | Nothing. Windows that run elevated cannot be controlled. |

`describe.apps.background` tells the server which of the two it is talking to, and the prompt and the approval dialog say it: on macOS the user can keep working while the agent does; on Windows the agent says so before it takes the pointer. The agent's pointer hides a few seconds after its last action and at once when the reply ends.

On macOS, working in a window that is not in front leans on undocumented parts of the system, each looked up when the helper runs and each with a fallback:

- An event field that names the target window, and `CGEventSetWindowLocation`, deliver a click at a point. Without them a click at a coordinate fails with an explanation and element actions keep working.
- `SLPSPostEventRecordTo` tells the app, for the moment of a left click, a drag, a key chord or typing, that it is active and the window it works in is key (the records yabai uses to focus a window without raising it, minus the call that makes the app frontmost). Views that ignore the first click on an inactive window, and shortcuts that act on the current document, need that; and it is what sends keys to the window the agent was shown when the app has several open. When the user is working in the app themselves, nothing is simulated, and keys for a window other than the one they have the keyboard in are refused rather than typed into theirs. The window server's own front app is not changed, so the user's keyboard stays where it was. Without it such clicks are dropped by the app.
- `_AXUIElementGetWindow` matches an accessibility window to the window server's; without it they are matched by frame and title.

Other things worth knowing:

- While the Mac's screen is locked, macOS answers no accessibility questions about windows. Windows are still pictured, and clicks at coordinates, keys and typing still land, but the element list is empty and minimized windows are not listed.
- Windows on another Space are listed once the user goes there.
- Windows types a character at a time, about 60 a second, because its apps drop or reorder faster input; one `app_type` carries at most 2,000 characters.
- On Windows a dialog or menu that a window owns is drawn into that window's picture and its elements are listed with it. An open menu is copied from the screen, which draws its shadow right, but never where another app's window lies over any part of it: then the menu is drawn by itself, and a window that can only be pictured from the screen is not pictured at all while another app covers it. An app running as administrator cannot be seen or controlled, and while one is in front no other window can be brought forward; the error says so.

## Folder modes

`pulpo computer ls|tree|cat|grep|pull|status|push|mkdir|mv|rm` (`packages/workspace-daemon`, same code as `pulpo files` with a second store) mirrors the folder at `/workspace/computer` with the manifest `/workspace/.pulpo/computer.json`. Its relay requests are named `computer:<command>` and served by `apps/server/src/computer/folder-relay.ts` through `folder.list`, `folder.read`, `folder.search`, `folder.send` and `folder.change`.

- A file's version is the SHA-256 of its bytes; a push names the version it pulled and gets `conflict` when the file changed since, including a save the user makes while the new bytes are still arriving. A replaced file keeps its permissions.
- Listings and searches run on the main process and stop, marked incomplete, after 20 and 15 seconds.
- Folders named `.git` and `node_modules` are left out of pulls, searches and listings deeper than one level, and the output says so.
- **Read only** refuses every change, on the server and in the app.
- **Edit directly** applies changes at once and records them. Removed items go to the system trash.
- **Suggest changes** stages each change in `<userData>/computer/changes` and applies nothing. Until a suggested file is decided, the agent sees the folder as if it were accepted, as with Files. The reply shows, for example, **4 suggested changes in site** with **Review**; the dialog lists everything waiting in that folder, whichever reply suggested it, with a diff per file and **Accept** / **Reject**. Accepting a file that changed on disk since the suggestion marks it as a conflict with **Overwrite**; a folder suggested for removal while it was empty becomes one too once something is in it, with **Remove anyway**. Suggestions nobody decides are rejected after 30 days.

The reply's `pulpo_computer_changes` item carries only counts and the session id; the changes themselves never leave the computer, so other devices show a plain line.

## Deploying

- The workspace image must be rebuilt and rolled out for `pulpo computer` to exist in cloud workspaces. Until then the folder modes fail with the CLI's "unknown command" error; full access does not depend on the image.
- The app tools come with the desktop app too: a server offers them only to an app that describes `apps`, so older apps keep working without them. Building the macOS app needs the Swift compiler (Xcode or its command line tools); `electron-forge start` in a checkout without it still runs, without the app tools.
- `pulpo files` in full access comes with the desktop app, so it needs a desktop release that includes it. Older apps keep working without Files in full access. It relies on Electron's run-as-Node mode, which the app's build leaves on (no fuse turns it off).
- Migration `0115_computer_workspace` adds `responses.computer` and `queued_messages.computer`.
- Behind the bundled nginx, `/api/computer/transfers/` streams uploads up to 1000 MiB; other proxies need the same.
