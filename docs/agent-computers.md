# Agent on your own computer

The Pulpo agent normally runs inside a disposable cloud sandbox. With the desktop app a user can instead let the agent work directly on their Mac, Windows PC, or Linux machine. This document covers how it works, how it is secured, and how to operate it.

## What the user sees

- **Desktop app → Settings → Agent → This computer.** An opt-in switch, a name, an access mode (one folder or the whole computer), a folder chooser, an approval policy, and an "Allow other devices" switch. The card also shows the live connection state.
- **Composer agent menu.** Once a computer is online, the agent menu lists "Cloud sandbox" plus each computer with its OS and access hint. Each follow-up can select any available computer or the cloud sandbox. The last choice is the default, and queued messages retain the destination selected when sent.
- **Approvals.** When the agent wants to run a command or change a file on a computer, a `pulpo_approval` item appears in the chat timeline with Approve/Deny buttons and a five-minute countdown. Approvals are handled only in the chat UI, without a duplicate native dialog. A denial or timeout fails that tool call with a message the model can see.
- **Pairing.** Other devices signed into the same account (phone, browser, another desktop) see the computer but must request pairing. The owning desktop shows a native prompt naming the device and its IP. Pairings are listed and revocable from any device; the owner can turn remote access off entirely.
- **Timeline.** The workspace step reads "Working on <name>" instead of "Started workspace", and "<name> disconnected" if the desktop goes away mid-run.

## Architecture

```
worker (BullMQ)  --Redis pub/sub-->  API replica holding the socket  --Socket.IO /computer-->  desktop main process
   ComputerWorkspace                  computer-namespace.ts                                   ComputerAgent + OperationRunner
```

- **Transport.** The desktop's Electron main process opens a dedicated Socket.IO namespace `/computer` using its stored session token and an announce payload (`computerAnnounceSchema`). The API replica that holds the socket keeps it in a local map, records presence in Redis (`pulpo:computer:<id>:online`, 60 s TTL refreshed by heartbeats), and relays worker requests published on `pulpo:computer-requests`, publishing replies on `pulpo:computer-replies`. Server-originated events (approval and pairing requests, revocation) travel on `pulpo:computer-events`.
- **Workspace abstraction.** `apps/server/src/agent/workspace.ts` defines `AgentWorkspace`. The sandbox `WorkspaceManager` and `ComputerWorkspace` (`apps/server/src/agent/computer/workspace.ts`) both implement it. The runner picks one from `responses.workspace_computer_id`. A `WorkspaceDescriptor` drives the system prompt (`policy.ts`), tool copy (`tools.ts`), attachment paths, and timeline labels. Sandbox text is unchanged.
- **Execution core.** `packages/workspace-daemon/src/core` holds the transport-agnostic runner (path policy, shell selection, search with a ripgrep fallback, journaled idempotent operations). The container daemon (`src/index.ts`) and the desktop agent share it. Windows uses PowerShell (`pwsh` when present) and `taskkill /T`; POSIX uses `bash -lc` in a detached process group.
- **Data model.** `agent_computers`, `agent_computer_pairings`, `agent_tool_approvals`, plus `chats.workspace_computer_id`, `responses.workspace_computer_id`, and `workspace_leases.kind/computer_id` (migration `0075_agent_computers`).
- **Selection rules.** `responses/service.ts` resolves the workspace: explicit selection, else the chat's last selected computer, else the sandbox. Selecting a computer requires a signed-in device session (API keys and admin chat access are refused), the admin flag `agent.computersEnabled`, and either owning the computer or holding an approved pairing while remote access is on. Authorization is checked again on every response, including inherited and queued selections. Unavailable computers fail explicitly instead of silently rerouting to the cloud.

## Security model

- **Opt-in and off by default.** Nothing connects until the user enables "This computer". Folder mode is the default; full access is a deliberate choice.
- **Folder mode is enforced on the desktop**, never trusted from the server: every file tool path is resolved against the chosen root with realpath and symlink checks, exports use `O_NOFOLLOW`, and reads outside the root or the app's attachments directory are refused. Shell commands start in the folder but are not sandboxed by the OS; the UI says so.
- **Approvals default on** for commands and file writes. The desktop refuses to start a gated operation unless it has received an approved `computer.approval.decided` event from the server, so a worker bug cannot bypass the gate. Approvals decided from web or mobile are trusted through the server.
- **Pairing per device session.** `allow_remote` is off by default. Pairing requests show the device label and IP on the owning desktop. Revoking a session, deleting the computer, or turning remote access off revokes pairings; owned computers go offline when their desktop session is revoked.
- **Kill switch.** Disabling or deleting a computer expires its leases, cancels pending approvals, kills running processes on the desktop, and disconnects the socket. Duplicate connections for one computer id supersede the older one.
- **Audit.** `audit_events` rows record registration, updates, revocation, every pairing and approval decision, and every operation (tool, truncated summary, response id).
- **No privilege escalation.** The prompt forbids sudo and administrator prompts; the desktop runs everything as the signed-in OS user.

## Operations

- **Admin toggle.** Admin → Settings → Agent → "Allow agent on personal computers" (default on). Turning it off hides computers from pickers, refuses new selections, and rejects desktop connections with `computers_disabled`.
- **Redis keys.** Presence `pulpo:computer:<id>:online`; channels `pulpo:computer-requests`, `pulpo:computer-replies`, `pulpo:computer-events`.
- **Desktop files.** `<userData>/computer.json` (config, stable computer id), `<userData>/agent-workspace/chats/<chat-id>/operations` (operation journal), `<userData>/agent-workspace/chats/<chat-id>/attachments` (staged attachments).
- **ripgrep.** The desktop bundles `@vscode/ripgrep`; packaged builds unpack it from the asar so it can be spawned. Without it the pure-Node search fallback runs.

## Local verification

1. Build shared packages: `npm run build -w @pulpo/contracts && npm run build -w @pulpo/workspace-daemon`, then `npm run db:migrate`.
2. Start `npm run dev:api`, `npm run dev:worker`, and `npm run dev:desktop`; sign in on the desktop.
3. Enable "This computer" with a folder. Confirm the Redis presence key and the `agent_computers` row.
4. In a new chat pick the computer from the agent menu. `ls` runs without approval; a file write shows an approval in chat without a native popup.
5. Deny from chat, approve from chat, and let one expire; each outcome is visible in the transcript.
6. Ask for a read outside the folder: refused in folder mode, allowed in full mode.
7. Stop the response during `sleep 60`: the process is killed. Quit the desktop mid-command: the tool fails with "went offline".
8. From a browser on the same account, request pairing; approve on the desktop; the browser can then select the computer.

## Switching and saved files

Each response keeps its own destination. Switching releases the previous active lease and restores all ready chat attachments and saved deliverables into the chosen workspace on its first tool call. Arbitrary files in a previous working directory are not copied. The model receives a current manifest so paths from an earlier computer or expired sandbox do not override restored paths.

Computer attachments live under Electron’s `userData/agent-workspace/chats/<chat-id>/attachments` directory (normally `~/Library/Application Support/Pulpo/agent-workspace/chats/<chat-id>/attachments` on macOS), separate from the configured working root. Names use the full attachment ID and a sanitized filename. This is persistent app storage, not an OS temporary folder; files are transferred in chunks with size and SHA-256 verification.

All computer RPC requests carry a validated chat UUID. Each chat has its own attachment path policy, staging inventory, and operation journal. Transfer chunks and completion must use the same chat as the upload. File tools reject other chats’ managed storage, even when it sits under the configured working root or full access is enabled; recursive file searches exclude managed storage and can search the current attachments folder explicitly. Existing flat attachment copies are left untouched and are no longer used: saved files restore into the chat folder on demand. Both the desktop app and server must be updated for this protocol change.

These checks apply to Pulpo file tools and attachment transfers. Approved shell commands still run with the OS permissions of the signed-in user; chat folders do not create an OS sandbox for shell commands.

Past approval outcomes appear only inside expanded work details on web and desktop. Pending decisions remain visible outside the disclosure so Approve/Deny are always accessible; settled outcomes are hidden entirely when work details are disabled.
