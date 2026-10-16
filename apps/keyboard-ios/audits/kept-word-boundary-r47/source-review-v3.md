**R47 independent frozen source review v3 — BLOCKED for production/source admission.**

The exact v1 and v2 between-action canonical replacement witnesses are resolved. The native test-source objections remain resolved. One production continuity gap remains: external acceptance clears the composing occurrence before calling the document primitive, which disables the scalar-replacement helper while the captured taps are still awaiting acceptance. An observable canonical replacement callback during that primitive can therefore be forgotten if the original scalar spelling returns before final readback. Keep native execution and fresh authorship pending a newly frozen source decision. This is a bounded objection to the extra touch channel; no change to ordinary reconciliation or prohibited subsystems is requested.

I read the full source-review-v1.md/source-review-v2.md and both source responses, source-freeze-v3.json, CONTRACT.md, PROTOCOL.md, SOURCE-CONTROLS.md, the admitted contract review, the complete current Engine/Support diffs, focused core and hosted UIKit tests, relevant unchanged Engine/context/commit/correction/deletion/restoration paths, positional TypedWord/TouchModel behavior, and Controller/KeysView/search routing. I inspected retained exposed JSON, structured XML, build/source receipts and hashes, original parent review/evidence and R44 rejection material. HEAD is `e503e5a6646208c6dc125271431bbb9d677b9bb8`. The production diff is Engine-only, +123/−1; Support is test-only, +8/−4. Of 41 pre-edit frozen production sources, only Engine differs. No R33/R45 changes or TouchModel/storage/dictionary/normalization/tuning/Controller/transcript/lifetime edits were introduced by this diff.

Only this report was written. Review verification used read-only source/Git inspection and independent Python calculations over retained JSON/XML/archive/hash bytes. No model/executor execution, build, test run, device creation/driving, logs, persistent model stores, other sealed data, delegation, commit, PR operation, push, merge or deployment occurred. Compressed XML/source archives and binary hashes were inspected in memory without extraction or execution. Retained executions are development evidence, not new review executions. Evaluator v3 admission runs separately and is not supplied by this report.

**1. Blocking production counterexample: scalar invalidation is disabled during pending external acceptance.**

Locations in KeyboardEngine.swift: composing's empty-state observer at 123–125; external capture/consumption at 497–509 and acceptance at 525–532; helper guard at 580–581; canonical callback lag return at 1195–1206; primitive preparation at 1252–1259.

`insertText` captures `typed`, `occurrence` and `touchContextRevision`, establishes `acceptsTouch`, performs the existing word learning and sets `composing` empty. Its observer immediately sets `composingTouchOccurrence = nil`, without incrementing the revision. This consumption is appropriate for exactly-once behavior, but `invalidateScalarTouchReplacement` begins with `guard composingTouchOccurrence != nil`. Consequently, every callback during the ensuing primitive bypasses the new scalar/history checks even though the local captured occurrence remains eligible for the later extra contribution. The final revision comparison can only catch invalidations that actually run.

A bounded source-derived witness uses the existing Spanish fixture and MockDocument.onWillEdit seam, with stable ID A, complete contexts, collapsed selection, learning enabled and autocorrect/capitalization disabled:

1. Initialize the fixture and set `engine.clock = { 0 }`. Use the existing `engine.type("cafe\u{0301}")`. It supplies c/a/f points plus a nil final Character slot. Establish the same independent valid-spelling premise as the mandatory Spanish controls. Touch weight is zero.
2. Install this insertion hook after typing; it edits no Engine state directly:

   ```swift
   doc.onWillEdit = {
     doc.text = "café"
     doc.cursor = doc.text.endIndex
     engine.documentDidChange()
     doc.text = "cafe\u{0301}"
     doc.cursor = doc.text.endIndex
     engine.documentDidChange()
   }
   engine.insertText("🎉")
   ```

3. Allow the ordinary MockDocument insertion to append the requested emoji after the hook returns. No identity, privacy, selection, suffix or availability change is needed.

At primitive entry, `insertDocumentText` has remembered the exact decomposed pre-insertion own snapshot and advanced `expectedContext` to decomposed `cafe\u{0301}🎉`. The composing occurrence has already been cleared. The first callback visibly exposes precomposed `café`; the scalar helper returns at its initial guard. Ordinary reconciliation finds a canonically equal recent decomposed pre-insertion snapshot. With the constant clock it deterministically takes the existing lag return at 1203–1206, without incrementing `touchContextRevision`. This snapshot is not an exact scalar own echo. The restoration callback likewise takes the ordinary history return. No callback resets composition or the captured revision.

The document then synchronously inserts 🎉 into the restored decomposed spelling. Every final immediate guard passes: exact expected scalar before-context, unchanged empty tail, collapsed selection, same captured occurrence ID, unchanged revision and old Character prefix retained. Source therefore predicts **candidate weight 3 versus baseline 0**, although the contract requires zero extra contribution after the observed scalar replacement. Both routes retain exact `cafe\u{0301}🎉`, Character caret 5, collapsed selection and one kept-word event. The three centered taps can leave offsets numerically zero while still creating the forbidden three samples; weight and full offsets must both be asserted. This is a source deduction, not an executed v3 failure or a claim about unseen output.

This is an observable replacement followed by restoration, not the declared identical same-ID unobserved-replacement limit. It uses the existing synchronous callback seam and old lag handling; no queued delivery, custom executor capability, unsupported caret endpoint or policy assumption is required. The second callback is useful to make restoration explicit; the first callback alone followed by scalar restoration and normal insertion already exposes the guard gap.

Keep this additional acceptance's invalidation tracking active until its primitive/readback decision finishes, even after composing ownership is consumed. A local pending-acceptance marker or equivalent revision observation can do that without changing old canonical reconciliation comparisons. Add a bounded actual-Engine primitive callback-roundtrip negative and an exact-scalar pre-insertion callback-echo positive, checking final scalar text/caret/selection, unchanged word behavior, full-zero negative touch and the positive's matched Space state. Preserve existing earlier-own echo positives. The present primitive canonical-prefix control leaves the changed scalars in final readback, so it does not exercise this restoration bypass. The v3 callback/poll roundtrips occur before acceptance captures and clears the occurrence, so they do not cover it either.

**2. Disposition of every prior source finding.**

- **v1 latest-context replacement/restoration: resolved for its exact witness.** With an active occurrence between actions, the helper runs before callback acknowledgment and polling early returns. A canonical-only scalar match invalidates occurrence/revision; later restored bytes cannot reacquire ownership. The retained v1 actual outputs still show baseline 0/candidate 3 and remain inactive historical failures.
- **v2 earlier-own canonical snapshot plus restoration and confirmed deletion: resolved for its exact callback and polling witnesses.** The helper now checks full before/after/selection snapshots against the latest expectation and all retained own histories by exact scalars before consulting canonical equality. Canonical-only history matches invalidate. Exact earlier own echoes return without invalidation, preserving the intended positive. Mandatory arguments use a constant clock, cover both earlier callback/poll negatives, restore the latest spelling, then perform the confirmed suffix deletion. The exact-earlier positive and latest-context controls are present. Retained v2 outputs still show baseline 0/candidate 3; v3 does not relabel them.
- **Missing-context/noncollapsed-selection observations: supplied between actions.** The helper independently invalidates an active occurrence for either condition before polling can return. The hidden-poll/restoration negative exercises loss of visibility. This does not discharge item 1 after external consumption disables that helper.
- **Nonvacuous primitive tail control: resolved.** The test uses a whitespace-prefixed decomposed suffix and an unchanged-tail three-sample positive. Its zero isolates changed tail scalars rather than merely starting inside a word. Primitive prefix, live identity, nullable identity and policy controls remain present.
- **Confirmed versus refused suffix deletion: supplied.** Pre/post scalar/identity/alignment/revision guards preserve only a confirmed nonempty Character suffix removal and its corresponding optional slot. Mandatory cases include confirmed nil-slot deletion, ID and nullable-ID transitions, inherited separator text and pinned autocorrection undo. The new independently valid `planes` refusal proves unchanged actual text, Character caret, collapsed selection and ID; callbacks and later explicit realignment to valid `plane` cannot recover taps. Kept `planes` positively matches full ordinary Space state at six samples. This closes the earlier invalid-spelling-vacuity concern. Negative primitive/nullable/deletion/skip cases now check full zero or complete prior offsets as appropriate.
- **Accepted pending correction and order: supplied.** Actual `teh `→`the ` is asserted before external insertion; it accepts exactly three correction samples and one word event through the unchanged pending path, with follow-on no-duplicate assertions. New kept-word validity is captured before its own word learning. Existing reconciliation, space-slip clearing, pending acceptance and word-learning order remains intact.
- **Native search entry/result and full-state assertions: remain resolved in source.** Hosted test bytes equal v2. It sends the offered `emoji-search-open` UIButton's installed action, types the query through Controller, asserts document/caret/full-touch/count/pair isolation, and sends the actual offered EmojiResultControl action. Picker uses a real offered collection item; `.com` is obtained from the URL layout and asserts full zero. First/second external occurrences compare full offsets with corresponding Space controls and pin text/selection/word/pair state; duplicate callbacks and extra emoji/Space retain state.
- **Native alternate route: remains resolved as hosted component source.** Real KeysView touch tracking, the production long-press timer, offered popup selection, movement and touch end deliver é through the actual alternate route with nil tap, among measured c/a/f slots. This is controlled synthetic UITouch/geometry coverage, not finger hit-testing, installed-extension delivery, VoiceOver or human accuracy.
- **v1 package drift: resolved for this v3 binding.** All 59 source-freeze-v3.json entries match at initial and final checks. The original v1/v2 freeze files remain byte-identical. This binds v3; it does not retroactively admit either blocked predecessor or the separately reviewed evaluator.

The remaining bounded structure is consistent with the admitted contract: captured nullable document identity is checked live before/after acceptance; derived/restored/inherited text cannot acquire an occurrence by equal spelling; aligned sparse `ca` plus nil-slot `noe` teaches only its two points, while inherited `mu` plus tapped `sic` remains excluded. All-nil supplies none. Ordinary Space, normalization, forgetting/saturation, word/pair and policy paths remain unchanged. Exact sample/net-weight equality applies only to the declared unsaturated supported histories. Boundary/tail predicates match the published bounded supplement, including effective leading whitespace, attaching punctuation rules, distinct emoji/keycaps, connector exclusions and preservation of the old scalar/Character prefix. Consumed uncertain insertions have no deferred recovery. Item 1 is a remaining continuity violation within otherwise exact final readback.

**3. Retained evidence and its limits.**

I independently parsed the ordinary v3 XML used by source-controls-final.json. It contains 464 KeyboardCoreTests and 3 PulpoServicesTests definitions, 19 skips, no failure/error elements, finite nonnegative numerical attributes, and consistent executed-plus-skipped suite totals. Exactly the sixteen required R47 definitions are present, with exact receipt names and no child failure/error/skip nodes. Its decompressed hash matches the receipt. All 26 receipt source entries and three EN/ES/BI resource hashes match current bytes. The serial Release summary records exit 0 and the same five known issues. Parameter arguments are correlated subcases within definitions, not independently enumerated XML trials. The earlier focused XML is distinct evidence with its earlier hash; I did not mistake it for current v3 coverage. The first v3 validator total-convention error remains retained, separate from the corrected validator and subsequent passing receipt.

The current exposed development packet has 64 cases and 347 correctly ordered rows per variant; its retained report records 5,285/5,285 checks and zero unavailable. Independent raw comparison finds 85 correlated changed rows, all changing only weight/offsets. Every other emitted field matches, including exact scalar text, Character caret/selection, word totals/counts/pairs, policy, validity, identity and primitive count. All 694 touch states have finite complete 26-pair offsets. Independent recomputation found no failure in its 21 full before/after Space parity relations with declared positive increments, 128 full-state holds, 96 literal-zero relations or all-row zero-role states. Process records report exit 0/empty stderr. These are exposed development corroboration; neither this packet nor the mandatory source contains item 1's primitive callback-restoration witness. Arithmetic agreement does not independently admit evaluator v3 or supply a fresh oracle result.

Both final build receipts' 25 compiled source/Runner hashes match their exact archived source paths and current sources, substituting only archived baseline Engine for baseline. Decompressed retained baseline/candidate executables and the mandatory-test binary match their declared hashes. Hash checks do not establish reproducible compilation, historical exclusive execution or blindness. The retained native v2 build-for-testing receipt has exit 0 but binds v2 Engine `a0557493…`, not current v3 Engine `1604e2f6…`; it is compile-only historical evidence and cannot certify current native execution. No device has been created or driven by this review.

All 117 dependency-manifest entries match archive bytes, including the explicit pulpo-r44-parent-review→parent-review mapping. Original parent REVIEW.md/evidence.json remain exposed dependencies. **R44 stays REJECTED and inactive:** 70 cases/211 rows, baseline 777/777 versus candidate 776/777, aligned sparse canoe's frozen-zero failure unchanged. The successor sparse-slot contract and later relational checks cannot repair that immutable loss or the missing original preseal relational evaluator.

**4. Exact v3 SHA-256 bindings.** The complete 59-entry source/executor table remains in source-freeze-v3.json. Principal decision/evidence bindings follow:

- source-freeze-v3.json: `98243ab3a493be26617d7358a083d7a4e2f1009662780dbcf7b6af7b052db45b`
- KeyboardEngine.swift: `1604e2f667e00b23178f383191bc41e3cdf38ece73da388e3c645d12561d26f8`
- Core ExternalTextTouchR47Tests.swift: `032b3ea1b72267d76a64a419336b7a883c57df55e5e13ce752ceb792171471b6`
- Support.swift: `419f343bf1ac39cad59d6dfa86f108aa5496e9f09b02ac77ab51cde2fcdc68e1`
- Hosted AppTests/ExternalTextTouchR47Tests.swift: `48d80c3193b63068596ff87bf32d70dde85a9c8ae85a0978b79df4c7497c0971`
- CONTRACT.md: `f871c65add14a98a80edd3ef347224b16d95981b8fe0f6d5857ebfc7cc9d07c0`
- PROTOCOL.md: `95d7ff891055517fb9996ffc44ad396a15be959fca5ca1a71458d0e00ea56a1c`
- SOURCE-CONTROLS.md: `c16d689e2e8dc04ee6d666014f9f57bca62bbecd9b78798bd992133c096b5eb9`
- validate-source-controls.py: `c002388030b10f749b631b2f5a0a1fd2c949b354386a9bbaa8127ad8beb9e461`
- source-controls-final.json: `6faf3713b66b3116f3bc0c5968772be393a1913a22225d48bb93836a3f8f8e98`
- Ordinary v3 XML, decompressed: `a4561425f02ded818669831134014e2f5658035eb71680224e93b2678cf6018b`
- ordinary-final-summary.json: `2a872ea2c00aba1daedb6d1f6e0b128617ef7528ba2c8d2d522b8db35d9a397b`
- Mandatory-test binary, decompressed: `b97e00af4e9dd64f9c9acec8141312432a8176cd6a40e8b56202811d57e4d403`
- Runner.swift.txt: `ce912556ddec4bc33e16fc2ae4d0967bc5c096fb4ed9efc4d017738ae9adfa14`
- build.py: `f5c71ca8e6a52246903395604c799968765151795109169f989c38c1b4646c9d`
- check.py: `0c4d05b9a2a05c38bb0d9b45067ac59b957e47a5d6da9ced24b91e14649f01d2`
- run-pair.py: `8300bba61cca862e09bd451d83629cae70fbe7b1a99b57fe382bda0ca815e9f6`
- freeze_gate.py: `9585ab3ba8a20876a1022700d0722a65514dae794fb898a96d901c4ef9889086`
- candidate-final-build-receipt.json: `d7f0c94e78118290682aabe1c982a215bc1fb55771fc18a964ced53cd176af52`
- baseline-final-build-receipt.json: `88eb7ca73f2e04007160ad5c5d9d75e7a3b5f25112d685fb44bad72d6434d72c`
- Candidate model executable, decompressed: `fc3a4c6caa0ae16b7433c648882430631ec3268e9074d6c20188f13742f73d2e`
- Baseline model executable, decompressed: `9439efbce99bfe76efab889af00fb6301e0f54ca0de32fa486dc20160f422ae1`
- binaries/candidate-v3-source.tar.gz: `85bc8c9fd6333f373687441cdc9cec187144be76c298e868854cbad5a73c78d6`
- binaries/baseline-v2-source.tar.gz: `9652fd0719ec494615f8e42fc4a1a505a748ad4196f185ee46be386a7d0e8846`
- development-v3.json: `13a3d8048a1c07e2c8fe6a5f3cf86deb8686b3450618baf2eac989530bb92b7a`
- development-source-v3/baseline.json: `8990580c00354f90ad751257b1ed34f1bd874720abb0d85bcc91b53930061d13`
- development-source-v3/candidate.json: `3057eb25606ae63d54254a543a955906300c0923fc588f9c7d54116f2d7c4b9b`
- development-source-v3/report.json: `365670f61b4608597277df6c4693c97d9d85b1d8bb861ac7f1308f830ebe8382`
- development-source-v3/receipt.json: `f77c7cb48ef38f075de0e15b9d46569e7c97aa7e200c9122d8599a7b98d95cbc`
- dependencies/manifest.json: `28a2753070f3e4e1791d261d30f6cc98db8b07a837bf9fef7e3ee047bee9d8e0`
- dependencies/r44-verbatim.tar.gz: `22e7b2e70846d7f50179bbbb75a1a6c960289c5b72a2634eab2985c96fa11d38`
- Archived parent REVIEW.md: `c1af1e2407e55d1c1b36e07a0f06b8abbe7f9d7a26c0998aee5635c38a7864a1`
- Archived parent evidence.json: `77f24e8db29d9349a2949d21aa85b90b930862114b577e9e2667527eb6b43b3d`
- Baseline Engine: `3f0987051ff0f176a5e1ef6396d415b0f8fe0fc2088735c75fef87f75158de97`

**Final bounded source decision: BLOCKED on item 1.** The exact earlier source findings have the dispositions above; none is silently carried forward or retrospectively erased. Preserve v1/v2/v3 source and exposed evidence, close the pending-acceptance scalar invalidation gap locally, add its negative/exact-echo positive, and freeze replacement bytes for independent source review. Native harness source is ready in the bounded sense described above, but current native execution waits for source admission. Independent evaluator/executor v3 decision, current-source native evidence, fresh sourceblind authorship/oracle review, strict final source/resource/binary/input freeze and one paired reveal remain separate gates. No fresh author/input/seal/reveal or shipping admission is established here.
