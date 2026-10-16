# R35 public account runner protocol v1

This document is the only application information supplied to the independent fixture author. Do not inspect application source, development fixtures/results, candidate changes, or any other file in this checkout. Author new meaningful schedules from this protocol, not variations of a disclosed failure. Use fake values only.

## Capability and state contract

The runner drives the actual app account model with a real URLSession and PulpoClient. A controlled URLProtocol holds HTTP responses; it does not call a real server. Each case starts signed out with its own app-only Keychain service and snapshot UserDefaults suite. No extension networking or credentials in snapshots. A separate native UI proof covers sheet controls; this runner does not tap SwiftUI, simulate audio, permission dialogs, physical devices, VoiceOver, dictation deep links, or simulate Keychain write failures.

Login fetches config then POSTs login. Refresh of a signed-in account fetches config and me concurrently, awaits config first, and commits config plus user together. Login captures the submitted server/credentials; no server challenge token exists. Two-factor is a 401 error with code two_factor_required; another submission can include a code. Model errors are observable, but UI challenge/focus/back/error state is unavailable in this runner. Task cancellation need not cancel already-issued HTTP server work, and transport may discard a released response after cancellation.

Submitting a newer login immediately revokes older login and refresh publication authority. Success persists the session, updates in-memory session, and publishes a token-free snapshot. An ordinary login failure/2FA preserves any previous account. The newest authorized login can succeed after cancellation/failure. Explicit sign-out revokes all earlier login/refresh work and clears memory, Keychain, and snapshot synchronously. A late success/failure must not restore an account or modify a replacement. No abandoned-session remote cleanup is attempted. Explicit remote sign-out may issue one logout for the current session; a late logout never clears a later login.

Refresh uses latest-started-wins within an account authorization generation. A newer refresh irrevocably supersedes older refreshes even if it later fails/cancels. Starting login invalidates prior refreshes even if login fails. A refresh launched while login is pending is permanently disqualified from publication and unauthorized sign-out, including after that login fails, its Swift task is cancelled, or its authority is revoked. A successful login also invalidates refreshes launched during its work. Only an eligible current refresh's success may update the stored user/capability, and only an eligible current refresh's observed unauthorized error signs out. Other errors preserve cache. Because config is awaited first, a failed config can determine the error; do not assume a simultaneous me 401 overrides it. A cancelled Swift task cannot publish.

Cancelling a specific login's authority leaves any previous stored account intact and permits retry. The candidate exposes this synchronous operation; the baseline lacks it and records that step as unavailable (never a pass). Compare common operations separately. View cancellation/dismissal additionally cancel their owned Swift task in the native proof. Server edits and 2FA Back are UI-only and unavailable here; a new startLogin provides explicit new server/credentials/code.

## JSON schema

Write a JSON array of cases. Each case has `id` (unique string), `purpose` (string), and `steps` (array of objects). Each network host MUST be a unique subdomain ending `.r35.invalid` within the whole fixture set. Login labels/task IDs are unique within a case. All user/token/password values are fake. Every case must settle all tasks and release issued requests (or explicitly describe why transport cancellation prevents completion). No wall-clock sleeps or random schedules.

Operations:

- `{"op":"startLogin","id":"L","host":"one.r35.invalid","email":"fake@example.invalid","password":"fake-password","code":"123456"}` starts the actual model signIn Task. email/password default as shown; code is optional. Returns before HTTP completion. Multiple tasks allowed.
- `{"op":"startRefresh","id":"R"}` starts actual refreshAccount; no account means immediate no-op.
- `{"op":"awaitRequest","id":"Q","host":"one.r35.invalid","path":"/api/mobile/config"}` waits until the next matching request is issued, reserves it by Q, and records exact method/host/path, fake bearer, decoded fake JSON body. FIFO for same host/path. This is a deterministic issued-request barrier. Later responses reference Q. me/config may be reserved in either order.
- `{"op":"respond","id":"Q","status":200,"body":{...}}` releases that reserved HTTP request with JSON. Body may be null for 204 logout. Does not await model completion. If transport already cancelled it, record a discarded late response rather than inventing a server recall.
- `{"op":"waitTask","id":"L"}` waits until that login/refresh completes. Login records success/error/cancelled as exposed by the model (transport cancellation may be a network error); refresh consumes errors and records finished. Bounded timeout is a retained runner failure.
- `{"op":"cancelTask","id":"L"}` cancels the actual Swift task. It does not explicitly sign out or clear cached account.
- `{"op":"revokeLogin","id":"L"}` synchronously cancels that login's local authority WITHOUT cancelling transport, so late responses remain deliverable. Baseline records unavailable; candidate invokes its production authority API. This tests authority, independent of cooperative network cancellation.
- `{"op":"signOut","remote":false}` invokes actual signOut; remote defaults false. If remote true and signed in, reserve/release logout via the same request operations. No real network.
- `{"op":"checkpoint","id":"C","expected":{...}}` checks memory, reloaded Keychain StoredSession, and decoded snapshot. Expected fields: `name`: string or null, `host`: string or null, `token`: string or null, `dictation`: boolean. All four required. name null implies fully signed-out snapshot. Store and memory must agree on these fields; snapshot has name/host/dictation/signedIn but no token. Each checkpoint checks exact values, not an implementation-derived oracle. Raw snapshot bytes must exist and decode; only declared snapshot fields are accepted. Primitive counts are reported, never inferred from pass/fail.
- `{"op":"reload","id":"D","expected":{...}}` first asserts the existing memory/Keychain/raw decoded snapshot before reconstruction, then constructs another actual AppModel against the same isolated stores and asserts the same expected state; only allowed when all tracked tasks are settled. It additionally waits for already-started remote logout completion. This tests same-process Keychain reconstruction; the snapshot is verified before init can republish it. It does not prove a process restart, disk flush, crash consistency or protected-data behavior. It does not replace the driver model or clear persisted state.

Exact endpoint JSON shapes (additional optional user fields are unnecessary):

Config GET `/api/mobile/config`: `{"instance":{"name":"Fake instance"},"capabilities":{"dictation":true}}`.

Login POST `/api/mobile/auth/login` request: email/password/deviceLabel/appType=mobile/platform=ios; twoFactorCode only if nonempty. Response: `{"user":{"id":"fake-id","name":"Fake Name"},"session":{"token":"fake-token","expiresAt":"2099-01-01"}}`.

Me GET `/api/mobile/me` sends captured session's `Authorization: Bearer fake-token`. Response: `{"user":{"id":"fake-id","name":"Updated Name"}}`.

Logout POST `/api/mobile/auth/logout` sends captured bearer, no body; 204 null response.

HTTP errors: `{"error":{"code":"two_factor_required","message":"Enter fake code"}}` with 401 means challenge; 401 code unauthorized means expired session; 403/500 with fake message are ordinary errors. Invalid JSON shapes are supported real decoder failures, but must be used deliberately with explicit expected cached state.

## Evidence and availability

Runner reports retain each input step, issued/response/cancellation trace, task outcome, exact checkpoint actuals and expectations, and primitive counts: HTTP issued by method/path, successful account save call sites, clear call sites (not OS success), and snapshot publish call sites (not physical disk writes). Init/reload publications count; disposal cleanup does not. HTTP counts occur at issuance, including unexpected and cancelled work; every issued request retains reserved/released/cancelled disposition. Final drain awaits started remote logout completion and retains unaccounted-request or teardown failures. Latency includes bounded request wait and Keychain I/O; no allocation instrument is built into this runner. No operation is silently dropped. Unsupported/missing request/timeouts/unsettled work are retained as unavailable/failure, not assigned a guessed oracle. Baseline and candidate receive identical fixtures once source/runner/comparison are frozen. No policy retuning after reveal; failures and unavailable cases remain in the final report.

Author deliverable: `/tmp/r35-heldout-private/cases.json` plus `/tmp/r35-heldout-private/author-notes.txt` with semantic categories and expected effects/unavailability. Keep cases hidden from the implementation agent until the freeze/reveal signal. Aim for 16–24 concise, distinct schedules, including successful controls, late success/failure, supersession/retry/two-factor, task cancellation, sign-out, refresh identity/order, durability, and optional authority-only cancellation. Do not use every operation in every case. Publish only a seal hash/count/schema status to the parent initially; do not reveal cases or per-case expectations.
