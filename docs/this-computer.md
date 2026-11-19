# This computer

The desktop app can lend the agent the computer it runs on. In the composer's Pulpo Agent menu, **Access** has one row for each thing the agent can reach, and each row says what it can reach there and what it may do:

- **Files**: the items the chat mentions, or all of the user's Files once that was mentioned or allowed, with **Read only**, **Suggest changes** or **Edit directly**.
- **This computer**: **Off** (the default), or one of the access modes below. Once it is on, the same submenu offers the folder.

The two are chosen separately, and Files stay available whichever way the computer is used. Outside the desktop app there is no computer to offer, and the Files choices sit in the menu itself.

| Access | Folder | What the agent does |
|---|---|---|
| **Full access** | optional; `~/Pulpo` when none is chosen | The computer is the workspace. Shell, read, write, edit, ls, find, grep, view_image and attach_file run there as the user, starting in the folder and free to leave it. No cloud workspace is used and no workspace minutes are billed. `pulpo files` works in its commands as it does in the cloud. |
| **Read only** / **Suggest changes** / **Edit directly** | required | The agent keeps its cloud workspace and reaches the folder with `pulpo computer` in bash, the way it reaches Files with `pulpo files`. Nothing runs on the computer. |

The choice is kept per chat on that device (`localStorage`, per instance and account) and is not synced. It is offered only where `window.pulpoDesktop.computer` exists, the instance allows it (`agent.computerAccess`, on by default, exposed as `computerAccess` on `GET /api/models`) and the chat is the user's own. macOS and Windows are supported.

Contracts are in `packages/contracts/src/computer.ts`: the access modes, the selection a message carries, every request the server may send with its parameters and result, the limits, and the bridge type `DesktopComputerApi`.

## Who trusts whom

The desktop **main process** is the policy point. It treats the server and its own renderer as untrusted.

- A folder is usable only after the user picked it in the native folder dialog; full access only after the native confirmation ("Let Pulpo Agent run commands on this Mac?"). Both are stored per instance origin and account in `<userData>/computer/grants.json`. The account id is asked of the instance with the stored token (`GET /api/mobile/me`), never of the renderer. Settings → Agent lists what was allowed, with **Turn off** for full access and **Remove** per folder; taking something back ends the replies using it.
- Before a message is sent, the renderer registers a **session** for it (`begin({ sessionId, access, folder })`). The main process accepts it only if the grants cover it, and serves requests only for sessions it knows, only with the methods the session's access allows (`full`: `describe`, `operation.*`, `file.*`; folder modes: `folder.*`). Sessions live in memory, end with their reply or with the sign-in they were begun under, and expire after a day idle.
- Folder modes never execute anything. Every path is relative to the session's folder and resolved through `realpath`; absolute paths, `..`, drive letters, reserved Windows names and symlinks leading out are refused (`apps/desktop/src/computer/paths.ts`). A change (`resolveForChange`) is refused as well when it names the folder itself, anything inside `.git` (a config or hook there would make git run things), or a path that is or goes through a symbolic link, so removing a link can never remove what it points at.
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
- `find` and `grep` are implemented in Node (users do not have ripgrep) and skip `.git` and `node_modules`.
- A computer that is not connected fails the reply when it starts, with the workspace step showing why. One that drops mid-run, or whose app was restarted and no longer knows the session, turns the tools off for the rest of the reply. Cancelling sends the command's process group SIGTERM, then SIGKILL after five seconds; quitting the app kills every command it started.

### Pulpo Files in full access

A full-access reply reaches the user's Files the way a cloud reply does, by running `pulpo files ls|tree|cat|grep|pull|status|push|mkdir|mv|rm` in its shell command, with the same scope, access modes, permission request and changes bar. The desktop app plays the part the workspace daemon plays in the cloud:

- The app's build bundles the daemon's CLI into one file (`pulpo-cli.cjs`, from `apps/desktop/src/computer/pulpo-cli.ts`). Before a full-access session's first command the main process copies it to `<userData>/computer/bin` beside launchers (`apps/desktop/src/computer/launcher.ts`) that run it with the app's own executable as Node: `pulpo` (sh), and on Windows `pulpo.ps1`, which PowerShell picks, and `pulpo.cmd`. `ELECTRON_RUN_AS_NODE` is set inside the launchers only, never in the agent's commands.
- Commands get that folder first on `PATH`, `PULPO_RELAY_SOCKET` (a unix socket under `<userData>/computer/relay`, or in a private temporary folder when that path is too long for one; a randomly named pipe on Windows) and `PULPO_WORKSPACE_ROOT` (`<userData>/computer/workspaces/<account>`), where the CLI keeps its copies in `files` and its manifest in `.pulpo/files.json`. The copies are per account, and the prompt and `pulpo files --help` name that folder instead of `/workspace/files`.
- The CLI posts each request to the relay endpoint (`relay.ts`). `Operations` holds it, lists it as `relay.pending` on the operation and returns the server's long-poll early. `ComputerWorkspace.execute` runs the same Files relay as the cloud and sends the answer with `operation.relay`; only the session that started the command may answer. Pulled bytes arrive through `file.receive` and pushed files leave through `file.send`, so they move like any other file.
- Local paths in `pull` and `push` are absolute paths on the computer in its own form (`ComputerWorkspace.localPath`); in the cloud they stay confined to `/workspace`.
- The endpoint is open to the user's own programs only (socket mode 0600 in a 0700 folder; an unguessable pipe name on Windows), and only while a full-access command runs. Whatever uses it gets what the reply itself gets: the server holds every request to the chat's Files scope and access mode.
- `describe` names `filesDir` only once the launchers are written and the endpoint listens. Without it the reply is told nothing about Files, as when Files are off, so an app that cannot offer them fails nothing.

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
- `pulpo files` in full access comes with the desktop app, so it needs a desktop release that includes it. Older apps keep working without Files in full access. It relies on Electron's run-as-Node mode, which the app's build leaves on (no fuse turns it off).
- Migration `0115_computer_workspace` adds `responses.computer` and `queued_messages.computer`.
- Behind the bundled nginx, `/api/computer/transfers/` streams uploads up to 1000 MiB; other proxies need the same.
