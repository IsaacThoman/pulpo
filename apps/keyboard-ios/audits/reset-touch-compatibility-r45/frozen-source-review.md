# R45 independent frozen-source review

Verdict: **qualified source approval; no concrete source blocker found at the frozen commit below.** The single product guard removal satisfies the accepted contract qualifications. This is not test-pass, blind, native, UI/reset, performance, or accuracy admission.

## Identity and review boundary

Worktree: `/Users/isaacthoman/.t3/worktrees/pulpo/t3-a6c40353`.

- Final reviewed commit: `79398ca5d3c184849ea724f4cf2d5bf817da9ddd` (`test(keyboard): account for final offset cap in clamp oracle`). Tree: `0fcd7a6f86970c6242ed6deaaa3aeca900945971`.
- Product correction commit: `c2442112ae37625a848b0da981e7cb61dc24fd76` (`fix(keyboard): preserve long-word touch learning compatibility`). This was HEAD at initial inspection. HEAD advanced during the review by the test-only commit above. Both versions were inspected; the final verdict applies to 79398ca5.
- Imported R33 dependency tip: `a20bb202b9deaa6602da72cc840f10253d4aa0e6`.
- Original R33 source: `a9e6ecfc895263721f14b8635dab8c3e87162839`.
- R42 parent: `5e17ab9c1898deea101dbeb0011c7c13520648dd`.

Read the requested contract-before-implementation, accepted qualifications, and preimplementation challenge. The latter two are untracked worktree documents at review time; their hashes below identify the exact accepted texts used. The challenge approves guard removal with qualifications and presents no outstanding blocker. No old blind inputs/results or developer output artifacts were opened. Historical audit filenames appeared in Git status/stat metadata, but their contents were not read.

Only source inspection, Git comparisons, whitespace checking, file hashing, and independent Python arithmetic/text identity checks were performed. No product/tests/builds were executed. Tests are being handled separately; no pass is inferred here. No devices, additional agents, source/test edits, protected repository/perf edits, push, merge, or deployment. Only this report was written.

## Product scope and conservation

The product delta from a20bb202 to the frozen commit is exactly one line in `PulpoKeyboardKit/Sources/KeyboardCore/Geometry/TouchModel.swift:109`: remove `, target.count <= 40` from the alignment guard. A byte comparison established that the entire resulting file equals the a20bb202 file with exactly that substring removed once; a20bb202 and a9e6ecfc TouchModel files are byte-identical. No algorithm/constants/order/grouping edits accompany the correction.

`learnLocally` is unchanged across a9e6ecfc, a20bb202, and the frozen commit: offsets are captured once before the sample loop; samples retain order and unit weight; radius .45, maximum offset .4, per-key decay at 300, priors 12/24, minimum applied weight 40, and cache invalidation are conserved. Replay still applies each touch mutation as one word through `TouchModel.applying` (57–63). The coordinator's projection/commit paths preserve mutation order and word grouping; there is no batching workaround.

Comparing all product Swift files under App, package Sources, and KeyboardExtension against a9e6ecfc found only the TouchModel correction, the necessary AppModel merge, and exact R42-base files: PulpoKeyboardApp, SignInAttempt, SignInView, EmojiSearch, InputTraits, PulpoClient, SessionStore. PersonalDictionary, LearnedDataPersistence, KeyboardEngine, and KeyboardUI/KeyboardController are identical to original a9e6ecfc. Relative to the R42 parent, the controller has the imported R33 `forget` success guard only; the excluded later UI overlay is not introduced. No Engine/UI/account change is introduced after the imported dependency tip.

`git diff --check a20bb202 79398ca5` for the corrected source/new test file completed without errors. At final source verification, worktree package Sources, TouchCompatibilityTests, and AppModel matched the frozen commit.

## Full touch admission path

1. `TouchModel.learn:106–117` first rejects learning-off; forms keyed bytes/taps and normalized intended UTF8; requires equal normalized byte counts and at least two bytes; collects only intended a-z positions having both a keyed tap and a geometry center. Contributing dx/dy must be finite. A late nonfinite contributor rejects the entire temporary collection before any teaching. Empty collected samples reject.
2. A nil-URL model never constructs LearningSession (`TouchModel:40–45`). Aligned finite long inputs with usable samples therefore reach the same unchanged local algorithm without a target-length ceiling or persistence I/O. Local weight must still respect per-key decay; it is not universally raw input length.
3. A persistent model calls `LearningSession.admit` before `adopt` or `learnLocally` (`TouchModel:118–124`). Session resolution (`LearnedDataPersistence:155–160`) can consult the registry/resolve the domain path; unavailable registry acquisition may return busy before coordinator validation. Finding/constructing the coordinator itself creates no storage. This preserves the accepted busy qualification, not an unconditional invalid guarantee.
4. `LearningMutation.valid(for:)` independently requires touch kind, 1...40 collected samples, slots 0..<26, and finite dx/dy (`LearnedDataPersistence:26–39`). It measures the actual normalized sample array, not target characters, raw tap-array length, or physical contacts.
5. `LearningCoordinator.admit:471` validates first. Oversize returns invalid before admission capacity checks, transaction locking, the >=256-record maintenance flush/observation, writer-slot acquisition, sequence changes, directory/file creation, database opening, claim/synchronize, projection calculation, record/token reservation, and session marking. Thus even a full pending queue cannot turn this rejected operation into a maintenance write. `acquireSlot:264–273`, `global:275–288`, and `openDatabase:305+` are unreachable from that rejection.
6. On non-ok, TouchModel returns before adopting another writer's/reset projection and before teaching. The rejected array never becomes a record, token, queued save, or partial prefix. The diagnostic persistenceResult changes; snapshot/weight/offsets do not. A later explicit save may flush earlier accepted work, as qualified in the contract.
7. Accepted mutations continue through reservation and confirmed admission, adopt the preceding projection, then learn the complete collected array locally. Save uses the unchanged grouped replay path (`commitLocked:545–575`). Persistent normalized target lengths above 40 are allowed when only 1...40 usable samples are collected, subject to the existing availability/capacity/error outcomes.

The no-mutation claim starts after construction and quiescent preseed. Persistent construction observes storage and may initialize it. It is not a zero-read/syscall claim, and it does not cover unrelated concurrent writers.

## Normalization and privacy

`TypedWord.keyed` (`SpellCorrector:27–37`) normalizes each Swift Character independently and duplicates that Character's tap for each emitted UTF8 byte; missing tap entries become nil and extra tap entries are ignored. Intended normalization runs on the whole string (`TouchModel:108`). Alignment is byte-count equality, not spelling equality or a universal equivalence between those normalization strategies.

TextNormalizer retains the existing lowercase/compatibility decomposition, dropped apostrophes and nonspacing marks. Intended nonletters or positions lacking geometry are skipped before finiteness checking. Therefore ignored/nonletter/extra taps may be nonfinite without rejection. The new tests correctly avoid a blanket nonfinite or physical-contact-counting oracle.

The private-field gate is unchanged at `KeyboardEngine:1014–1016`: `policy.learns` is required before calling touch.learn. Direct TouchModel calls retain the explicit isLearning switch; they do not infer traits. Existing ordinary/private-field assertions were inspected. This is source conservation, not native long-word reachability or UI admission.

## Ordinary test assertions and oracle audit

The final committed `TouchCompatibilityTests.swift` has meaningful positive and negative controls:

- Dense local 40/41/64 samples: success, exact unsaturated weight, signed offsets, and finite offsets. Mixed keys remain below per-key decay.
- Sparse 41/64 normalized targets with 1/40 samples: local/persistent learning, exact weight, projection equality, successful save/reload, and matching all offsets. Dense persistent 40 round-trips separately.
- Unicode `ﬀ` fixture: taps are indexed by the 21 source Characters, not raw UTF8. Normalized length 42 and local weight 42 are explicit. Persistent rejection requires actual invalid and unchanged files; dropping one Character tap admits 40 duplicated samples and round-trips.
- Preseeded persistent dense 41/64 rejection: exact invalid, full snapshot/all offsets unchanged, recursive storage membership/bytes/mtime/inode unchanged, then save/reopen with no leaked sample. The inventory includes authority and sidecars, not only the legacy JSON path.
- Stale-owner rejection: another writer's saved weight reaches four; rejecting 41 samples leaves the stale two-sample projection and files intact; explicit reload then adopts the other projection. This directly distinguishes rejection from silent refresh.
- Both local/persistent invalid-input cases: empty, one byte, tapless, mismatched normalized lengths, no usable letters, and late NaN/infinite contributors reject without changing preseeded snapshot/offsets/files. isLearning false also rejects. The nil-URL case keeps the test directory empty.
- Accented/apostrophe input plus ignored nonfinite/extra taps teaches exactly two; a same-length different spelling teaches three more, preserving existing alignment semantics.

The clamp-reference test was independently audited arithmetically. Forty-one initial a samples at dx=4 clamp to a raw sum of 41*.45 = 18.45, weight 41; global x is 18.45/65 = .28384615384615386. The uncapped a estimate is .4123802612481858, so the public offset must be .4. The initial c2442112 oracle omitted that final cap and was incorrect. The frozen 79398ca5 test fixes it and additionally checks the raw accumulated sum, avoiding a cap-masked grouping assertion. Its q/global assertion remains below the cap. This is a resolved test-oracle issue, not a product algorithm defect; no execution result is claimed.

`learningEventually` retries only confirmed busy/no-admission, throws on invalid/capacity/io/uncertain/etc., and does not turn uncertain writes into duplicate learns. Rejection tests directly require invalid and do not silently accept busy. Unanticipated availability failures remain failures. Existing grouped clamp/decay replay, minimum applied-weight, ordinary-field and private-field tests are retained. Replay equality against the same local algorithm is supporting equivalence evidence, not an independent proof of algorithm invariance; the exact source comparison supplies that conservation check.

The filesystem assertions compare stable endpoint inventories, not every transient syscall or metadata field; the stronger ordering conclusion comes from the admission source trace. These ordinary examples are useful mechanics coverage, not population accuracy evidence or a replacement for the separately planned independent frozen blind process.

## R42 AppModel preservation

The complete AppModel diff from 5e17ab9c changes only the learned-words section (old lines 296–306): add learningResetError, replace separate dictionary clear/touch reset/save with coordinated LearnedDataPersistence.clear, and return Bool with the existing retry message on non-ok. Prefix before that section and suffix starting at the Deep links marker are byte-for-byte identical to the R42 parent. Thus all account/sign-in/sign-out/session/deep-link code is exactly preserved, rather than reconstructed or taken from the older R33 version. No additional App file differs from R42. This approves the source merge only; reset success/error presentation and native account behavior were not executed.

## Input SHA-256 identities

Paths are relative to `apps/keyboard-ios/`. Product and test files below match the frozen commit; the two identified worktree-only contract documents are explicitly marked.

```text
696843c4f16b2132715558fbf67d2b7560344a51f3916dafca5b08ea0b0ff443  PulpoKeyboardKit/Sources/KeyboardCore/Geometry/TouchModel.swift
213dcf5810e5fffb33921827b563b31feb3eb7d2ac32c026aa9f694e028ef235  PulpoKeyboardKit/Sources/KeyboardCore/Shared/LearnedDataPersistence.swift
525630cd2f29ef9739d98f7ea62827e04ee090140591d384527022a085030f31  PulpoKeyboardKit/Sources/KeyboardCore/Correction/SpellCorrector.swift
5751a26a1cff378015344a384d3f24d3eae9808312249a836984ea8914334d14  PulpoKeyboardKit/Sources/KeyboardCore/Dictionary/Lexicon.swift
99b3513dbaa433f4e83f7a7d35aadda518844331b60fda4bfe00d921708da188  PulpoKeyboardKit/Sources/KeyboardCore/Geometry/LetterGeometry.swift
3f0987051ff0f176a5e1ef6396d415b0f8fe0fc2088735c75fef87f75158de97  PulpoKeyboardKit/Sources/KeyboardCore/Input/KeyboardEngine.swift
b51ff8291e2fc6a64f2244a7ddf198d4a49fde79443bffca500b4d2b317d2b61  PulpoKeyboardKit/Sources/KeyboardCore/Input/InputTraits.swift
31e6f935e21701c4c7f3ddeef1756aaf0f8346a01a3b75a17571e195a707a135  App/AppModel.swift
7666ade2f064334718be7f580c9c9efa11470de548c6453be4d75d64357040a4  PulpoKeyboardKit/Tests/KeyboardCoreTests/TouchCompatibilityTests.swift
217c4b7dfa049df83f952502b18cb1f10b5f09292193466fe408d5c588991f0e  PulpoKeyboardKit/Tests/KeyboardCoreTests/TouchModelTests.swift
0c6ae46f3b5f4206a3ff09cfae8f9296ecb5439dbb86bdefb8617a46b310ef0d  PulpoKeyboardKit/Tests/KeyboardCoreTests/LearningPersistenceTests.swift
afedbf1c9490b502441e40c0329f7a288e4815c9cbd91a20f7b98145be31af55  PulpoKeyboardKit/Tests/KeyboardCoreTests/LearningPersistenceSupport.swift
8e177fa8d1aa88dc67337c9bdf7e32fec3a2850e2fb1d3dc689bebec88c6a66a  PulpoKeyboardKit/Tests/KeyboardCoreTests/NativeContentTypePrivacyTests.swift
53c831b72464837f6954eaccf3f94696f02afc956eb8725e23e1784901582ee1  audits/reset-touch-compatibility-r45/contract-before-implementation.md
831d0e771e55c811d6603f0d33c1e8e255c31b92a515bd83d8c58245f55f8244  audits/reset-touch-compatibility-r45/contract-qualifications.md [worktree-only document]
5dfe4d9fe9f080bda0dc2f33a0c745f71b91d0211a061923ddb70a547810e8c1  audits/reset-touch-compatibility-r45/preimplementation-challenge.md [worktree-only document]
```

No unresolved blocker remains for the qualified source verdict at the stated commit. Execution gates and all later admission decisions remain separate.
