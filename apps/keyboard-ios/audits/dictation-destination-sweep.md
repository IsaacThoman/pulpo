# Dictation destination sweep

## Frozen independent protocol

Frozen before opening implementation, tests, or earlier audits. Parent baseline:
`2c03d2e5e37ed3dbd48c5a24c03249e9b1cc65af`. No other agents' reports are input.
This protocol concerns asynchronous speech results arriving while the host is edited.
The oracle is intent preservation: automatic insertion requires affirmative evidence
that both the request generation and insertion destination still match. Ambiguity
must preserve a usable transcript recovery path; cancellation must prevent automatic
insertion. No transcript may be persisted outside the existing dictation bridge
policy, and private fields must not become recovery destinations implicitly.

For each case, start recording with a known field, caret, selection, and request;
mutate only the named dimension while completion is pending; then deliver the
result twice and exercise recovery. Record actual code/test evidence separately
from host-device observations. A successful safe refusal requires visible recovery
or confirmation, not merely avoiding insertion.

| Case | Mutation before completion | Acceptance oracle |
| --- | --- | --- |
| D1 | Change to another field with different visible text | No automatic insertion; transcript remains explicitly recoverable. |
| D2 | Change to another field with identical text/context | Field identity change must invalidate automatic insertion when observable; when identity is unavailable, require explicit confirmation for ambiguous destinations. |
| D3 | Move caret within same field | No insertion at an unconfirmed new caret; recovery can intentionally insert there. |
| D4 | Select or replace a range | Do not overwrite an unconfirmed selection; capture selection in destination evidence. |
| D5 | Hide context (nil), including secure/private input | Unknown context is not proof; refuse automatic insertion and avoid transcript exposure/persistence in private input. |
| D6 | Truncate or lag host context around a caret move/edit | A matching prefix/suffix alone must not authorize an uncertain destination. Document unavoidable host observability limits. |
| R1 | Cancel request A, receive late A, then start B | A never automatically inserts or overwrites B's result/recovery. |
| R2 | Reuse request ID for a later recording | Old completion cannot become a new request's completion solely by sharing its ID. |
| R3 | Deliver repeated completion or repeated recovery action | At most one successful insertion per result; rejected actions keep recovery usable. |
| R4 | Recover after field switch, selection, keyboard hide/show | Recovery explicitly targets current destination, explains refusal, and survives ordinary UI reconstruction according to existing policy. |
| R5 | Receive stale cross-process state after cancellation/completion | Terminal or superseded request cannot resurrect as active; ownership is checked before mutation. |

### Planned verification (frozen)

1. Inspect bridge, keyboard controller, service boundaries and existing test harnesses
   without opening earlier audits or other agents' reports. Do not edit
   `App/HostReturn.swift` or `DictationService.swift`; do not perform simulator
   mutations or builds.
2. Select a concrete failing transition, demonstrate its baseline failure with
   executable platform-free coverage where possible, and make one coherent fix.
3. Add real controller/UI coverage for the parent to run. Run meaningful
   platform-free tests locally. Distinguish passed checks from tests requiring iOS.
4. Rerun the frozen cases through independent source tracing/test assertions and
   record failures and caveats honestly, including any unproven device behavior.

## Baseline evidence

The protocol above was authored before the first implementation/test read. Its
unchanged text is preserved in commit `65bf8385` (the separate commit was made
after initial source tracing; it is not a claim that inspection happened after
the commit). No earlier audit or other agent report was read.

Concrete baseline defect: `KeyboardController.dictationStateChanged()`'s
`.finished` branch checked pending request ID and `wasDelivered`, marked the
result delivered, then called `engine.insertTranscript(text)`. It did not capture
or compare destination identity, either context side, selection, private traits,
or loss of visibility. `KeyboardEngine.insertTranscript` deliberately inserts
at the current document caret and can replace the current selection. The
controller therefore owned a missing safety check; the engine was not a guard.

`DictationDestinationBaselineTests.matchingRequestDeliveryDoesNotProtectAChangedField`
executes that actual engine boundary without a lexicon: capture field A, change
the UUID and text to field B, call the baseline delivery primitive, and observe
`another field spoken words`. This diagnostic reproduction passed (one test);
its passing status means the unsafe request-only path was reproduced, not that
the baseline passed acceptance. It remains in the tree to make that boundary
explicit. An initial invocation ran zero tests because the temporary test file
was written to the wrong relative path; a second invocation failed to compile
because the fixture omitted the engine's required nil dependencies. Both were
corrected before the successful reproduction. No controller baseline execution
on iOS is claimed.

Boundary tracing also found existing safeguards and limits: service callbacks use
`DictationRequestLifecycle.Attempt` generations internally, while the cross-process
state carries only request ID and timestamp. Pending request matching rejects
other IDs; cancellation clears pending; delivery history retains one ID. The
service's standby publications keep its finished phase/transcript, but service
initialization writes idle and a subsequent recording replaces the single result.
A related controller ownership defect was found on the final source pass:
Done/Cancel fetched the shared pending UUID when tapped, rather than retaining
which request the panel had shown. A stale control for A could issue stop/cancel
for B, and Done after completion could replace the recovery panel with a spinner.
Neither service nor HostReturn was edited.

## Change and verification

Implemented one coherent change: gate asynchronous delivery on its observed
insertion destination and retain refused results for an explicit current-field
confirmation.

- `DictationDestination` captures identity, exact before/after contexts, selection,
  and traits only in memory. It does not read private field text. Automatic
  insertion requires an identified public field, both observable context sides,
  no selection, and an unchanged snapshot.
- The controller captures the guard before issuing its fresh UUID request. Every
  will/did host callback invalidates automatic delivery, even when the proxy is
  lagging; disappearing invalidates it too. Restoring an earlier snapshot cannot
  revive permission. A reconstructed controller lacks origin evidence and asks.
- Refusal leaves `pendingRequest`, existing `state.json` transcript, and delivery
  marker untouched. The panel says **Transcript ready**, explains selection,
  privacy, or Full Access restrictions, and offers **Insert Here** only for a
  public caret with Full Access. Cancel explicitly discards the pending request.
  Document callbacks refresh recovery after a field/selection/trait change.
- Confirmation rereads bridge ownership, phase, publication timestamp, delivered
  marker, visibility, current destination, and callback revision. A stale tap
  refreshes the prompt rather than inserting. A successful attempt consumes
  pending once and refreshes engine traits before inserting. The action captures
  destination evidence and result identity/timestamp, not transcript text.
- Done/Cancel capture their displayed request and check pending ownership before
  sending a command. Done also rereads the recording phase, so a delayed tap cannot
  put a finished result back into transcribing. A requirement/error close action
  closes its panel without cancelling some unrelated shared pending request.
- No transcript was added to defaults, logs, clipboard, diagnostics, or another
  file. The existing bridge storage/retention policy is unchanged. Bridge
  injection allows actual controller/UI tests to use temporary files/defaults.

The deliberate UX tradeoff: a host round trip, missing identity (including the
current in-app preview adapter), nil context edge, or even a redundant host
callback can require an extra confirmation. The two existing end-to-end dictation
tests now assert this confirmation. Safari uses the stub's new public textarea
rather than an address field that may have private traits.

### Independent verification against the frozen cases

This is a second source trace from origin capture through callbacks, bridge
read, UI action and delivery marker, checked against the frozen oracle rather
than against a prior audit. **Core passed** below means executable macOS policy
coverage. **Controller added** means real controller/panel/bridge tests exist but
have not been built or run on iOS. No device result is inferred from source parsing.

| Case | Baseline finding | After evidence and limit |
| --- | --- | --- |
| D1/D2 | Request-only delivery accepts another field, including identical context. | Core passed: changed UUID refuses even with identical text. Controller added: actual panel button consumes recovery once. |
| D3 | Engine uses the current caret; controller has no origin. | Core passed: moved before/after pair refuses. Controller added: silent proxy update before callback requires confirmation. |
| D4 | Selected destination can be replaced automatically. | Core passed: selection blocks automatic and confirmed insertion. Controller added: pending survives until selection collapses. |
| D5 | No explicit private/hidden destination check. | Core passed: nil contexts/identity require confirmation; private capture reads zero text properties and cannot confirm. Controller added: private/Full Access transitions retain recovery. |
| D6 | No destination validation; stale/truncated context cannot stop delivery. | Core passed: exact context mismatch and explicit invalidation refuse. Controller added: both will-change and did-only callbacks with matching stale reports refuse. Fully unobservable movement remains a caveat below. |
| R1 | Pending mismatch/cancel already reject different IDs; internal service attempt guards exist. | Existing lifecycle tests passed. Controller added: late cancelled A and A's old recovery tap cannot consume B. |
| R2 | Internal service generation differs even when request ID is reused; wire has no attempt generation. | Existing lifecycle same-ID retry test passed. Controller added: old recovery action rejects a newer publication under the same ID. General same-ID wire replay remains unresolved. |
| R3 | Latest delivered ID suppresses repeated completion; there was no refused-result recovery. | Existing lifecycle terminal tests passed. Controller added: duplicate completion and repeated confirmation attempt issue one edit; refusal leaves the marker unset. Historical/reused-ID limitations remain. |
| R4 | Reconstructed/returned keyboard inserts any pending matching result immediately. | Controller added: hidden completion does not insert; a reconstructed controller retains pending recovery and requires confirmation. Depends on the existing bridge result surviving. |
| R5 | Other request IDs rejected; same-ID terminal replays lack a wire generation. | Controller source/tests cover different-ID rejection, pending ownership, cancellation, stale Done/Cancel controls, and phase/timestamp rechecks. General stale same-ID state/command replay remains unresolved. |

### Checks actually run

From `apps/keyboard-ios/PulpoKeyboardKit`:

```sh
swift test --filter DictationDestinationBaselineTests
swift test --filter 'DictationInsertionGuardTests|DictationDestinationBaselineTests|DictationRequestLifecycleTests|EditingRegressionTests|ContextVisibilityTests'
```

The corrected diagnostic ran **1/1**. The final targeted run passed **41 tests in
5 suites** (including ten new destination-policy tests and the diagnostic).
The suite was rerun after tightening did-change invalidation. Existing unrelated
Swift warnings appeared in `TouchModel.swift` and `WordDeletionTests.swift` during
the initial package build. No iOS compile/test success is claimed by `swift test`:
UIKit implementation is excluded on macOS.

From `apps/keyboard-ios` (syntax only; no iOS build or simulator access):

```sh
swiftc -frontend -parse -target arm64-apple-ios18.0 -sdk "$(xcrun --sdk iphoneos --show-sdk-path)" PulpoKeyboardKit/Sources/KeyboardUI/KeyboardController.swift PulpoKeyboardKit/Sources/KeyboardUI/PulpoKeyboardViewController.swift UITests/DictationDestinationControllerTests.swift UITests/DictationTests.swift UITests/BounceDictationTests.swift
```

Passed. An earlier syntax-only invocation without an explicit SDK passed with a
macOS-sysroot warning; the explicit iPhone SDK invocation above passed cleanly.

The HTTP fixture was smoke checked using an ephemeral local server (no simulator):

```sh
python3 - <<'PYTEST'
import importlib.util
import threading
import urllib.request
from http.server import ThreadingHTTPServer

spec = importlib.util.spec_from_file_location('dictation_stub', 'scripts/stub_pulpo_server.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
server = ThreadingHTTPServer(('127.0.0.1', 0), module.Handler)
worker = threading.Thread(target=server.serve_forever, daemon=True)
worker.start()
try:
    base = f'http://127.0.0.1:{server.server_port}'
    with urllib.request.urlopen(base + '/stub/dictation') as response:
        html = response.read().decode()
        assert response.headers.get_content_type() == 'text/html'
        assert '<textarea' in html and 'aria-label="Dictation destination"' in html
    with urllib.request.urlopen(base + '/api/mobile/config') as response:
        assert b'"dictation": true' in response.read()
    print('PASS: public dictation fixture and existing config endpoint')
finally:
    server.shutdown()
    server.server_close()
    worker.join()
PYTEST
```

Passed: both requests returned HTTP 200 and all assertions passed.

From repository root:

```sh
git diff --check
git diff --exit-code 2c03d2e5 -- apps/keyboard-ios/App/HostReturn.swift apps/keyboard-ios/App/DictationService.swift
```

Both passed. No other agents, simulator mutations/builds, deploys, language edits,
PR pushes, or prior audit reads were used.

### Parent-owned validation (not run here)

The new `DictationDestinationControllerTests` has 16 real controller tests using
`KeyboardController`, `ProxyDocument`, `SimulatedProxy`, bridge files/notifications,
and panel button actions. These tests temporarily save/restore the account snapshot;
run serially. The preview/Safari tests also require the existing stub server, app
login, and granted microphone permission; Safari needs the installed keyboard.
The parent chooses/owns the simulator and its existing permissions. After generating
the project using the repository's normal workflow, run from `apps/keyboard-ios`:

```sh
xcodebuild test -project PulpoKeyboard.xcodeproj -scheme PulpoKeyboard -destination "platform=iOS Simulator,id=$PARENT_SIMULATOR_UDID" -parallel-testing-enabled NO -only-testing:PulpoKeyboardUITests/DictationDestinationControllerTests
xcodebuild test -project PulpoKeyboard.xcodeproj -scheme PulpoKeyboard -destination "platform=iOS Simulator,id=$PARENT_SIMULATOR_UDID" -parallel-testing-enabled NO -only-testing:PulpoKeyboardUITests/DictationTests -only-testing:PulpoKeyboardUITests/BounceDictationTests
```

Start `python3 scripts/stub_pulpo_server.py --port 8091` in the parent's test setup
for the second command. The two commands above are handed off, not claimed passed.

### Remaining caveats / acceptance not proven

1. UIKit/controller tests are parsed but not typechecked or executed here. Button
   layout, accessibility, actual callback ordering, and cross-app return behavior
   require the parent's iOS run and independent review.
2. A host can move between indistinguishable truncated windows without any callback,
   or withhold its new snapshot entirely. Identity plus exact two-sided text is
   evidence, not an atomic host caret token. Fully invisible edits are not solved;
   callback invalidation is intentionally conservative. Explicit confirmation
   still depends on the person reviewing the actual current field/caret.
3. No cross-process attempt generation or monotonic terminal-state protocol was
   added. `updatedAt` binds a recovery action to a publication, not to an authenticated
   service attempt. Same-ID stale replay with the same timestamp, service restarts,
   and reordered same-ID wire states/commands remain outside the fix. The keyboard
   still creates a fresh UUID for each normal start; service-local attempt guards
   already protect asynchronous callbacks and were not changed.
4. Bridge delivery history still stores only its last delivered UUID; it is not a
   historical deduplication set or a cross-process compare-and-swap. These tests
   do not prove adversarial multi-process simultaneous consumption or arbitrary
   reused-ID delivery correctness.
5. Refusal preserves pending recovery only while the existing bridge result is
   available. Service initialization, a different recording, or external state
   replacement can overwrite the single result slot. No second transcript store
   or longer retention policy was introduced.
6. `UITextDocumentProxy.insertText` has no success acknowledgement. The delivered
   marker represents an authorized attempted insertion, not proof that a host
   accepted it. Silent host refusal/crash during insertion is an existing limit.
   Safety refusals introduced here do not set the marker or clear pending.
