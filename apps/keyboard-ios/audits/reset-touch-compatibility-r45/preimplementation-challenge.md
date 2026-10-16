# R45 independent preimplementation source/domain challenge

Verdict: **qualified approval of the proposed single guard removal**. No source blocker requires changing the learning algorithm or persistence implementation. The contract/public map needs the qualifications below before it is used as a blind oracle. This is permission to implement and validate, not implementation admission or a measured behavior/accuracy pass.

Reviewed worktree: `/Users/isaacthoman/.t3/worktrees/pulpo/t3-a6c40353`.
Observed HEAD: `a20bb202b9deaa6602da72cc840f10253d4aa0e6`.
The inspected `TouchModel.swift` still contains `target.count <= 40`; this review precedes the proposed edit.

## Source finding: the guard removal has the intended boundary

`Sources/KeyboardCore/Geometry/TouchModel.swift:105-126` first requires learning enabled and equal normalized byte counts of at least two. It collects samples into a temporary array, rejects any nonfinite contributing displacement, rejects an empty sample array, then admits persistent samples before adopting a payload or teaching locally. Removing only `target.count <= 40` leaves those checks and their order intact.

`Sources/KeyboardCore/Shared/LearnedDataPersistence.swift:26-39` independently accepts a touch mutation only for the touch store, with 1...40 samples, valid letter slots, and finite dx/dy. The decisive early check is **LearningCoordinator.admit at line 471**, reached through LearningSession.admit at lines 159-160. It precedes capacity maintenance/flush, the transaction mutex, writer-slot acquisition, database opening, sequence increment, record reservation, projection computation and session marking. Oversize mutations reaching it return `.invalid` before all of those effects, including when existing pending records have reached the maintenance threshold.

`TouchModel.learn` checks the admission result before `adopt` and `learnLocally`. A rejected oversize operation therefore cannot teach a partial prefix or refresh an existing projection from another writer/reset. Only the public status changes to the returned failure. The collected array is discarded. There is no later queued save or record for this invalid mutation. A subsequent explicit save may still flush earlier valid work; that is not evidence the rejected word was admitted.

Nil-URL models never instantiate LearningSession, so the removed length ceiling permits local long learning with no persistence path. This does not remove the persistent sample cap. A dense 41-letter ASCII operation can teach locally and must be rejected persistently. A 41-letter operation with only 40 usable taps can teach in both modes, subject to ordinary persistence availability.

## Contract qualifications needed before freezing independent inputs/oracles

1. **“Actual samples” means collected normalized-letter TouchSample entries, not physical contacts or `TypedWord.taps.count`.** TypedWord.keyed (`Correction/SpellCorrector.swift:27-37`) normalizes each Swift Character separately and duplicates its tap for every emitted UTF8 byte. TouchModel subsequently collects entries only for intended a-z bytes with a tap and a geometry center. For example, fourteen U+FB03 ligatures (`ﬃ`) normalize to 42 a-z positions and duplicate fourteen source taps into 42 samples: local acceptance is possible after the guard removal, while persistent admission rejects. Thirteen such ligatures plus `a` yield 40 samples and are within the persistent limit. Counting original characters/contacts would give the wrong oracle. Existing helpers that construct taps by raw UTF8 are suitable for ASCII, not these Unicode fixtures.

2. **“Mismatch” is a normalized-byte-count mismatch, not differing spelling.** The guard never requires keyed bytes to equal target bytes. Same-length corrections such as typed `thw`, intended `the` may teach the intended letter centers. Conversely, character-count equality does not ensure normalized byte-count equality. Preserve the existing alignment rule; do not introduce exact text equality as a new restriction.

3. **“Nonfinite” means a nonfinite displacement at a contributing intended-letter position.** Once a sample position qualifies, NaN/infinity causes whole-operation failure even after finite samples have already been collected. However, dropped apostrophes/marks, extra tap-array entries, intended nonletter bytes, and positions without geometry centers do not contribute samples and their taps are not checked. As a concrete counterexample to a blanket rule, `TypedWord(text: "aa-", taps: [finiteA, finiteA, nanPoint])` with intended `aa-` and QWERTY can teach two samples; the last position is skipped. A public map saying every nonfinite value anywhere rejects would contradict existing behavior. Likewise, long aligned nonletter-only/tapless input still rejects because no samples exist.

4. **No filesystem mutation is an operation boundary, after model construction.** A persistent TouchModel initializer invokes `reloadIfChangedOnDisk`; observation may create the directory, lock, initialization marker and authority database. Capture the rejection baseline after initialization and after deliberately completed preseed writes. Do not assert that constructing an oversize test model leaves a previously nonexistent directory absent. LearningSession.resolve can also resolve a domain path before mutation validation; an absolute claim of zero filesystem reads/system calls is stronger than this source supports. The coordinator validation does precede persistence mutation I/O for the rejected operation.

5. **Failure status and “unchanged” require precise meanings.** With an existing coordinator the oversize mutation returns false/`.invalid`. In the exceptional unresolved-coordinator case, LearningSession.resolve may fail registry acquisition and return false/`.busy` before validation. This remains non-teaching and does not write storage. Do not silently treat `.busy` as an observed `.invalid` pass. Also exclude `persistenceResult` itself from “unchanged local state”; weight, all offsets, and future saved projection are the invariants. If unconditional `.invalid` under registry contention is required, the single-line proposal cannot satisfy that stronger contract.

These are contract/oracle qualifications, not requests to broaden the product change. If the parent intends blanket nonfinite rejection, physical-contact counting, exact-spelling alignment, constructor-side no-storage behavior, or unconditional `.invalid` under registry contention, that stronger interpretation is a blocker for this proposal and needs a new explicit scope decision before implementation.

## Algorithm and source consequences

The proposal leaves `learnLocally` (`TouchModel.swift:129-152`) unchanged: one frozen offset reference per word, original sample order, unit weight per normalized sample, radius clamp, per-letter decay at 300, priors, offset bounds and cache invalidation. Persistent replay applies one `.touch(samples)` operation at a time through TouchModel.applying; it must retain the word grouping. Splitting a long operation into batches would change clamp references and is not an acceptable substitute. A heavily repeated single key saturates at 300; long-word tests must not equate weight with raw length past decay.

Long aligned calls now scan and retain their full normalized/sample arrays even if persistent admission rejects over 40. Normalization and keyed arrays were already constructed before the old target guard; the newly reachable collection loop adds linear work and sample allocation. This is a source consequence, not a timing or device-performance result. No arbitrary new local length ceiling or early partial teaching should be added.

The Engine's `Input/KeyboardEngine.swift:1014-1016` still gates touch learning on `policy.learns`. Direct public TouchModel calls do not infer private-field traits; their switch is `isLearning`. Existing ordinary-field/private-field tests therefore remain relevant, but source approval is not a claim of native long-word reachability, accuracy improvement, or whole-reset/UI admission. No new raw text/tap persistence format is introduced: admitted records contain letter slots/displacements and saved touch projections contain per-key sums/weights.

## Ordinary evidence and required implementation checks

Read current ordinary `TouchModelTests`, relevant `LearningPersistenceTests`, `LearningPersistenceSupport`, normalization assertions in `LexiconTests`, `SpellCorrectorTests`, and privacy assertions in `NativeContentTypePrivacyTests`. Current tests cover systematic offsets, robustness, length mismatch, persistence, reset while owners remain alive, minimum applied weight, private/ordinary fields, grouped clamp/decay replay, memory models, and error-status recovery. They do **not** currently establish the new dense/sparse long boundary, normalization-expanded sample count, or atomic oversize touch rejection. The grouped replay test compares against the same local implementation; it is useful for replay equivalence but cannot alone prove algorithm invariance.

Before implementation admission, ordinary checks should concretely establish:

- Dense local length 41 and an appreciably longer mixed-key word teach. Sparse long local/persistent words with 1 and 40 collected samples teach; persistent 41 samples reject. Use distinct offsets and keys, not only weight, to expose partial/misdirected teaching.
- Expansion across 40 samples behaves according to normalized duplicates, with tap arrays indexed by source Character. Cover missing/extra taps, apostrophe/diacritic normalization, and count mismatch without assuming every Unicode letter folds to ASCII. Target normalization runs on the whole intended string whereas TypedWord.keyed runs per Character; do not assume universal normalization/alignment equivalence.
- Empty, one-normalized-byte, no-tap, no-usable-letter, learning-off and count-mismatched calls reject; a nonfinite contributing tap late in the sequence rejects the entire call. Preseed models so “unchanged” has meaningful content.
- A quiescent preseeded persistent model rejects an oversize call without changing weight/all offsets, existing files or directory membership, then save/reopen proves no rejected sample leaked. Inventory the authority and sidecars, not merely the legacy `TouchModel.json` path; distinguish inspection-induced atime from mutation. Also test a stale local projection against another owner's saved changes to show rejection does not adopt the other projection.
- Accepted bounded short/sparse-long persistent operations save/reopen to the same local projection. Keep the original grouped clamp/decay and privacy tests. Observe busy/error outcomes honestly; retry only confirmed non-admission `.busy` according to ordinary support, never uncertain writes.

No tests/builds, paired execution, device actions, timing measurements or historical-evidence verification were performed for this source-only challenge. No old blind payloads or developer output artifacts were opened. No additional agents were used. No product, protected repository or perf-directory edits, push, merge or deployment were made. Only this `/tmp` report was written. The planned later gates and independent blind process remain outstanding.

## SHA-256 input identity

Paths below are relative to `apps/keyboard-ios/`:

```text
53c831b72464837f6954eaccf3f94696f02afc956eb8725e23e1784901582ee1  audits/reset-touch-compatibility-r45/contract-before-implementation.md
f28ef21d35a99c02b881b0e141ce95d06e9dfa89a4c0732f1b27c042113ef15f  audits/reset-touch-compatibility-r45/public-api.md
fc5f3d9f9f6fdd57d8aa7c4e61556ef29284339ccd3f045c22404701b08e06ef  PulpoKeyboardKit/Sources/KeyboardCore/Geometry/TouchModel.swift
213dcf5810e5fffb33921827b563b31feb3eb7d2ac32c026aa9f694e028ef235  PulpoKeyboardKit/Sources/KeyboardCore/Shared/LearnedDataPersistence.swift
525630cd2f29ef9739d98f7ea62827e04ee090140591d384527022a085030f31  PulpoKeyboardKit/Sources/KeyboardCore/Correction/SpellCorrector.swift
5751a26a1cff378015344a384d3f24d3eae9808312249a836984ea8914334d14  PulpoKeyboardKit/Sources/KeyboardCore/Dictionary/Lexicon.swift
99b3513dbaa433f4e83f7a7d35aadda518844331b60fda4bfe00d921708da188  PulpoKeyboardKit/Sources/KeyboardCore/Geometry/LetterGeometry.swift
3f0987051ff0f176a5e1ef6396d415b0f8fe0fc2088735c75fef87f75158de97  PulpoKeyboardKit/Sources/KeyboardCore/Input/KeyboardEngine.swift
217c4b7dfa049df83f952502b18cb1f10b5f09292193466fe408d5c588991f0e  PulpoKeyboardKit/Tests/KeyboardCoreTests/TouchModelTests.swift
0c6ae46f3b5f4206a3ff09cfae8f9296ecb5439dbb86bdefb8617a46b310ef0d  PulpoKeyboardKit/Tests/KeyboardCoreTests/LearningPersistenceTests.swift
afedbf1c9490b502441e40c0329f7a288e4815c9cbd91a20f7b98145be31af55  PulpoKeyboardKit/Tests/KeyboardCoreTests/LearningPersistenceSupport.swift
5cf488d68cc90484e9d0be6b9917bdc41280ad1c453c65e546730361b0f3f54f  PulpoKeyboardKit/Tests/KeyboardCoreTests/LexiconTests.swift
656692b3bdf1f0d924ab8a6fffff27a40c46e4f8867575c25c81119a67c841eb  PulpoKeyboardKit/Tests/KeyboardCoreTests/SpellCorrectorTests.swift
8e177fa8d1aa88dc67337c9bdf7e32fec3a2850e2fb1d3dc689bebec88c6a66a  PulpoKeyboardKit/Tests/KeyboardCoreTests/NativeContentTypePrivacyTests.swift
379c461020874de324f62c3cdb3ed4feeca9f42e125f31b0e1bed6c4f6c3c309  PulpoKeyboardKit/Package.swift
```
