# Independent R33 pre-coding protocol review — round 3

Decision: **APPROVE FOR IMPLEMENTATION** the exact `contract-preflight-v3.md`, `schema-preflight-v3.json`, and `public-api-v3.md` identified below. No concrete blocking pre-coding correction remains. This approves a workable design and public verification vocabulary; it does not approve a candidate implementation or certify any unperformed gate.

## Exact inputs and evidence

Review root: `/Users/isaacthoman/.t3/worktrees/pulpo/t3-75300fc6/apps/keyboard-ios/audits/learning-reset-r33`.

Approved input SHA-256 values:

- `contract-preflight-v3.md`: `a517f4b627b3575a99d0959240a0a6bd3a0dd2781c7d763c52214fe714799ccd`
- `schema-preflight-v3.json`: `2b7a34f6c482a6ac0ffe7f23c2d9964c72b6f31c34eed3f0b7aa59f75e4cb6ef`
- `public-api-v3.md`: `85289af4b0993e78250b0d223d28aa4568ca0488036dd0356f1818c8c701997e`

Read the original brief, findings, responses, and unresolved objections in these retained inputs:

- `contract-preflight-v1.md`: `2e139d8f0b8ad166a8bb51a0e2fcc07e181f5092217bfb86a396b350070bcef7`
- `protocol-review-v1.md`: `77e045b2dd8f83aeab974431e3b7919c322d87608f96f6c8c17260ea66e8247f`
- `contract-preflight-v2.md`: `7449329e06001017f35411fe1555fa6e45841b6f4c75484a27911e0cb45be588`
- `protocol-review-v2.md`: `3571b2443a66dd789a144776232cae57802a568825ea258cf26aa9c6e997b116`

The v3 file retains the exact v2 baseline, then explicitly makes corrections A–H binding over conflicts (contract lines 49–67). This approval applies to that precedence rule, rather than treating superseded baseline sentences as additional requirements. Parsed the schema as JSON and reviewed all 19 operation definitions and the public map. This is static input inspection, not runner or product execution.

HEAD: `305a8893911b7ba54186110ea9f0b919c9d6382e`. Git status showed only the untracked R33 audit directory, consistent with the stated absence of product changes. The only additional product source read was the current `TouchModel.swift`, to check the once-per-word reference offsets, clamp radius, maximum offset, and decay constants behind correction E. Its SHA-256 was `5fa3c3e595c959581a771c1f502a1cccbd103f247b54bf367c1d073220936549`.

No product or repository files were edited. No tests, builds, devices, deployment, blind payloads, development outcomes, delegation, or unrelated repositories were used. This `/tmp` report is the only authored artifact. Earlier review reports are historical evidence, not newly performed source/runtime verification.

## Resolution of the three round-2 blockers

1. **Writer-slot exhaustion no longer prevents reset or observation.** Correction A makes construction, reads, migration, immediate forget, individual reset, and combined reset slot-independent. Slot acquisition is lazy and required for token-bearing work. The full-slot ninth-process outcome is explicit: read/reset succeeds with the global lock free, and returns busy when that lock is held. Reset revokes rows without reclaiming live owners. The local registry cap cannot independently prevent slotless reset/read, and same-authority exclusion must still be shared. Admission capacity remains an explicit, acceptable backpressure outcome.

2. **Admission uncertainty and terminal acknowledgement now have a complete bounded lifecycle.** Corrections B–D require a durable unique identity, never-reused incarnation sequence, and immutable local reservation before admission. Confirmed admission installs exactly one eligible local record before returning true. Unconfirmed admission returns false/uncertain without teaching; its bounded ineligible reservation is subsequently cancelled, never applied. Terminal deletion follows removal from every replayable local collection, and failed deletion consumes the same fixed capacity. Unexplained missing or mismatched identities are invalid, never replay permission. Payload and committed status remain atomic; a retry reads durable status before application. Immediate forget/reset/migration also reconcile errors or report uncertainty without promising unchanged state. These rules close both false-admission leaks and successful-commit/delayed-ack double application without persisting tap payloads or historical forget watermarks.

3. **The exact public vocabulary can observe success and failure.** Correction F, schema operations, and the mandatory public map distinguish constructor/observation outcomes from visible-change Bools and admission from completed persistence. Fresh zero-state oracles require successful reads. Every mutation, including a single kept-word touch admission and asynchronous send/receive touch, has an asserted typed outcome. Intentional over-byte/invalid inputs are expressible and must be rejected explicitly. Background acknowledgement means enqueue only. Actor control permits one pending reply, with runner controls during a gate. Correction G and `reportCommitError` explicitly exercise a surviving caller after the real successful COMMIT reports an error, separately from precommit failure and delayed acknowledgement. Healthy reconciliation must confirm success once; forced-unavailable reconciliation retains the separate uncertain/cancellation oracle. Unsupported injection is unavailable, not passed.

## Other accepted design provisions

The bounded registrar plus SQLite architecture remains accepted. Transactional admission determines eligibility; serial payload application/revocation and speculative local projections do not claim strict real-time durability of every learn call. Immediate normalized-key forget revokes earlier matching pending tokens while retaining unrelated valid learning. Later relearn/pin is a new registration. Ordinary merge preserves operation counts, pair targets, per-operation order, and touch word grouping. Combined reset changes both current payloads/epochs and token eligibility in one transaction; individual reset preserves the sibling store.

Correction E enforces new payload byte caps before COMMIT, post-normalization string bounds, finite numeric/overflow validation, and explicit SQLite resource settings. The touch sum predicate is consistent with the current 0.4 offset limit plus 0.45 sample radius and weighted decay. At 256 outstanding records, the permitted synchronous nonblocking capacity flush and required beyond-256 long-typing coverage prevent treating permanent adaptation shutdown as success. Reservations and acknowledgement backlog share the cap. No valid unrelated data or blocks may be evicted to conceal capacity failure.

The accepted fail-closed marker/migration policy, dedicated namespace, hot-journal recovery ordering, mixed-version limitation, and cleanup-failure distinction remain accepted. This review introduces no new counterexample requiring their replacement. Confirmed precommit failure preserves both stores; uncertain and postcommit-cleanup failures have explicitly different guarantees. Leftover legacy files never authorize reimport.

Nonblocking local/global ownership, genuine coalesced background payload saves, explicit busy backpressure, and bounded compatibility-test retries remain accepted. Filesystem work has no hard deadline, and suspended global ownership prevents progress until availability returns. Getters and the unchanged letter path perform no new persistence observation. Test-format adapters must retain the original semantic and privacy assertions and clean the actual authority family.

## Approval boundary and retained dependencies

Implementation may now proceed within the approved R33 scope, including the required AppModel glue. No engine, speculative preview, parent-owned UI, or per-letter work is authorized by this approval. Parent/R28 Settings Bool/error wiring and explicit-forget outcome behavior remain release/integration dependencies, not prerequisites to starting product coding. A pending owner request is not integration proof. Reachable shared storage success does not certify inaccessible fallback erasure or immediate invalidation of every remote cached suggestion.

All original development and release obligations remain: true separate-process barriers for both stores; full-slot and stopped/killed-owner behavior; exact merge/forget/relearn/pin/case/accent/pair and nonlinear touch oracles; precommit, post-success, and uncertain-result fault coverage; long-typing capacity flush; migration, cleanup, no-URL, transient/private behavior; resource/high-water and unchanged-letter/word/full-storage performance evidence; complete core/data/services gates with the original five known core issues and unchanged accuracy ceilings. Native iOS UI/suspension proof remains a separate unavailable gate until actually performed.

The runner/validator and actual API still need implementation and verification against these approved inputs. Some development obligations exceed the bounded JSON adapter and must retain their explicitly separate evidence; absence from that adapter is not a pass. Preserve independent blind-author separation, exact immutable input/capability hashes, static validation before sealing, candidate/runner/source-review/gate freeze before one reveal, unavailable denominators, and no post-reveal tuning. R29 remains failed/frozen. None of these gates or a nonexistent final candidate is approved by this pre-coding decision.
