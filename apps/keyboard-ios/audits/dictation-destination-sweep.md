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

Pending inspection.

## Change and verification

Pending implementation.
