# Apple Shortcuts validation — September 7, 2026

## Environment

Built the complete Expo native application from this branch using Xcode 26.6,
arm64, and a dedicated iPhone 17 Pro simulator running iOS 26.5. Regenerated iOS
with the config plugin and installed pods; repeated prebuild confirmed a single
App Intents source reference. Generated native files and raw evidence are not
tracked.

Used the documented disposable queue account/database, a dedicated Redis on
6391, local API on 8091, deterministic provider on 8092, and this checkout's
worker and Metro server. No external model calls or production data were used.
A temporary thin native harness helped isolate App Intents signing and discovery
while the full native dependencies compiled; final navigation acceptance used
the full mobile app.

## Automated validation

- Mobile typecheck and repository lint passed.
- 482 mobile tests across 74 files passed, including native session synchronization,
  URL validation, inbox deduplication, startup delivery, and subscription cleanup.
- 16 native Swift tests passed: account scoping, URL/origin validation, exact request
  payloads, idempotency, expiration preferences, active-branch continuation, busy
  chats, temporary exclusion, reply parsing, timeouts, API failures, account changes,
  no automatic POST retries, and bounded native startup navigation.
- Real API/worker/provider acceptance passed: model catalog, atomic start, polling,
  continuation, latest reply, full-text search, temporary exclusion, and session
  revocation.
- Full signed iOS simulator build passed. Extracted metadata contains eight actions,
  four App Shortcuts, and two entity types.
- Production exports for iOS and Android passed after the final JavaScript changes.

## Full app UI acceptance

- Signed in through the normal mobile login flow.
- All eight actions appeared in Shortcuts action search; the four App Shortcuts
  appeared automatically under Pulpo.
- Ask Pulpo displayed live model/provider choices and returned
  “Completed: Shortcuts full app acceptance” in the system result dialog.
- Open Chat's live picker opened the exact saved conversation with its reply.
- Verified the composer accepts an unsent follow-up after Open Chat.
- New Chat opened the composer and restored an existing unsent new-chat draft after
  navigating through a saved chat. Navigation did not send either draft.
- Built a two-action Start Chat → Open Chat workflow. Shortcuts automatically wired
  the typed Chat result into Open Chat. With Pulpo terminated before running, the
  workflow created a chat, launched Pulpo, and displayed the matching prompt and
  completed reply.
- Repeated New Chat while Pulpo was running to exercise the native event path and
  verified the preserved draft again.
- Reviewed the native Settings section, toggle, guidance, and Open Shortcuts link.
  Disabling access caused Find Chats to report “Enable Apple Shortcuts in Pulpo
  Settings first.” Re-enabled access for subsequent tests.
- Signed out through the app’s normal account flow. Find Chats then reported
  “Unlock your device, open Pulpo, and sign in before running this shortcut.”

## Issues found and fixed during simulator QA

1. OpenURLIntent rejects custom URL schemes. Navigation actions now use iOS 26
   foreground execution with a native inbox, rather than OpenURLIntent.
2. Opening a saved chat initially left its composer disabled. The shortcut handler
   now uses the normal history transition's completion callback and content-focus
   request; verified text entry after the fix.
3. Cold launch could deliver navigation before JavaScript subscribed. The native
   inbox retains requests until the bridge is ready, subscribes before draining,
   and deduplicates through request IDs. Added native/bridge regressions and reran
   the cold composed workflow successfully.
4. Expo's generated internal import required a matching explicit import access level
   in the app-target intents file; verified by the full native build.

Simulator App Shortcuts execution required a development signature with team
identity as well as Xcode's embedded simulated Keychain entitlements. Catalog
visibility alone did not establish runtime functionality. See SHORTCUTS.md for
signing guidance.

Physical-device Siri voice recognition, lock-screen authentication prompts, Action
button invocation, and hardware background time limits were not exercised. Slow
responses, account/server mismatch, and temporary-chat semantics are covered by
the native tests and real API acceptance rather than every combination in the UI.

## Dev synchronization — September 7, 2026

Merged dev through `92d02b49`, retaining the dictation imports alongside Shortcuts.
Shortcut chat navigation now cancels pending drawer/chat preparation using the
new transition interruption helper before activating its destination.

Validation after the merge: 567 mobile tests across 85 files, 16 native Swift
tests, mobile typecheck, repository lint, and production iOS/Android exports all
passed. The full native simulator build and UI acceptance above predate this
merge; they were not repeated for this synchronization.

## Agent Mode toggle — September 7, 2026

Ask, Start Chat, and Continue Chat now expose an Agent Mode boolean, defaulting
to off. The native client checks the catalog's server and model capabilities
before submitting an enabled request. Continue validates its saved chat's model.
Server errors remain authoritative; unsupported requests are never retried with
Agent mode off. Existing shortcuts and explicit-off actions preserve their behavior.

- 20 native tests passed, including enabled saved/temporary starts, enabled branch
  continuation, default-off payloads, missing/disabled server or model capabilities,
  removed models, and a server rejection after a successful capability check.
- 567 mobile tests, mobile typecheck, and repository lint passed.
- Compiled the current App Intents and core in the simulator harness. Xcode's
  extracted metadata confirms an Agent Mode boolean with default false in the
  expanded options of all three actions.

Agent request payloads and capability failures were exercised with the native
URLProtocol transport fixture; a live agent workspace/tool execution was not run
for this toggle change. The mobile app's existing agent request endpoints and
server enforcement are reused.

The Agent-toggle follow-up also incorporates dev through `34e59935`. The session
recovery merge preserves native credentials when new-server discovery fails and
clears them immediately on unauthorized sessions, including secure-storage failure.
Added assertions for both cases and isolated the native mocks between tests.
After this merge, all 576 mobile tests, mobile typecheck, and repository lint pass.
