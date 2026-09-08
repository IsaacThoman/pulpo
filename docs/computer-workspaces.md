# Computer workspaces and recovery

The Workspace picker selects No workspace, Pulpo, or a registered computer and working folder. Each submission captures its selection. Composer changes affect later submissions; explicit recovery changes only the active response. Legacy `agentMode` booleans map to Pulpo/None when a selection is absent.

Pulpo retains model calls, agent context, conversation state, tool selection, limits, and accounting. Computers receive execution operations through an authenticated `/workspaces` Socket.IO namespace on the existing `/socket.io` transport. PostgreSQL owns operation identities, dispatch markers, results, response generations, and recovery state. Redis and sockets provide notifications.

## Desktop hosting

Enable hosting in device settings on macOS or Windows. The native consent dialog explains that commands have the OS user's access: the selected working folder is **not a sandbox**. The native folder picker starts in Documents/Pulpo. Hosting never automatically elevates privileges.

The desktop main process encrypts the revocable device credential with Electron's native secure storage. The credential is bound to the enabling session. Sign-out, session removal/expiry, account deletion, and disabling hosting remove execution authority. Removing a session retains operation history while removing its authorization binding.

An Electron utility process performs execution outside the renderer. It inherits an allowlist of environment variables when starting commands. Its journal is outside the selected folder, in application data. Commands serialize per registered folder. Atomic acceptance/result files, stable canonical argument hashes, and server dispatch markers prevent replay after redelivery or an uncertain restart. A missing journal for a previously dispatched command produces an unknown outcome.

Closing a window leaves enabled hosting in the tray/menu bar. The menu offers status, Open Pulpo, Disable hosting, and Quit. Quit stops local processes where possible and disconnects the service. Starting at OS login is not included. Windows uses PowerShell and process-tree cancellation; macOS uses the user's native shell and process groups. Ripgrep and the tray image are explicit packaged resources.

## Waiting and recovery

A command must acknowledge or update its status within 30 seconds. Hosts report status every 5 seconds; a connected socket alone is insufficient. Healthy silent commands stay active. Successful managed status polls count as progress. Capacity waits expose the same recovery UI after the existing 15-second delay.

On suspension the runner persists the pending tool call and agent context, retains an `in_progress` response, and returns its worker slot. A five-second scanner schedules reconciliation; a dedicated PostgreSQL advisory lock serializes agent runners. Response generations serialize recovery and fence the prior workspace. The chat queue remains blocked by the nonterminal response.

- **Keep waiting** retains the operation and renews the configured workspace wait deadline (default 15 minutes).
- **Switch workspace** and **Continue without workspace** retire the prior generation and request cancellation. If dispatch may have occurred, confirmation explains that the command may continue and local files stay behind. The abandoned tool call receives an explicit uncertain outcome; its side effect is not replayed.
- Reconciliation obtains existing results before another model call. A managed operation is read by its existing ID; a missing operation or changed lease is not redispatched.
- Late results remain in execution records without changing the resumed response. Cancellation is never represented as successful solely because it was requested.
- Deadline expiry fails the response with a recoverable error, retires outstanding operations, and settles prior usage. Paused time does not consume the active runtime limit. Model usage and managed workspace costs carry across resume; computer sessions incur no managed workspace charge.

Attachments are staged under a dedicated response directory in application data. File tools map `/workspace/…` to this directory; shell prompts identify its native path. Project files are not copied during switching. Exported files use the existing Pulpo attachment storage and can be downloaded from another client. Computer transfers are bounded to 25 MiB per file (20 MiB for image reads).

## Rollout

Apply additive migration 0070 (after the speech migrations on `dev`) and update all API and generation workers before releasing updated clients. Existing PR preview databases recognize the original workspace migration by checksum, preserving registered computers while applying the intervening speech migrations. No existing selection requires a backfill. Older clients continue sending booleans and never advertise computer hosting. The Socket.IO transport accepts bounded base64 file transfers up to 40 MB; infrastructure must allow the existing WebSocket route. Do not expose desktop hosts directly to inbound network traffic.

## Validation

Local checks include repository lint/build and the full package test suite, native macOS execution/cancellation, consent/secure-storage lifecycle tests, recovery component tests, and a packaged Electron utility-service smoke test (search binary, export, process cancellation, tray creation, and window retention).

`apps/server/src/workspaces/integration.test.ts` uses disposable PostgreSQL and Redis plus the real device namespace and native executor. It covers legacy composer updates and explicit selection sync, ownership and folder grants, durable dispatch/redelivery, missing acknowledgment and operation heartbeats, healthy silent work, deadline renewal, concurrent recovery, stale results, queue blocking and unchanged queued selection, no replay during a switch, artifact export, session revocation, and resume/expiry accounting. Provider output is deterministic; no live model credentials are needed.

To run it, migrate a **disposable database named `pulpo_workspaces_test`**, set `DATABASE_URL`, `REDIS_URL`, and `PULPO_WORKSPACE_TESTS=true`, then run `npm run test -w @pulpo/server -- src/workspaces/integration.test.ts`. The fixture truncates users/providers in that database. Run `npm run package -w @pulpo/desktop` followed by `npx electron scripts/smoke-workspace-package.cjs` from `apps/desktop` for the packaged smoke test.

The PR adds macOS/Windows native and packaging CI. Local validation was on macOS; Windows evidence comes from that job. A physical mobile-to-desktop workflow, actual machine sleep/wake, and full application tray interactions with a signed-in user remain manual platform checks. The automated end-to-end test exercises the server agent and native executor with simulated connectivity loss and artifact retrieval; it does not claim to replace those device checks.
