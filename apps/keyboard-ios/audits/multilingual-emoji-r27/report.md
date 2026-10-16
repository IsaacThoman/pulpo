R27 result: REJECTED; production restored exactly

Do not import candidate 0d46d60b as a product improvement. Source review rejected
it before sealed reveal. Final net changes against parent 5e515366 are audit-only;
production resource, Swift, builder and tests are restored byte-for-byte. Parent
must review and run its own verification before importing any audit commits.
No push, merge, deployment, device operation, or parent-checkout edit occurred.

Protocol and immutable artifacts

- Contract/development/schema frozen pre-source in e78b2840. Exact hashes are in
  seal-metadata.txt. Independent author read only those exact bytes, and sealed
  45 rows before source/results access. Payload SHA256
  1750cca0a98ee6a5f1cbc8ece0608201463923fc9f7044a4258f180bc4014a5b.
- Candidate frozen in 0d46d60b; candidate-source.sha256 manifest hash
  84cbd5721d7522802f342974cafac3fc1e529a3845f88b3ef4c53e043db52812.
  Verify those paths at that commit, not the restored checkout.
- Comparison reporter frozen in e376fda8 before reveal, SHA256
  60aecc28243ded35d7727987524ab6ccc15fc5804697c6a8b3edba00e1add110.
- A different independent author reviewed source and all 11 changed development
  sequences. source-review.md SHA256
  a95736cdf1e9f43aa67d287914a7c451b668e316c94681bfe38ae77a0a7c2f0f.
  Verdict REJECT before payload access. Exactly one subsequent reveal and one
  measurement per version; no source, oracle, metric, or harness tuning followed.
- fresh.json preserves exact sealed bytes. Frozen schema keys and useful query /
  target-family disjointness from development verified. References/variants are
  correlated, not additional independent tasks. Source-review diagnostics were
  85 executions/version, 78 unique strings; one exact useful hidden query (dog)
  also appeared in source review independently after sealing. No tuning followed
  that review, and those diagnostics are not pooled with blind usefulness counts.

Original failure and candidate

The English name/keyword catalog misses Spanish and mixed heart/cat/party
searches. Baseline coffee already works through cafe. The candidate imports only
1,914 Spanish CLDR 48 speech names into optional s fields, not full keywords:
+48,572 bytes (242,085 -> 290,657), retaining all original catalog fields/order.
A separate explicit-picker index supplements English matches, folds vowel accents
and case/canonical composition, preserves ñ, requires conjunctive tokens, and
keeps arbitrary punctuation literal. Contextual suggestions are untouched.
Generation from pinned official inputs reproduced byte-for-byte independently.

Core search has no language/context/history API: EN/ES/mixed below describe query
content, not actual keyboard mode-stack coverage. KeyboardController shares this
index across settings. Wrapper strips are also recorded; empty browsing and
recent/popular tie-breaking/tone preference remain intentionally unchanged.
No native rendering/glyph filtering, actual key entry, Gboard comparison, or
network/context privacy experiment was performed. Source establishes local,
context-free core search, not wrapper independence from recents.

Evidence and limits

Development: 27 rows; 15 useful, 12 controls; four semantic families. Useful <=8
and first3 both 8 -> 15. Seven gained rows span three families; all four families
already have useful English access at baseline. No unavailable accepted emoji,
useful regression, or lost accepted top8 alternative. Review inspected every
changed raw sequence, including controls, rather than relying on result counts.
Spanish corazón puts red heart at rank14; gato puts cat face at rank11; fiesta
finds only partying face. Qatar appends to English cat at rank18. None of those
extra results was silently credited as a frozen acceptable target.

Single sealed evaluation: 45 rows; 18 useful, 27 controls; six fresh semantic
families, three useful content strata of six rows each. Useful <=8 / first3:
EN 6 -> 6; ES 1 -> 6; mixed 1 -> 6; total 8 -> 18. Ten gained queries span five
families, with no useful regressions. Music already works in all three strata.
All six families already have useful English access at baseline: family-any-query
coverage remains 6/6. Accepted alternatives in top8 sum 30 -> 62 across correlated
query rows; unique accepted emoji across the whole useful set remain 23 -> 23.
Unavailable acceptable emoji/wholly unavailable useful rows: zero in both versions.
Full raw arrays and metrics: baseline-fresh.json / candidate-fresh.json; comparison:
fresh-summary.txt. All 21 changed fresh sequences were inspected, including
control changes. No changed useful fail-to-fail row exists. No first-rank or
accepted-top8 loss in useful rows was concealed.

The gains require full literal queries; they are not keystroke savings. Gained
Spanish queries have 5/5/5/9/11 NFC characters (perro/avión/limón/bicicleta/nube
lluvia), mixed counterparts 9/14/11/17/12, with first acceptable result at rank1.
These counts describe input text only. Actual accent/case key gestures, taps,
scroll cost and total mobile keystrokes are unavailable; no KSR claim is made.
Mixed queries are longer than existing English alternatives.

Rejection and unavailable control

Independent q 29 -> 31 and z 40 -> 46 sequences violate the frozen one-character
baseline-retention contract. They append Spanish matches, retaining original
first-screen results; rejection is a precommitted control failure, not proof of
semantic harm. Inherited token-order ranking also fails strict ordered invariance
(cat face vs face cat), disclosed as baseline behavior rather than new damage.

Fresh raw comparison flags four controls: inherited cloud rain vs rain cloud
ordering; ñ baseline48 -> candidate0 (tension between blanket short-query retention
and deliberate ñ-preservation); mu38 -> 48 (new supplemental matches violate that
row's frozen entire-baseline oracle); and caña/cana distinctness. The last is
UNAVAILABLE as a product measurement: the frozen harness uses a fixed ano/año
fixture for all distinct rows, so neither caña nor cana is indexed in that fixture
and both return []. I missed making the fixture generic before freezing. Raw
failure is preserved; it is not evidence of a product ñ failure, not reclassified
as a pass, and not repaired/re-run after reveal. Thus 23 controls pass, three
other frozen-control failures are observed, and one is unavailable. No tests or
known-issue allowances were expanded. Source-review q/z rejection is independent
of this harness limitation and the ñ contract interaction.

Costs: independent optimized construction ~25–26ms -> ~229–246ms; our reveal
run26ms -> 237ms. Two indices plus cached entry-word/literal sets add unquantified
memory. Controller constructs once in detached utility work; native startup cost
was not measured. +20.1% catalog bytes and this CPU cost prevent speed claims.
Bounded 12-posting terms/800-candidate fallback also limit retrieval completeness.

Verification

Candidate: 63 focused emoji tests passed; Python annotation4 passed. Documented
release `swift test -c release --no-parallel` passed:442 core tests/65 suites with
unchanged existing5 known issues, plus3 service tests. An earlier debug-default
full run was interrupted after unrelated suggestion/swipe timing failures; it
was not represented as passing. No test thresholds were changed.

Restored production: full documented release and Python results are recorded in
verification.txt. Net production diff against parent is empty; final checkout
must be clean. Candidate remains inactive in history, not as bundled assets or
build output. No product improvement is recommended from this round despite the
positive local relevance counts.
