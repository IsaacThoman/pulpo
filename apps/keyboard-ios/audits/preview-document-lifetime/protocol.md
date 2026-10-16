# R21 preview document lifetime — frozen acceptance v1

Baseline production commit: `f17109e7`. Freeze this protocol and the three
`PreviewDocumentLifetimeTests` methods before changing production source.
Synthetic strings only; no accounts, user text, persistence, or corpus.

1. Retain the actual PreviewInputView, controller, engine and its document from
   the real window-mounted SwiftUI PreviewTextView. Trigger normal representable
   dismantling; retain its coordinator only for ownership assertions. A weak host
   reference MUST become nil. Do not retain the host to prevent a runtime trap.
2. Repeat through preview → system → new preview on the same UITextView, proving
   the old host deallocates and the new controller differs. The retained old
   document must never bind to the replacement host/editor.
3. After deallocation, document before/after/selected reads must be nil and
   hasText false. Direct insert/delete, engine insert/delete, engine refresh,
   controller refresh and queued main-thread refresh/mutations must be inert.
   Original/replacement native text, selection and shared draft remain unchanged.
4. Live-host control must preserve Unicode selection/context and insert/delete.
   Cursor adjustment is outside scope; do not change or invoke that API.

Red acceptance: a native unowned-access SIGABRT after weak-host nil is valid
evidence, even if the runner aborts before all methods finish. Record exact
selected methods, first crashing access, command exit, runner/restart semantics,
result summary issues and stack evidence available. Do NOT call an aborted
selection a finalized all-method result. Do not attribute R17 historical crashes
without their matching stacks. A test assertion failure must be investigated.

Green acceptance: all frozen development methods and separately authored
lifecycle counterchecks finalize with zero failures/skips and no runtime crash.
Run full DraftEditorTests (including boundary ranges and parent's real held
delete detach test) and the established draft/app navigation regression selection.
Any unrelated failure remains visible and is not silently patched or disabled.
R17 broader UX six unexecuted cases remain unexecuted.

Execution: exclusively iPhone 18 Pro `7E1D7979-7307-4C53-8466-BB41154B383C`;
never iPhone17, E1C6B89D or performance trees. device_list then device_open were
attempted first. Both returned the raw error
`Device list failed: The device command failed (exit code 127).`
Use repository XCTest/CoreSimulator fallback, serial
`-parallel-testing-enabled NO -collect-test-diagnostics never`.
Raw logs/xcresults stay in /tmp; version only small fixture/evidence/audit.
