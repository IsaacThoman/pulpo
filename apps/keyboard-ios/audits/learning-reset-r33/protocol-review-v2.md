# Independent R33 pre-coding protocol review — round 2

Decision: **REJECT the exact `contract-preflight-v2.md` + `schema-preflight-v2.json` pair for implementation. Product coding remains forbidden pending approval of a new exact version.**

The bounded registrar is a workable architecture. This is not a rejection of SQLite, durable word-boundary admission, explicit learning backpressure, or the chosen migration policy. Three concrete gaps below prevent approval of the actual contract/schema pair. They can be corrected without another architectural replacement.

## Evidence and scope

Reviewed the four requested files in `/Users/isaacthoman/.t3/worktrees/pulpo/t3-75300fc6/apps/keyboard-ios/audits/learning-reset-r33`:

| File | SHA-256 |
| --- | --- |
| `contract-preflight-v1.md` | `2e139d8f0b8ad166a8bb51a0e2fcc07e181f5092217bfb86a396b350070bcef7` |
| `protocol-review-v1.md` | `77e045b2dd8f83aeab974431e3b7919c322d87608f96f6c8c17260ea66e8247f` |
| `contract-preflight-v2.md` | `7449329e06001017f35411fe1555fa6e45841b6f4c75484a27911e0cb45be588` |
| `schema-preflight-v2.json` | `6dd33bf74bd62b43a5e89b20379b088a6484789a87cebb563dc071662552d372` |

HEAD was `305a8893911b7ba54186110ea9f0b919c9d6382e`. Git status showed only the untracked R33 audit directory, consistent with no product edits. Read the current PersonalDictionary and TouchModel implementations, their persistence tests, AppGroup, and the relevant AppModel, Settings, and KeyboardController paths; searched KeyboardEngine persistence call sites. No blind payloads or development results were read. No tests, devices, delegation, deployment, parent edits, or product edits were performed. This `/tmp` report is the only authored artifact.

A preliminary AGENTS.md discovery command listed sibling-worktree pathnames. No files in those worktrees were opened or used as review evidence. All file-content review was confined to this checkout.

References below use the numbered lines of the exact v2 files above. Proposed verification cases are obligations, not observed passing results.

## 1. Required correction: resets and observations must not require a free writer slot

Contract line 15 says each coordinator holds a writer slot for its lifetime and that acquisition precedes global transaction ownership. It also says reset can revoke records without taking writer-slot locks. The contract does not resolve the prerequisite: can a **new process with no slot** construct/use a coordinator and reset an authority whose eight slots are held by live or suspended writers?

Counterexample: eight cooperating processes own all eight lifetime locks, but none owns the global transaction lock. A ninth process is Settings performing a combined reset. An implementation that acquires a slot during coordinator construction follows the first part of line 15 and fails before reaching the reset transaction. No live writer may be reclaimed. Reset becomes unavailable indefinitely even though the reset transaction itself has no contention. Likewise, a fresh independent reader can be denied solely by writer-slot exhaustion.

Minimal correction:

- Make ownership of a writer slot a prerequisite only for admitting/replaying that writer's token-bearing learning. Acquire it lazily, nonblockingly, before the global lock when admission needs it.
- Permit a coordinator without a slot to observe, migrate/initialize under the global lock, perform immediate forget, and perform one-store/combined reset. These operations need no new outstanding-operation identity. They still use the same nonblocking local/global serialization.
- Exhaustion returns capacity for new token admission; it must not itself prevent reset or a valid fresh observation. Do not steal, release, or revoke unrelated live slot ownership to implement this exemption.
- Freeze the full-slot outcome explicitly: with all eight ownership locks held and the global lock available, a ninth process can complete combined reset, revoking both stores' outstanding tokens. If the global lock is held, it returns busy promptly. The original owners retain their incarnations and cannot resurrect revoked payloads afterward.

This is the same admission-versus-reset distinction intended by v1 review R1, now made executable rather than left to constructor design.

## 2. Required correction: finish the admission/acknowledgement state machine

Line 29 correctly addresses uncertain **payload-save** COMMIT results: rollback an active transaction, reread durable statuses, and never blindly apply again. Lines 15 and 23 do not give the corresponding rules for an uncertain **admission** COMMIT or define the precise acknowledgement that permits terminal-row deletion.

An admission transaction persists a pending token but not its payload. If the COMMIT result cannot be established, two facts must coexist: the token may already exist, and the API must not falsely report an accepted/local mutation. Simply returning false and retrying a fresh token can accumulate unclaimed pending rows in a live slot. Installing an eligible local record despite returning false conflicts with the promised no-new-teaching failure semantics and makes persistence-test retries unsafe. SQLite plus a token table does not choose between these behaviors.

Minimal correction:

- Explicitly define identity uniqueness: fresh slot incarnation on reuse; monotonically increasing, never-reused sequence within its stated scope; a unique durable identity constraint. Keep the exact immutable local operation and a bounded local reservation before attempting its admission transaction.
- Apply outcome reconciliation to admission as well as save. Return true only after confirmed registration and installation of that one eligible local operation. If confirmation is unavailable, return a non-ok result, teach nothing, and retain only bounded, ineligible reconciliation state for that identity. Freeze what happens next. One workable policy is that an admission returned as failure is subsequently cancelled/acknowledged, never later applied, before its reservation is reused. If uncertainty can be resolved within the original call, confirmed admission may instead return true normally.
- Define acknowledgement as an owner-side transition after the local operation is removed from every replayable collection and no scheduled/in-flight work can still apply it. Only then may the terminal row be deleted under the global transaction lock. A failed deletion leaves a terminal row, never changes it back to pending, and counts against the existing fixed capacity until retried. There must be no unbounded acknowledgement backlog outside those limits.
- State that an absent token, wrong incarnation, or otherwise unmatched identity cannot be recreated or interpreted as permission to apply a local delta. Distinguish a proved reset revocation from invalid/missing registrar state; do not report a successful fresh save by silently dropping unexplained missing identities.
- Cover uncertain results for immediate forget/reset and initial migration too: either establish the durable outcome or report that the operation may have committed. Do not promise unchanged data for every false result. A later explicit user reset may be a new reset; this does not require an unbounded durable history of reset requests.

The existing single coordinator mutex, no captured snapshot closures, and bounded scheduler are appropriate. These additions specify when an identity stops being replayable and when its storage can actually be reclaimed. They do not require persisting touch samples or introducing historical forget watermarks.

## 3. Required correction: the exact schema must observe the contract's results

The current schema cannot reliably distinguish successful erasure/preservation from failed observation or failed touch admission:

- `new` and `reload` have no expected persistence outcome (schema lines 7–10 and 45–48). Contract line 37 explicitly permits a busy constructor to expose an empty initial view. Consequently `new reader; check count=0; check touchWeight=0` can appear to prove reset even though neither store was successfully read. Reload's changed Bool is also distinct from observation success.
- Direct `learn`, `pin`, `forget`, and `touch` have no expected admission result. `send`/`receive` can recover a Bool for the first three, but `send` excludes touch (lines 80–86), and `check` has no persistence-result field (lines 73–78). A touch refusal cannot be asserted as busy/capacity/invalid rather than mistaken for a valid zero-change model.
- The schema spells out character limits while the contract adds UTF-8 limits and normalized-key/history limits. There is no frozen result convention for rejected over-byte inputs or for partial acceptance of the `touch.repeat` loop. A validator must be able to admit intentional invalid-input tests and assert their rejection; silently filtering those cases out is not verification.
- `failCommit` injects failure before the real COMMIT. `afterCommitBeforeAck` holds both locks until release; releasing permits normal acknowledgement, while killing discards that process's local replay state. Neither operation alone exercises a surviving process retrying the same local identity after an actual successful commit whose result was reported as failure/unknown. Do not count those schedules as that proof.

Minimal correction:

1. Freeze returned results, per store where necessary: admission Bool plus persistence outcome, observation success plus changed Bool, and save/reset completion outcome. Make the diagnostic surface mandatory rather than line 23's “should.” Distinguish busy, capacity, invalid, I/O, and uncertain/postcommit-cleanup outcomes using a typed result or an equivalently precise error detail.
2. Let tests assert those results for constructor/observation and all mutation kinds, including touch. A fresh-reader oracle must require a confirmed successful observation before asserting an empty durable store. Bound retries and fail/unavailable on timeout; do not use a zero initial view as the fallback oracle.
3. Define each repeated touch admission's outcome, or expand repetitions into separately acknowledged operations. Carry the actual byte-validation rules into the executable vocabulary while permitting explicit expected-failure cases.
4. Add a reproducible surviving-writer uncertain-commit case: for example, test-only interposition performs the real successful COMMIT and then reports an injected error to the caller, followed by retry with the same still-local identities. Target admission and payload-save phases explicitly. This may be a separately frozen development harness if it is intentionally outside the blind schema, but name that limitation and retain its exact identity/count oracle. No product hooks are needed.

Keep the existing bounded pipes, acknowledged stop/kill, separate processes, unavailable accounting, and held-global-lock busy oracle. Specify at most one outstanding `send` per actor, with release/resume/kill as runner-side controls while a reply is pending. The new result assertions must not convert asynchronous enqueue acceptance into persistence completion.

## Explicitly accepted choices and implementation obligations

### Serial application, merge, and bounded state

I accept transactional registration as admission rather than durable count increment. The correctness claim is serialized durable application/revocation, with speculative local projections; it is not strict real-time serializability of every successful public learn call. Registration order determines eligibility across forget/reset. Ordinary deferred applications use the declared serial save order, preserving each local operation sequence and touch word grouping.

Sync forget plus revocation of all earlier same-normalized-key pending tokens resolves same-instance forget/relearn, older same-key increments, case/accent forms, and arbitrary unrelated forget history without permanent tombstones. Unrelated current-epoch tokens remain valid. Terminal status committed atomically with payload is the correct retry foundation, subject to correction 2.

The fixed 4096 outstanding-row limit, per-coordinator pending caps, 256-byte string/key limits, and 8MiB payload limits are acceptable admission/storage compatibility changes. The 8MiB limit must constrain **new durable payloads before COMMIT**, not just readers: a forget adding a block or a merge exceeding the serialized payload limit must roll back with capacity and preserve the last valid state. Never write a payload the next observer rejects as oversized. Do not silently evict blocks or valid unrelated tokens to make room. Validate lowered histories and normalized keys after transformation, not only their input spelling. Bound legacy reads before allocating/decoding their complete contents; enforce the stated numeric/overflow checks and an exact touch-sum validation predicate in implementation/tests. Measure actual SQLite/journal high-water bytes and retry resources rather than equating a row-count bound with a measured byte bound.

### Migration, recovery, and legacy cleanup

I accept the dedicated namespace and explicit fail-closed marker policy, including its availability cost: a crash after marker creation but before complete initial DB creation can leave persistence unavailable until external recovery. This is an explicit chosen failure outcome, not permission to reimport legacy on retry. No automatic recovery/reimport feature is demanded by this review.

On open, let SQLite perform its legitimate rollback-journal recovery under the stable global lock before deciding whether the schema/payload is complete. A supported recovered DB plus marker is usable; marker with missing/incomplete/corrupt/unknown DB fails; DB without marker fails. A marker is never removed merely because initialization failed, and ordinary reset never deletes the DB/marker/ownership files to restart migration. Preserve the marker's stated durability ordering and file protection; cover journal permissions/protection as well. Malformed/unreadable legacy data fails without creating the marker; ENOENT alone means absent. No legacy reread after establishment.

Atomicity applies to the two current payloads/epochs and token revocation in SQLite. Physical deletion of two legacy files is separate and cannot be claimed atomic with that transaction. I accept false plus an explicitly distinguishable postcommit-cleanup error after a committed reset. Do not restore old DB state or consult leftover legacy files after such failure. Cleanup retry must tolerate ENOENT and retain the fence. Precommit reset failure preserves both durable stores and pending eligibility; postcommit cleanup failure may leave both current stores cleared and only part of legacy cleanup complete. UI/tests must distinguish these cases. Old binaries can still present/recreate their legacy state; the mixed-version and inaccessible-fallback limits remain explicit release limitations.

### Nonblocking compatibility and existing tests

I explicitly **accept the nonblocking API compatibility change** in line 37. Persistence-specific test adapters may perform bounded retries of a confirmed busy/no-mutation operation and explicitly await successful save/observation before asserting final semantics. Preserve every original word/count/pair/history/block/offset assertion. Do not retry ambiguous I/O as though it were confirmed no-effect busy, discard failing mutations, insert hidden synchronous queue drains into model getters, or weaken accuracy ceilings/known-failure accounting. Background payload commits must remain enabled.

Namespace compatibility also needs a mechanical storage-test adapter, not only contention retries. `TouchModelTests.persistsOnlyOffsetsAndRestoresThem` currently reads the original URL as UTF-8 JSON after saving. A dedicated SQLite authority deliberately does not produce that file for a new standalone store. Update the storage inspection to verify the actual touch authority stores no word/tap sequence while preserving the restoration assertions. Use an isolated temporary directory and clean the authority family; deleting only the legacy URL would leak the new sidecars. This is an allowed test-format adaptation, not permission to remove the privacy assertion or claim old JSON-format compatibility.

Nonblocking flock/try-lock acquisition and refusing new unregistered work on busy are acceptable. A suspended global holder still prevents commit until resume/death, and filesystem calls have no hard kernel deadline. Eventual progress requires eventual availability and another scheduled/explicit attempt; there is no unconditional fairness guarantee. Test same-process ownership/reentrancy and separate-process stop/kill/reclaim, keep retries coalesced and bounded, and measure kept-word/full-storage latency. No per-letter observation or speculative engine/preview changes are authorized.

### Settings and explicit-forget result UI

The parent-owned UI changes are a **release/integration dependency**, not a reason to edit parent files in this review. Current `PulpoKeyboardApp.swift` still unconditionally shows success after `AppModel.clearLearnedWords()`, and KeyboardController still ignores forget completion. Before claiming the feature works, review actual wiring: success only on completed combined-reset success; retryable failure otherwise; prior error cleared only after success; failed forget leaves its suggestion available. Nil/mixed/inaccessible shared URLs fail, with no claim that extension fallback was erased. Native UI/suspension proof remains unavailable without an assigned device. A request sent to the owner is not passing integration evidence.

## Approval boundary

Publish a new immutable contract/schema resolving corrections 1–3, retaining these explicitly accepted compatibility and failure policies. Review that exact pair before any product coding. No new architecture, background disabling, parent changes, or device work is requested here. The original full regression, performance, true-process, migration/failure, source-review, freeze, and single-reveal obligations remain in force; none were executed or passed by this review.
