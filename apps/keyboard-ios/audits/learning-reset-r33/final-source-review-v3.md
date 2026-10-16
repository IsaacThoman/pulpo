# R33 independent exact-source review v3 — PR782

Decision: **REJECT candidate `4fa9b1e7b39cb1e5db835eeb3c4b111f6540c566` with frozen `run-v5.py` for blind reveal.** Encoding 3 fixes the reproduced current-runtime canonical-history loss, but its persisted Character-count header has a concrete Unicode-version compatibility defect. A separate, independently reproduced noURL pruning defect violates the retained memory-domain semantics and index bounds. Keep blind material sealed and unexecuted. This is an exact-source/reveal decision, separate from release/integration approval.

**Evidence boundary.** Review inputs include the original `/tmp/pulpo-r33-review-responses.txt`, binding contract/schema/public map v3, retained protocol reviews 1/2/3, early development review, rejected final reviews v1/v2, candidate-preflight-v3, production/test changes from `305a8893911b7ba54186110ea9f0b919c9d6382e`, development report/driver, runner/worker/validator/gate/map, parent-integration receipt, final gates-v3 and its exact-byte archive, and the later supplement. The supplied user updates are distinguished below from independently executed evidence. No blind directory, payload, seal file, authorship material, or blind product result was opened or executed. Declarative blind hashes/counts in allowed manifests were not independently verified against blind files. No devices, deployment, nested delegation, other checkout, source/test/owner-UI edits, or repository writes were performed. Only temporary review artifacts were authored.

All five product and ten runner/protocol manifest hashes match candidate-preflight-v3. Product and test files match their exact committed candidate bytes; `git diff --quiet 4fa9b1e7 -- apps/keyboard-ios/App/AppModel.swift apps/keyboard-ios/PulpoKeyboardKit/Sources apps/keyboard-ios/PulpoKeyboardKit/Tests` succeeds. The audit directory already contained ongoing modified/untracked evidence, and gained the announced receipts during review. This report binds enumerated working-byte hashes rather than asserting a clean whole checkout.

Independently extracted all 25 KeyboardCore Swift files using `git show` at the full candidate commit, then compiled those copies with the exact frozen worker using `swiftc -O`. Compiled the exact gate separately. The initial gate link omitted `-lsqlite3` and failed with undefined SQLite symbols; the corrected link succeeded without source changes. Both the failed command/stderr and correction are retained. Host: Apple Swift 6.4 (`swiftlang-6.4.0.34.1`), arm64 macOS 27.0.1. This is one host/runtime, not a supported-iOS-version matrix.

**R3 — P2, blocking: Character-count headers are not a stable persistent component grammar.**

Exact source: `PersonalDictionary.swift:103–131`, especially creation at 107–108 and current-runtime Character indexing at 123–126. Whole-authority decoding/opening occurs at `LearnedDataPersistence.swift:66–95, 305–350`; combined reset must first open/validate that authority.

The prefix is `history.count`, but decoding advances by that many Characters according to the *reader's* grapheme implementation. Neither the stored encoding version nor any metadata identifies/pins the writer's Unicode segmentation rules. A count change makes the reader look for U+001F at the wrong position. The delimiter isolates components on a fixed runtime; it cannot restore a boundary selected using a different count.

This is a specific format counterexample, not just an unmeasured native gate. Swift documents Characters as extended grapheme clusters. Unicode's grapheme rules/properties evolve: the supplied [UAX29 revision 41](https://www.unicode.org/reports/tr29/tr29-41.html) and [revision 43](https://www.unicode.org/reports/tr29/tr29-43.html) differ in Indic-conjunct handling. Those revisions establish evolution, **not which iOS versions implement which rules**. Independently fetched primary Unicode property files give a particularly small example: U+0897 is omitted/default Other in [Unicode 15.1 GraphemeBreakProperty](https://www.unicode.org/Public/15.1.0/ucd/auxiliary/GraphemeBreakProperty.txt), and is Extend in [Unicode 16.0 GraphemeBreakProperty](https://www.unicode.org/Public/16.0.0/ucd/auxiliary/GraphemeBreakProperty.txt). Thus `a\u{0897}` segments into two clusters under the former data and one under the latter rules/data. The candidate does not reject unassigned scalars; this history is nonempty, short, lowercase-stable and within its 256-byte admission bound. Swift's [Strings and Characters documentation](https://docs.swift.org/swift-book/documentation/the-swift-programming-language/stringsandcharacters/) explains the Character model; its equality guarantee does not freeze segmentation for a storage format.

Independent current-host observations:

- `"a\u{0897}".count` is 1.
- Created a supported authority through the exact worker, then installed a **synthetic prior-writer payload fixture** with encoding 3, pair key `2:a\u{0897}\u{001F}r33compat`, count 1. The prefix 2 is derived from Unicode 15.1 properties, not obtained by running an older device.
- A new independent worker reports dictionary=invalid **and touch=invalid**. Combined clear returns completed=false/result=invalid. The payload remains byte-for-byte preserved. Its query value 0 is an unsuccessful/default initial view and is **not** counted as a successful erasure observation.
- An otherwise identical control key with current header `1:` opens both stores with ok, returns pair count 1, and permits combined reset.

Raw fixture inputs/events are in `/tmp/pulpo-r33-review-v3-exact/migration-results.json`; downloaded primary bytes/hashes are in `unicode-evidence/`. This proves current-reader behavior on the synthesized older-grammar bytes and a source-level cross-version format incompatibility. **No old iOS runtime was executed, no specific iOS release-to-Unicode mapping was established, and no native OS-upgrade failure is claimed as observed.** The unversioned dependence is nevertheless blocking for an arbitrary-String durable representation intended to survive OS/runtime upgrades. Merely listing it as an unavailable native gate does not supply a stable decoder or a compatibility policy.

Minimal correction: choose a lossless, segmentation-independent component grammar that preserves Swift canonical String equality, lowercase/accent semantics, and current raw input bounds. NFC-only conversion is not required by this review. The proposed byte grammar is a viable direction: within each component, escape UTF-8 bytes 0x5C and 0x1F with 0x5C, then join with one unescaped 0x1F; parse on UTF-8, with explicit validation of escape structure and component count. These ASCII scalars cannot occur as continuation bytes, and their insertion does not distinguish composed/decomposed spellings of the remaining text. Keeping the literal control separator isolates leading marks across the component boundary. Validate/coalesce supported older encodings with checked sums and preserve failure behavior; do not silently discard an unreadable pair or reset an invalid authority. Use a new explicit format version and freeze/review its exact production implementation and refreshed evidence. Any treatment of already-created encoding-3 data needs an explicit safe interpretation; a new delimiter search cannot simply guess among embedded separators. No such correction is implemented or approved here.

The subsequently announced temporary escaped-grammar prototype and its 35,910 checks were **not read, run, or accepted as production evidence**. A feasible prototype does not change this exact candidate's decision.

**R4 — P2, blocking: the durable 256-Character decoder restriction breaks noURL pruning.**

Exact source: `PersonalDictionary.swift:119–120` rejects length greater than 256; noURL `learn` at 202–213 imposes only the existing word-length rule, with unrestricted history; `learnLocally` creates encoding-3 keys at 239–246; prune at 348–372 removes a pair before calling the restricted decoder and skips index cleanup on nil at 364. The binding contract explicitly retains noURL ordinary length semantics, and the adapter explicitly excludes persistent registrar byte limits from memory objects.

Reproduction uses only public APIs on `PersonalDictionary(url:nil)`: for i=0...20,000, learn the same short target `r33memory` after a history consisting of a repeated ASCII `h` prefix plus a five-digit index. Every learn returns true/ok. There are 20,001 distinct pairs and one target word, so only pair pruning is triggered. The existing policy must retain 18,000 pairs; word count correctly remains 20,001 because pair pruning does not erase word usage.

Four independently compiled/executed configurations on the exact candidate:

- History length 30: 18,000 histories remain queryable; final history count is 0. Passing control.
- History length 256: 18,000 remain; final history count is 0. Passing boundary control.
- History length 257: **all 20,001 histories remain queryable**, including the final history with count 1. Failed policy/index oracle.
- History length 305: **all 20,001 remain**, likewise failing. The first independent 305-character reproduction is retained separately.

The primary pair map is pruned, but the corresponding `successors` and `historyTotals` entries are not removed when `splitPair` rejects the accepted history. This leaves query state inconsistent with retained pair state; continued unique long histories can continue growing those indexes beyond the pair bound. No filesystem error, contention, reset, unknown Unicode scalar, external corruption, or native-version assumption is involved. Raw source, compile arguments, outputs and controls: `memory-probe-initial.swift`, `memory-probe-result.json`, `memory-probe-boundaries.swift`, `memory-boundary-results.jsonl` under the review directory.

Minimal correction: make the internal representation/parser cover the complete accepted noURL domain, and apply persistent byte limits at persistent admission/validation boundaries. Do not silently impose the durable 256 limit on noURL histories, truncate them, or skip index maintenance for an accepted pair. A stable escaped component grammar could address both R3 and R4, but must be reviewed in actual production code. Add an exposed over-limit-memory-history prune regression with public pair/history queries and a short-history control. This review makes no product/test change.

**Prior defects and encoding-3 assessment on this runtime.** R1's explicit checked UTF-8 SQLite binding remains at Persistence 745–747, with byte-length text reads. Fixed 32 mutex stripes still give all same-authority cached/uncached coordinators the same bounded local exclusion mechanism; unrelated stripe collisions can return busy. I independently reran the exposed NUL full/prefix/two-suffix/leading-NUL cross-process schedule on the newly compiled exact worker: available/pass, 22/22 oracles. The historical v1 rejection remains retained.

R2's canonical-history loss is closed on the tested runtime. Canonically equivalent histories have equal Character counts here and therefore canonically equal full encoded keys; U+001F prevents target-leading marks, CRLF and ZWJ sequences from spanning the boundary. Length disambiguates embedded separators. The prune suffix after the first ASCII colon is exactly history+U+001F+target, so the optimization preserves the previous tie string and count-first policy; the encoded-key final tie-break distinguishes previously colliding component decompositions. R3 and R4 limit approval of the representation as a whole, rather than negating these current-runtime improvements.

Independent frozen-runner probes: ten new exposed schedules / 170 oracles, all available/pass. They cover Latin, Hangul and canonically reordered combining marks with same/cross-process writers; repeated save, forget and relearn/pin; histories at the 256-byte boundary; embedded-separator component collisions, leading marks, CRLF, ZWJ/emoji and Prepend boundaries; and real successful COMMIT reported as error on admission and payload save. The two later exposed reruns (NUL and the ordinary reload supplement) add 42 passing oracles, yielding **12 executed schedules / 212 oracles** on the reviewer-built worker. These are exposed review executions, not heldout cases or additions to the developer's unique denominator.

Eight separate public-path migration fixtures (Latin/Hangul × encodings 1/2 × legacy JSON/existing authority payload) all confirm pair count 2, merge to 3, repeated durable observation and target forget. Encoding-2 overflow fixture returns invalid for both constructors, preserves the legacy bytes and creates no initialization marker. Decode validates all original entries and canonical-equivalent history sums before conversion; canonicalPairs uses checked coalescing, avoiding overwrite. Cache decoding converts an old payload once; later mutation writes encoding 3. These passing fixtures and the synthetic cross-version header counterexample are separately identified in migration-results.json, not pooled into one passing count.

**Protocol/source assessment beyond the blockers.** The bounded transactional architecture still supports the approved observation and eligibility semantics:

- Global nonblocking flock serializes migration, payload/status commits, revocation and cleanup; the local stripe protects replayable collections. Lazy lifetime slots are taken before global ownership only for token-bearing work. Slotless read/forget/reset still work with eight occupied slots if global ownership is available. Death allows reclaim with a new incarnation; suspension does not. The 32-entry weak registry and fixed stripes bound local authority bookkeeping. Busy/backpressure and eventual availability remain explicit, with no fairness or kernel-I/O deadline guarantee.
- `clear` at Persistence 614–650 places both selected payloads/new epochs and pending-token revocation inside one transaction. One-store reset preserves sibling state. Dictionary/touch observations remain separately coherent, not simultaneous in-memory snapshots. Existing boundary observations and public getters retain zero new per-letter persistence work; remote cached suggestions may remain until a successful boundary.
- Admission reserves sequence/immutable payload before token insertion and teaches only after confirmation. False uncertain reservations stay ineligible and are cancelled. Synchronization consults identity/status before replay; committed/revoked operations leave replayable collections before terminal acknowledgement deletion. Payload plus committed status is atomic, and COMMIT-error confirmation occurs under the same global ownership. Still-active rollback failures cause connection repair/reopen with cache validation invalidated on the next boundary. No unexplained missing token authorizes recreation.
- Save applies eligible operations in local order to the latest durable base, including normalized target forget/revocation, later relearn and pin, exact word spelling with existing case/accent behavior, and retained unrelated tokens. The independently rerun ordinary-reload schedule preserves A's unsaved word/pair while adopting B's durable unrelated word, then observes B's forget, saves/retries and confirms fresh counts/block/pair state. Background work captures coordinators, coalesces attempts and does not copy payload prefixes or mutate model indexes. The 256-per-kind cap includes reservations/receipts; one nonblocking capacity flush enables longer typing.
- Touch replay retains original ordered numeric samples locally and computes offsets once per kept word, preserving clamp/decay. Durable tokens contain no touch text/sample sequence. Numeric validation and checked dictionary arithmetic preserve failure and rollback behavior. The retained early-review fixes remain concrete: full validation before oversized legacy prune, long block preferences, active rollback recovery, separator-safe current-runtime pairs, warm marker/meta/slot checks, successful memory result reset and overflow guards.
- Dedicated authority/marker fencing prevents reimport after established authority loss; malformed/unreadable/unsupported payloads fail closed. Warm identity/data-version validation, SQLite DELETE journal/FULL synchronization and explicit resource limits remain. Cleanup failure is distinct after committed reset. Mixed old binaries, inaccessible fallback storage, hot-journal/power-loss and file-protection limits remain as documented. R3 adds a new way for a formerly meaningful encoding-3 payload to become unreadable; fail-closed handling does not solve that compatibility defect. R4 is the exception to otherwise preserved noURL semantics/bounds.

**Frozen runner and gate assessment.** V5/schema/worker/validator/gate/map hashes remain unchanged. Public admission/completion/observation outcomes are typed and asserted; reload changed is separate, background acknowledgement is only enqueue, touch is one kept-word invocation, and fresh-zero conclusions require successful observation. V5 preserves prior busy replies across worker retry errors and cleans failed constructor responses; only confirmed busy is retried, expected busy is immediate, and ambiguous failures are not silently reissued. Static validation cannot independently prove every gate reachable or every zero-state oracle causally valid; semantic review remains necessary. Arm acknowledgement alone does not prove fault execution. beforeTransaction precedes global acquisition, beforeCommit/afterCommitBeforeAck retain ownership, and reportCommitError performs a real successful COMMIT before returning IOERR. R29's inside-replacement schedule remains unavailable under serialization, not passed. The previously recorded Popen-before-self.p allocation cleanup limitation remains a harness boundary, not a new product blocker. Independent static blind reseal acceptance is supplied evidence; blind contents were not used to reassess novelty/reachability.

**Final exact gate reconciliation, distinct from reviewer reruns.** gates-v3 binds this candidate and runner. All nine live artifact hashes match, and every archived receipt-bearing file matches its original bytes after base64 decoding, including CR bytes in the core log. Archive has 52 files. I checked schedule/fixture/resource booleans rather than relying only on summaries; these full gates were not rerun by this reviewer.

- Core raw log: 454 tests / 65 suites, exactly five known issues: two existing host-state ambiguities and three multilingual offer issues, zero new unexpected issues. Fifteen added regressions; original semantics/accuracy ceilings remain. Services 3 and generic iOS Simulator Release exit 0 are receipt evidence; the successful native build log remained unread. Python data raw log confirms 11/11.
- Original final process gate: 15/15 available/pass, 219/219 oracles, ten available/passing fault fixtures. The later supplement is a full rerun of those 15 plus **one new unique ordinary-reload case**, 16/16 and 239/239, with the same ten fixtures. Union is **16 unique schedules**, not 31. gates-v3 and the 52-file archive remain unchanged; supplement results/inputs are separately archived. Supplement does not retroactively change the original receipt denominator.
- Resource: all 7,234 checks true, 1,000 accepted operations, 5,000 coalesced requests under one held transaction, pooled worker RSS growth 32,768 bytes, noURL files 0. Twenty crash repetitions are **one unique schedule**. Preserve historical unpooled +23,248,896 bytes and earlier pooled +16,384-byte runs; final +32,768 is its own result. noURL-files=0 does not test R4's in-memory index pruning.
- Final actual EN/ES/bilingual shared-authority space maxima: 10.898791 / 3.676625 / 4.633459 ms. Standalone capacity-flush max 26.536875 ms; save max 26.132333 ms; clear 1.045625 ms. Current full authority is 2,039,808 bytes. These are measured runs, not universal filesystem deadlines; existing 25ms suggestion/60ms glide ceilings remain unchanged. Earlier comparator spike, baseline/deltas and candidate2 timing are retained as separate evidence, not replaced by the faster final run.

Earlier rejected candidates, failed injection attempts, v3's busy-unavailable attempt and retry-capture limitation remain retained. gates-v2 is candidate2 history, not a new pass for candidate3. A passing prescribed gate cannot override either new defect. No blind execution or paired baseline denominator is invented.

**Release/integration boundary.** Concrete parent Settings/Forget patches remain uninstalled/unvalidated. Actual Settings still calls clearLearnedWords then sets its success flag unconditionally at `App/PulpoKeyboardApp.swift:173–174`; the result/error binding is not installed here. R33 AppModel correctly returns confirmed combined-reset success and error text; the controller leaves a suggestion available on failed forget, but user-visible failure/retry feedback remains parent work. Native UI, OS-version migration, suspension and device file-protection proof remain unavailable. Generic native compilation and macOS SIGSTOP/SIGKILL do not establish them. These are release dependencies in addition to this reveal rejection.

**Disposition.** Do not reveal 4fa9. Before a new reveal review, implement the minimal stable, equality-preserving pair grammar and complete noURL parser/index behavior within authorized production scope, retain both failures/controls, freeze the replacement source and exact evidence, and request another independent exact-source review. No source tuning after reveal is authorized. No prototype, historical protocol approval, passing receipt or owner patch substitutes for that new review.

**SHA-256 inventory.** The following hashes bind reviewed bytes. `audit/` expands to this checkout's `apps/keyboard-ios/audits/learning-reset-r33/`. Full temporary artifact/command inventory: `/tmp/pulpo-r33-review-v3-exact/hash-inventory.json`. The exact 25-file compilation is recoverable from the full candidate commit and compile-command.json.

- `audit/candidate-preflight-v3.json`: `d1ada84e355eef33b1805f6a4fc094d0358ee7a6477b9d60defb641ec7bc670b`

- `audit/contract-preflight-v1.md`: `2e139d8f0b8ad166a8bb51a0e2fcc07e181f5092217bfb86a396b350070bcef7`

- `audit/contract-preflight-v2.md`: `7449329e06001017f35411fe1555fa6e45841b6f4c75484a27911e0cb45be588`

- `audit/contract-preflight-v3.md`: `a517f4b627b3575a99d0959240a0a6bd3a0dd2781c7d763c52214fe714799ccd`

- `audit/schema-preflight-v3.json`: `2b7a34f6c482a6ac0ffe7f23c2d9964c72b6f31c34eed3f0b7aa59f75e4cb6ef`

- `audit/public-api-v3.md`: `85289af4b0993e78250b0d223d28aa4568ca0488036dd0356f1818c8c701997e`

- `audit/protocol-review-v1.md`: `77e045b2dd8f83aeab974431e3b7919c322d87608f96f6c8c17260ea66e8247f`

- `audit/protocol-review-v2.md`: `3571b2443a66dd789a144776232cae57802a568825ea258cf26aa9c6e997b116`

- `audit/protocol-review-v3.md`: `a8f3c441e903a097640998250ffa7a2e989efbece6ef7ebd3ab36685cf61f85e`

- `audit/development-source-review-v1.md`: `72c832684260b7619ec1edcbe3ba4fdb5aec9f3673312d6f35f342fc25ae49b3`

- `audit/final-source-review-v1.md`: `e362574c0974b8027e8f5a6e5f22c806ecf1eb39bedad83959038b5a055eb4a1`

- `audit/final-source-review-v2.md`: `fc3dd3ba064fba41cd992ccb9e9be1a67babd4744c9e9c39f6fa20ef700d0810`

- `audit/development.md`: `e29ab7ace973d25bb5dda381c88290de1179f4599807c7b9394874c4330cf452`

- `audit/development-checks.py`: `32c33e08b70e2a556338695105f4ae0ac252191e496554dbaaf2b25f27661c62`

- `audit/run-v5.py`: `09072bc189cfedf010caad9b401b00e6e6f6b8e06f0fe025ce432ef8c4af48dd`

- `audit/worker-v3.swift`: `420e7003a48cf7d5a5b63945830cbf03250a871e6c2661e6b57e37632fa9a6f7`

- `audit/validate-v3.py`: `218cb903730a3557f53b0a7d353be3e40354548a3eb7700d02ca780eecd05d64`

- `audit/transaction-gate-v3.c`: `c16b02907a8ac665f071ac94b24b427b843f3b92ba45caf56ffb2fca30cf9b0d`

- `audit/adapter-capabilities-v3.md`: `f24e6e50f9fc803282cfe86a2a2474ec56ed94ca120584d06d501f613dc36b2d`

- `audit/gates-v2.json`: `07a02cd2964372878f5c0ca81a7a6b52e9e449da629a240752be79d3781282a4`

- `audit/gates-v3.json`: `3b76dcf3484a465a76042b9efe3e1d4258cb354f65750caa8eedd0f34a42af9f`

- `audit/development-raw-v3.json.gz`: `d4453c2961c46c669c613f61b9baee1d398a9e88dffeaf41c2efd9ba522495bf`

- `audit/supplement-v3-raw.json.gz`: `b595f91deadd401a9e3cb9a45c5bb6e39fb4b44676270f60bf201e958478900d`

- `audit/parent-integration.md`: `81decac8ca71cddcea090b366646defc85705764020a73ba498540fc2ebf817f`

- `apps/keyboard-ios/App/AppModel.swift`: `c9707901f8803489b0f01188932c298337fa80d785385cdd5c978d3c6b9d1bbd`

- `apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardCore/Dictionary/PersonalDictionary.swift`: `191be9a52b4f9ba13d882b8aff0b6edf198e9bd6b2d1e8a758c8a74deeb32994`

- `apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardCore/Geometry/TouchModel.swift`: `fc5f3d9f9f6fdd57d8aa7c4e61556ef29284339ccd3f045c22404701b08e06ef`

- `apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardCore/Shared/LearnedDataPersistence.swift`: `b8b677359f055c29f3b325a31a664974101740499c9ede3df86adafe72a97390`

- `apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardUI/KeyboardController.swift`: `3b4e7997dd7a7429da4737e68045725c14381c7881424d0cb91e50c6744755b8`

- `apps/keyboard-ios/PulpoKeyboardKit/Tests/KeyboardCoreTests/LearningPersistenceSupport.swift`: `afedbf1c9490b502441e40c0329f7a288e4815c9cbd91a20f7b98145be31af55`

- `apps/keyboard-ios/PulpoKeyboardKit/Tests/KeyboardCoreTests/LearningPersistenceTests.swift`: `92120a12af70db5d686c6007ef9e5b935b8b02983475e0af81aacef1b1f1cf06`

- `apps/keyboard-ios/PulpoKeyboardKit/Tests/KeyboardCoreTests/PersonalDictionaryPersistenceTests.swift`: `6e61233f1576e0c01ab1c8c499a274afef7d0a5088320c8ae5de693fe7f49dd0`

- `apps/keyboard-ios/PulpoKeyboardKit/Tests/KeyboardCoreTests/TouchModelTests.swift`: `217c4b7dfa049df83f952502b18cb1f10b5f09292193466fe408d5c588991f0e`

- `/tmp/pulpo-r33-review-responses.txt`: `408c632625222d1af941014ed5775ee451f140ce43a4ad9cd895f871868ec79f`

Reviewer-built artifacts and exposed runtime evidence:

- `/tmp/pulpo-r33-review-v3-exact/worker`: `99639ff53c5205f9853a1985e952277c7c8be2873974474fc678f47c930727be`

- `/tmp/pulpo-r33-review-v3-exact/gate.dylib`: `1bf176d91851d0a5996502fcb7f9e051110e94037773514b70bee76c46be1090`

- `/tmp/pulpo-r33-review-v3-exact/exposed-probes.json`: `25430c341bf8ab1e92f83cf0faa05be1a39a892d93e6ef4621d3528a686dca37`

- `/tmp/pulpo-r33-review-v3-exact/exposed-results.json`: `645570c90a4f299f306626796b7138d371fa7562955aba700b9627d48c832b29`

- `/tmp/pulpo-r33-review-v3-exact/additional-exposed-probes.json`: `6996aac6a30227d749fcc8772a418c41cb15353ee7603f2c629da0c4cbac40de`

- `/tmp/pulpo-r33-review-v3-exact/additional-exposed-results.json`: `0428242d82045776e7e8709201ca323742358446e37f9b0078aa821d73020f90`

- `/tmp/pulpo-r33-review-v3-exact/migration-probes.py`: `1374d8e4b1790daa0207450c05c68bd65bd96d5a425654ed0bc0c98fd8f7ac7c`

- `/tmp/pulpo-r33-review-v3-exact/migration-results.json`: `b31adb5ac9a4943d819c79d401c25698ebcc25d8afe0898a7c95bb25e1cefbb8`

- `/tmp/pulpo-r33-review-v3-exact/memory-probe-result.json`: `9ad7824f3c751e079d0a483827f03e036dc2e5c43e56aa3ea68d08a70383de70`

- `/tmp/pulpo-r33-review-v3-exact/memory-boundary-results.jsonl`: `fd85eb283abb10829245bf87b375f7d8fa1d12c8413cf1e74b3e4fb2030ca137`

- `/tmp/pulpo-r33-review-v3-exact/gate-reconciliation.json`: `a456a9ca62e3625aecac1b66beb69dac66253d1249ed6ad697033e53e742a433`

- `/tmp/pulpo-r33-review-v3-exact/supplement-reconciliation.json`: `d004bd7ce85e638dd184b184fbffcf5d850f56dedc9112c32a9d699a090eaecc`

- `/tmp/pulpo-r33-review-v3-exact/unicode-evidence/gcb15.1.txt`: `a7e52eee647e52dc210b8719b4d7037276f4b353810293d69377fc46374cec3f`

- `/tmp/pulpo-r33-review-v3-exact/unicode-evidence/gcb16.txt`: `c29360bd6f7132811d701d29069541e827eb44bfc4c8fbde8c370d6982689dc1`
