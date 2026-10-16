# R47 independent actual-Engine executor/evaluator review v1

**BLOCK evaluator/protocol admission before fresh sourceblind authorship.** The retained development pair passes the implemented comparator, and the principal relational comparisons are present before seal. However, a permitted hold can erase a successful contribution and pass; process-record schema/unavailability validation is incomplete; and the executor cannot yet exercise several binding primitive-time host obligations. These are bounded audit-harness fixes. This decision does not reject the admitted v2 source-domain contract or prescribe a production redesign.

Production source is being developed concurrently and is **not frozen, source-reviewed, or admitted here**. Native admission, fresh author/oracle review, source/executor/resource/binary/input freeze, and the single paired reveal remain separate future gates. R44 remains rejected and inactive: 70 cases, 211 rows per variant, baseline 777/777 versus candidate 776/777; aligned sparse `ca` + nil `noe` still fails R44's immutable zero. R47's new domain cannot repair that failure or the original missing preseal relational evaluator.

**Scope and method.** I read CONTRACT.md, both contract reviews, PROTOCOL.md, the entire Runner/build/check/run-pair/test-check implementation, development generator and packet, mutation outputs, pre-edit baseline/process, and development-v1 baseline/candidate/process/receipt/report. I read the exposed original parent REVIEW.md/evidence.json and dependency manifest, and inspected the baseline Engine and shared LanguageStack/TypedWord/TouchModel assembly. I verified the retained baseline Engine against immutable parent `e503e5a6646208c6dc125271431bbb9d677b9bb8`. Shared non-Engine production files listed in pre-edit-freeze.json still matched that manifest when checked.

I ran the permitted development checker/mutation suite under normal and optimized Python, independently recomputed the retained pair, and made additional in-memory data/packet/process mutations. No production edits, Swift builds/model executions, devices, native evidence inspection, logs, persistence stores, future heldout data, fresh oracle generation, or delegated agents were used. The supplied test suite creates and removes its own temporary execution directory; this report is my only persistent written artifact. Concurrently appearing source/native artifacts are outside this review.

**What is implemented correctly.** build.py compiles actual KeyboardCore sources with `swiftc -O -parse-as-library`; baseline mode substitutes only the archived Engine. Runner constructs a fresh LanguageStack for every case with nil personal/touch persistence, uses actual language pkdict resources and default QWERTY geometry, and calls real Engine methods. A document reset retains learned models, as declared. Type operations preserve optional tap slots; nil taps are not padded with invented measurements. The model route is distinguished from genuine Controller alternate input and human/native accuracy.

check.py:101–119 requires complete ordered row cardinality, exact row keys and attribution, all 26 finite coordinate pairs, finite nonnegative weight, integer counts/coordinates, complete watched dictionaries, ordered pairs, and probe-specific fields. Its preservation loop checks ten non-touch fields per ordinary row: exact Python scalar text, Character cursor/selection, total events, watched counts, ordered pairs, learns policy, validity, identity, and primitive edit count. All probe fields are also compared on probe rows. Numeric booleans are rejected for row counts, indices, weights and offsets. No Python assert is used for validation.

For each declared parity, checks compare candidate external **before and after** full touch state with **both baseline Space and candidate Space** before and after. Histories must match exactly through acceptance except declared external commits replaced with Space. Reference and candidate external increments must equal the declared positive sample integer; baseline external must lack the additional contribution. Other rows require full baseline/candidate touch equality unless explicitly allowed by parity/hold. Zero relations check weight and all 52 offset scalars against literal fresh zero, not weight alone. A fixed valid packet therefore rejects offset-only errors, second-increment errors and duplicate follow-on samples.

The paired runner creates a new output directory exclusively, records both process exits/stderr, hashes input/binaries/resources, and calls the checker. The CLI checks nonzero exit/nonempty stderr before reading stale raw rows. Missing/malformed rows cause a whole-gate error without a partial score. The runner's exact Unicode-scalar insertion endpoint guard rejects unsupported right-hand grapheme joins rather than rounding the caret. These are useful safeguards absent from the original R44 preseal process.

**Retained development result, independently recomputed.** development-v1 is PASS **4,649/4,649**, 60 cases and 316 rows per variant, unavailable 0. My complete returned object equals retained report.json; its baseline equals development-baseline-preedit.json exactly. Both recorded invocations exit 0 with empty stderr. This is exposed development evidence for the recorded binary hashes, not source admission for the moving working tree.

The denominator comprises 3,160 correlated non-touch preservation comparisons, 353 authored field checks per variant, 167 touch-preservation checks, 42 parity-before and 42 parity-after checks, 42 positive reference-increment checks, 21 external-increment checks, 21 missing-baseline-contribution checks, 256 hold checks, and 192 full-zero checks. A whole counts/valid map, offsets array, or touch state is counted as one comparison where the code does so; these are not independent samples or typing-accuracy outcomes.

There are 21 parity relations, 128 holds, and 96 zero points. Nine external/reference families each check two independently typed same-spelling occurrences; three additional families check a second word after an ordinary trained word, with watched pair counts. Full words contribute 4/5 points as declared; aligned `canoe` contributes exactly 2, `niño` and `café` with nil alternate slots contribute exactly 3. Second-word histories advance 4→9, 5→10, and 4→9. All 21 observed pre-acceptance validity maps report the relevant spellings valid. Total weight never exceeds 10 on these positive histories, so per-key saturation at 300 cannot explain their exact positive increments. Those observations corroborate the exposed fixtures; they are not fresh expectations selected from results.

**Blocker 1 — hold origins are not constrained to the current contribution.** check.py:85–89 admits any earlier row in the same case as a hold origin; :149–151 then compares only that chosen origin and destination independently in each variant. It does not forbid crossing an intervening accepted contribution. Consequently the public promise that every follow-on action preserves the accepted state is stronger than the executable validation of relation plans.

Concrete successful adversary, using the retained passing development pair without changing any production result/oracle on disk:

```python
# q/b/c are independent copies of development.json and development-v1 raw arrays.
rel = next(r for r in q['relations']
           if r['kind'] == 'hold' and r['to'] == ['dev-en_US-full', 2])
rel['from'][1] = 0                    # Previously the accepted row, index 1.
row = next(r for r in c if (r['id'], r['index']) == ('dev-en_US-full', 2))
row['weight'] = 0
row['offsets'] = [[0, 0] for _ in range(26)]
evaluate(q, b, c)['status']            # PASS, also under python -O.
```

Candidate touch weight now goes **5→0→5** across acceptance, first callback, second callback. Baseline holds from zero to zero; candidate holds from the pre-acceptance zero to zero. Every other check still passes. This is an input-plan-plus-output escape, **not** a candidate-only escape under the unchanged development packet. It matters because the author supplies the plan and preflight purports to validate it before seal.

Bounded fix: validate contribution intervals and require every follow-on hold to preserve the latest applicable accepted state, or an uninterrupted chain rooted there, without crossing a declared learning event. Require each intervening row individually, and reject inappropriate hold allowances on learning operations/reference histories. Add the rollback adversary in both Python modes. Preserve the ability to compare second words/occurrences with their correct accumulated Space histories.

Related coverage weakness: preflight counts two parity relations per resource, but does not require a second occurrence, second-word/prior-training history, any follow-on actions, or any zero relations. The current development packet supplies useful coverage; the checker does not establish that a future packet does. Removing every zero relation and changing both variants' `dev-control-decline` offsets `[25][1]` to `.001` at every row still returns PASS through baseline equality. This also changes the plan; the unchanged packet rejects it. Before authoring, bind required coverage through explicit case roles/interval declarations or an independently reviewed coverage manifest that the evaluator checks. Missing zero obligations and omitted follow-on obligations must not be mistaken for fulfilled promises.

**Blocker 2 — process types and unavailable records can pass.** check.py:164–167 validates only the two top-level names and `exit == 0`, `stderr == ''`. With the complete retained good raw rows, I invoked the actual main function using an in-memory Path adapter (no output files changed):

- `{exit: 0, stderr: ''}` → exit 0, PASS.
- `{exit: false, stderr: ''}` → exit 0, PASS.
- `{exit: 0.0, stderr: ''}` → exit 0, PASS.
- `{exit: 0, stderr: '', unavailable: true}` → exit 0, PASS.
- `{exit: 1, stderr: ''}` → exit 1, WHOLE_GATE_ERROR.
- `{exit: 0, stderr: 'unavailable'}` → exit 1, WHOLE_GATE_ERROR.

The last two confirm ordinary failed-process/stale-output rejection. The first three malformed/unavailable variants expose the strict-schema gap; these records are not emitted by today's subprocess wrapper, but a gate consuming process JSON should reject them rather than trust coercive equality or ignore an unavailable declaration.

Bounded fix: explicitly validate each process record as an object with a non-boolean integer exit and string stderr, validating documented stdout/timestamp fields when present. Define and enforce allowed keys; reject unknown unavailable/error-bearing records, or support a typed explicit unavailable flag that always fails the whole gate. Add these mutations under normal/-O Python. Keep process validation before output scoring. Catch launch/read failures in run-pair.py to retain a structured whole-run unavailable receipt; its current uncaught exception fails the invocation safely but can leave no portable process/report evidence.

**Blocker 3 — primitive host capabilities and declined deletion need bounded repair before executor admission.** Runner.swift.txt:92–104 can express live UUID A→B and A→B plus callback *inside insertion*, and an acceptance-time private-policy change. The exposed identity controls check zero full touch state and retain destination/text/count comparisons. This is the correct seam for the original candidate5/baseline0 obligation.

However, its only scalar replacement capability is a `host` operation before the primitive or a fixed beforeOverride. Neither can represent an initially matching complete live snapshot whose primitive changes a decomposed retained prefix to precomposed text, or changes the retained suffix while inserting. The four allowed external transitions contain no scalar replacement. A faulty implementation using Swift canonical String equality for live post-readback could therefore pass all currently expressible scalar-preservation cases; comparing baseline/candidate final Python text does not test whether the **old** live prefix survived that primitive unchanged. The document's ID is also always nonnil, and the JSON identity is an independent counter rather than a direct nullable live-ID observation, so nil→UUID, UUID→nil, and the explicitly permitted nil→nil path are outside this executor.

Deletion uses no transition argument, despite the contract's primitive-time unchanged-ID/suffix requirement for ownership retention. More directly, AuditDocument.deleteBackward at :48–50 **decrements cursor and creates a one-Character selection before insertText checks decline**. A declined backspace on collapsed `music|` leaves actual text `music` but cursor 4/selection 1. That models a selection change plus refused replacement, not a host refusing deletion while retaining its original collapsed caret. The exact refusal control that motivated contract v1 is unavailable in that form. Similar caveats apply to queued deletion.

Bounded fix: make declined deletion leave document text/caret/selection unchanged; calculate the proposed deletion range without committing it until accepted. Publish a small set of typed audit-only primitive host transformations for exact retained-prefix/suffix replacement and nullable ID transitions, including deletion where needed. Emit the actual observable ID state. Use explicit predeclared scalar controls with identical deterministic host behavior in both variants and baseline-preservation/zero expectations; do not derive an oracle from candidate outcomes. Update protocol/preflight/executor together. If these cases are deliberately assigned to a separate actual-Engine source-admission harness, identify and freeze that harness and its mandatory evidence before fresh authorship, and narrow this executor's claims accordingly. No TouchModel/storage/Controller or production policy change is needed.

**Remaining source/development obligations, not new production findings.** The 316-row packet contains no settings operation enabling autocorrect and no probe operations. Thus it does not demonstrate an actual accepted pending correction or restored/pinned undo provenance. Its positive deletion fixtures remove a suffix from an ordinary typed word, not an undo-restored correction or separator-derived word. Those binding source-admission controls remain unproved by this packet. Add deterministic exposed Engine fixtures for accepted correction plus its existing touch event, undo/restoration exclusion, derived separator deletion, declined suffix deletion, and post-skip callbacks with no deferred recovery. The existing hidden-before/hidden-after/lag/queue controls are useful and should be retained, along with inherited shifted `mu`+`sic`, all-nil, unknown-spelling-before-learning, selection/interior, private/address/off and boundary continuations. No existing failure may be dropped or repaired by output-informed vocabulary/tuning.

**Adversarial verification performed.** Both supplied test-check.py executions succeeded with a synthetic good packet and all 21 listed rejection mutations, including nonzero process status with stale complete output. Their recorded normal/optimized JSON bytes match. Additional candidate-only mutations to cursor, selection, identity, edits and validity all failed; boolean weight/index/offset, negative count, and extra row field raised explicit Invalid exceptions. The rollback escape reproduced under normal and optimized Python. There is no assert-removal vulnerability in the validation implementation reviewed. The synthetic good fixture deliberately copies baseline Space touch state into external rows; it tests evaluator behavior and is not evidence of a passing production implementation.

**Assembly/freeze limits.** Baseline substitution is sound for the inspected shared bytes, but build.py's default candidate and its shared source list read the live checkout. Neither build.py nor run-pair.py binds compiled binaries to a complete source/toolchain/compiler-argument manifest; the pair receipt hashes binaries, input and resources only. That is acceptable for exposed development, not the later frozen reveal. Before that reveal, preserve exact source lists/bytes, Engine selectors, executor/evaluator/protocol, toolchain/flags, resources and executable hashes together, and verify those bindings when executing. I did not locate or execute the binaries named by the development receipt and therefore do not claim their historical source provenance independently. All later source and native reviews must use the final frozen implementation, not this moving tree or the old contract-review Engine hash.

**Exact SHA-256 bindings for this review.** Paths below are relative to this audit unless stated otherwise.

- CONTRACT.md: `f871c65add14a98a80edd3ef347224b16d95981b8fe0f6d5857ebfc7cc9d07c0`
- contract-review-v1.md: `09e61c18de9d99780dc6ddd30e483104979e2bc1d8fc1de78f87c4f9479dcc3a`
- contract-review-v2.md: `f359d97437fbed457311b3ea26666e0165dd45a9e094122eb20d6539e94e72bf`
- PROTOCOL.md: `a7e2f35979a030b4d2bc49b77b0cec68cf4c4d8865045c0ce3310b15181e494c`
- Runner.swift.txt: `ce912556ddec4bc33e16fc2ae4d0967bc5c096fb4ed9efc4d017738ae9adfa14`
- build.py: `44eee18c4b9ec9c292dad24215df63b85c50a445d30cb83cf75d2c11a4913691`
- check.py: `87f9857853d376b3d94556ce7f628e709a45a91519de3568bd9c93dea33899ec`
- run-pair.py: `01c73bf5e7aaa8a20dcf92aa7c8f9ea43d561a3e523f1bf68debf5cdcf4e978b`
- test-check.py: `eb232e6b5047d63a9c16e5bb01408884bbdbdaa8514176e4ffd3bdcf55d77d89`
- make-development.py: `08cd08991782aa12f2f930b8b31e2398bc3f960cb5a09cfa6dc05ec97c386682`
- development.json: `046f4a0e666fd3904a9d30de5029aceeacc35bd22f1957cacc3c7292ccac7ce9`
- development-baseline-preedit.json and development-v1/baseline.json: `dc4bfe2597e697675a512f0ed3eefaff7b71165bc0e1542f575f3afa66f7c53c`
- development-baseline-preedit-process.json: `0734f70e8e81d0427abd5b257f2876a36dda78aa3701eb0073f24689a6eccd1b`
- development-v1/candidate.json: `36c04d826980f6358cc59b7f624a81cfa0550160ec984cf03ab171732cdca5f3`
- development-v1/report.json: `d4eea074980311c3088518dacb15a83a0f04f2c5bf1571002214a0a18602228b`
- development-v1/process.json: `8a982e1148e7044472c3f3ac97e127ac1784790a3fa80b82d9e298b01ecb9637`
- development-v1/receipt.json: `21b98a98459d4895b6382e382e23a29384a75389765cb80c297dc09c010f06b7`
- check-mutations-normal.json and check-mutations-optimized.json: `1a33e157bd6c1c15855196b02a8c71a47bf7e3584575779f9381e6ec283a4aae`
- baseline-KeyboardEngine.swift.txt, verified equal to parent Git object: `3f0987051ff0f176a5e1ef6396d415b0f8fe0fc2088735c75fef87f75158de97`
- pre-edit-freeze.json: `15fbaef11932a94e2e616cceaf77586df55a52e9ccf2768274f0d15b7b0f5afd`
- dependencies/r44-verbatim.tar.gz: `22e7b2e70846d7f50179bbbb75a1a6c960289c5b72a2634eab2985c96fa11d38` (archive bytes hashed; logs not opened).
- /tmp/pulpo-r44-parent-review/REVIEW.md: `c1af1e2407e55d1c1b36e07a0f06b8abbe7f9d7a26c0998aee5635c38a7864a1`
- /tmp/pulpo-r44-parent-review/evidence.json: `77f24e8db29d9349a2949d21aa85b90b930862114b577e9e2667527eb6b43b3d`

Actual LanguageData resources independently hashed and equal to the pair receipt:

- en_US.pkdict: `168c21378b29aa7fd37838aed910d64348b5267389abfd2dacd0598247cf1e64`
- es.pkdict: `66a256a487f451812ec53920b2a5f2dea9aafb77fbf8e50240a0b87d2729e7fb`
- en_es.pkdict: `93d2d22d58e7e753771dd0e29b19036d74a5ec7aeafba703724c24a93e581237`

Recorded executable hashes, receipt evidence only: baseline `f832a60e689a0dff519b6a4f1d7acf9632d46eb1366c4161cf95fdac915bed1c`; candidate `70b09b9c7490c5f12ee64c43179a06ee633aa0782ae1000d9cbeeeb79fcda8f4`.

Re-review should verify the bounded fixes and their adversaries against new exact harness hashes before fresh authorship. The current exposed pass remains retained, the current evaluator remains unadmitted, and every original R44 failure remains failed.
