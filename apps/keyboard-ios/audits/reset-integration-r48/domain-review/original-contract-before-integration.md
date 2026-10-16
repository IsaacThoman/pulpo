# R48 reset integration and new normalization-domain validation

This is a new integration round starting at published parent
`e503e5a6646208c6dc125271431bbb9d677b9bb8`. No new persistence algorithm,
normalization change, ranking change, or touch-update formula is proposed.
The intended product outcome is confirmed shared-learning reset and explicit
word removal across app/keyboard processes, truthful failure/retry feedback,
and preservation of previously supported local long-word touch learning.

## Versioned dependencies

Stage the complete ordered R45 range `5e17ab9c..abafac5f0712e8132f0da36a66de4026a93cc790`
with cherry-pick provenance. This includes all ten R33 commits, their historical
failed candidates and reviews, final R33 source `a9e6ecfc`, the one-line R45
correction `c2442112`, test-only correction `79398ca5`, and all rejected-round
evidence. Then stage R41 UI commit `c156797b` and its ordinary test/driver
commits `244566f6 82d1f164 508840da 561a6621 f3c410fc 5de06a60 b94f3b1e`
plus audit-only `48219fd0`. Do not import R41's older storage-copy commits.
Resolve merges by preserving current parent account, privacy and numeric-entry
code. Verify the three R41 production UI changes against their original diff,
and the final storage/TouchModel bytes against R45. Record all commit mappings
and any conflict resolution before execution.

The parent independently found and reproduced the original a9e long-word
regression. R45 removes only its unconditional normalized-target-length cap;
durable admission still limits each operation to 40 actual finite samples.
The existing per-word clamp reference, decay, final offset cap, normalization,
ordering and policy remain unchanged. No new algorithm is justified by an
incorrect benchmark oracle.

## Original outcomes remain original

R33's one 18/18, 361/361 execution belongs to exact a9e only. Its baseline new
API was unavailable; it is not a paired accuracy gain. R45's one new boundary
round remains REJECTED: a9e 628/652 versus derived 647/652, five shared
normalization failures, 19 correlated repairs, zero new failed IDs. The five
failures assumed full case folding of sharp s; the conserved normalizer does
not do that. Neither old input, oracle nor result will be edited or rerun to
obtain acceptance. All old failures, unavailable controls, macOS latency
outlier and native limits remain evidence, with their actual denominators.

R41's final new-control pair is 8/8 normal and 8/8 AX5; its earlier broader
pair is 13/13 normal and 12/13 AX5. Never combine these into a final 13/13
AX5 claim. Its static geometry and swipe-driver failures remain archived.
The unchanged standalone PreviewInputView lifetime assertion remains a
known failing native test, without an allowance or source change here.

## Gates for this actual merged source

1. Independent domain/source review of this contract, final source composition
   and the new public map, before a new blind author sees the map. Calibrate
   the public normalization reference separately from KeyboardCore, using
   independently derived examples. Source reviewers may inspect implementation;
   new authors must not inspect sources, dictionaries, old cases or outputs.
2. Full ordinary Release core/services and data checks, retaining existing
   opt-in skips and the same five known issue events. No new allowances.
   Preserve all old source/test receipts; current run counts stand separately.
3. Strengthen only the exposed R41 ordinary durable-zero observation: a fresh
   reader must report `.ok` before zero values count. Retry only bounded read
   observations reporting `.busy`; never retry a mutation automatically.
   Keep real lock/open-I/O faults, seed retention after release, actual success
   and error UI, explicit retry, relaunch and unchanged learning policy.
4. On one fresh owned iOS simulator, validate the actual merged app, controller
   and UI through the focused native controls with real fault gates. Include
   the current numeric/privacy/account integration controls as appropriate.
   Preserve skips, failures and fixture corrections; no successful raw build
   log reads. Normal/AX5 results must name the exact binary and test set.
5. A genuinely new, separately sealed public-API boundary round may establish
   compatibility under the corrected public domain. Implement all required
   validation, relational checks and corruption rejection before sealing.
   Use unique fresh local storage, nonvacuous learning controls, full 26-offset
   and weight observations, explicit read status, save/reopen relations,
   exact operation/ID accounting and finite values. Bounds and failed-call
   no-mutation begin after settled construction/preseed; diagnostic status
   may change. Unavailable/error cannot count as pass. One paired execution
   per frozen version, no after-reveal tuning. Original a9e is the comparison
   source for API compatibility; the final integrated source is the candidate.
   Whole Core source-tree differences must be retained and qualified.
6. Parent review determines release admission from the complete evidence.
   Source/ordinary acceptance alone, a passing original round, and partial
   native controls do not establish whole-feature or new blind acceptance.

Any new benchmark failure is retained as a failed gate. A rejected payload
is not repaired in place. If there is no source defect, do not alter product
semantics merely to satisfy an oracle. A bounded component disposition must
explicitly distinguish itself from full-round acceptance.

## Scope and limits

Shared clear cannot erase inaccessible extension-local fallback storage or
transient contact vocabulary. Busy/I/O failure differs from uncertain/cleanup:
the latter may already have committed, so failure copy must not promise
unchanged data. No new native suspension, remote extension ordering,
file-protection, spoken VoiceOver, forensic erasure, Gboard superiority,
population accuracy or iOS latency bound is inferred.

No physical deploy, push or merge until concrete parent validation is complete.
No quiet performance window is reserved. Preserve other workers' devices and
sources; use an owned disposable simulator, exact-UUID operations, standard
simulator signing and serial native execution. Root owns this integration;
R39 owns transcript work and R47 owns the separate extra touch-learning path.
