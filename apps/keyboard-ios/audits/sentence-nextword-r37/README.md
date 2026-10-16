# R37: rejected sentence-local bilingual next-word candidates

Both implemented candidates are rejected for absent development utility.
Production code, compiler and all resource bytes are restored to baseline
`975c5f838db2c511a099136fda28d908b71dda6d`. This commit contains evidence only.
There is no active feature, no accuracy improvement claim, and no final fresh
benchmark result. PR: https://github.com/IsaacThoman/pulpo/pull/782.

## Decisions and observed results

V1 preserves compact source membership and component bigram rows for shared BI
histories. Without an exact trigram, an exclusive earlier token supplies a
prediction-only source hint. V2 adds general preceding→previous pair provenance
and an earlier-token unigram-ratio fallback of at least 8:1 for shared spellings.
Both use the frozen 0.75 component adjustment, retain both vocabularies, and
leave global scoring/correction/completion/glide and exact trigrams unchanged.
Contracts and independent domain reviews precede the corresponding experiments.

The exposed, pre-output fallback pilot has 16 prompts, each run in three modes.
BI top3 acceptable-set hits were 10/16 for baseline, V1 and V2: zero gains and
zero losses. V1 activated on four prompts and changed three bars. V2 activated
on five and changed four. Two V2 changed outputs remained acceptable-set misses;
their complete paired rows and exact acceptance traces are retained. Grammatical
looking changes are not counted as an accuracy gain. Targets were not broadened.

A separate source-independent author supplied 18 development intent families,
six English, six Spanish and six genuine code-switch, with two contrast prompts
each. The author saw no source, dictionary/model, output, old audit or target
payload. The original dataset and attested timestamp/hash remain intact. This
was explicitly DEVELOPMENT and was never the final fresh workload. Every one
of its 36 prompts executed in all three modes: 108 rows/version. Results:

- EN mode: 8/36 acceptable-set hits for each version.
- ES mode: 4/36 for each version.
- BI mode: 12/36 for each version, zero gains/losses and zero activations.
- All observable outputs unchanged; 25/36 BI prompts bypassed the feature for
  exact trigrams, and the other 11 lacked an eligible shared history.

The same three-mode full denominators remain in the raw data. Cross-mode rows
are diagnostic uses of the same authored legitimate continuation set; they do
not multiply independent families or humans. These narrow synthetic sets are
lower-bound intent coverage, not population accuracy, exhaustive correctness,
or a Gboard comparison. No target-set hit was gained in either development
cohort. A source-conditioned shared-history backoff was too narrow for this
independent natural-context sample. Additional activation is not useful evidence.

## Actual execution and safety evidence

The final strict Release executor ran both development cohorts again: 108 and
48 rows/version, with zero executor failures. Every primary row independently
accepted all three exact engine-returned Suggestion objects in separate fresh
real LanguageStacks/engines. Raw records contain all slot metadata/generations,
resource SHA/model identities, full document/Character caret/selection, policy,
personal counts, and all actual insert/delete primitives. Complete range/text/
destination replay and mechanical acceptance oracles passed. Comparisons retain
all rows, all gains/losses, secondary rank changes, and every changed failed row.
Their nonzero comparison exit is EXPECTED: the utility/final-fresh gates fail.

Release smoke separately passed 39 mode rows, 141 actions, all 11 supported
actions, Unicode grapheme/range/selection fixtures, staged/prefilled equivalence,
private/URL/numeric/predictions controls and captured stale/silent-host changes.
Static validation reports 15 rejection checks and eight synthetic comparison
checks. This is bounded core fixture evidence, not native-controller admission
or the complete ordinary core/services suite. Existing ordinary/fuzzer tests and
their five known allowances were never changed or reclassified.

The semantic baseline uses the identical executor/core build with ORIGINAL
resource files. With all optional source sections absent, the hint is nil and
the original scoring/candidate path is exact. The original global
logProbability method is byte-identical, as are Engine, Suggester, SpellCorrector,
LanguageStack and GlideDecoder. This is not a separately compiled original-code
timing baseline; no paired performance conclusion is drawn. The earlier small
pilot predates added header validation and lacks the strict executor's complete
traces. Its outputs are preserved as development evidence, never fresh admission.

## Data, resource bounds and unspent gates

Only existing pinned English/Spanish binaries feed either compiler. Existing
Apache/CC BY provenance and attribution remain applicable; no corpus was added.
All original non-META bilingual section payloads and complete EN/ES bytes were
conserved. Source/data hashes and section counts are recorded in
`data-development.json`, `v2-source-conservation.json`, and
`rejected-source-data.json`. The exact patches include the candidate binary delta
and the pinned-binary reproduction wrapper.

V1 adds 475,080 BI asset bytes; V2 adds 835,392, both below 1 MiB. V2's sparse
mapped payload is 834,932 bytes: membership, 605 shared histories, 14,835 source
successors and 360,196 pair masks. Asset size alone is not complete storage or
RSS admission. Post-warm RSS, 30 switches/old-stack release, paired 30-repetition
warm/cold costs and p50/p95/p99 gates were NOT run. One-shot elapsed values in
raw traces are not that benchmark and are not native latency/memory guarantees.

Neither feature earned useful development admission. The final source-independent
36-family/72-prompt/216-row workload was NEVER authored, sealed or executed.
There was no final blind reveal, source-independent final runner/code review,
full core/services admission or native bar/language/private/acceptance smoke.
No device was assigned, opened or driven. No push, merge, deployment, parent
checkout edit or protected path operation was performed. No thresholds, score
coefficient, targets, ordinary oracles or resource gates were weakened to pass.

## Artifacts and restoration

- Discovery originals/receipts, both preimplementation contracts and domain
  reviews remain beside this report.
- `v1-rejected-development.patch.gz` and `v2-rejected-development.patch.gz`
  apply independently to the baseline; both were checked with `git apply --check`.
  They are INACTIVE alternatives, not a stack to apply together.
- `strict-{independent,fallback}-{baseline,candidate,comparison}.json.gz` hold
  final actual-engine raw outputs and full comparisons. `strict-smoke-candidate`
  holds actual smoke output. Earlier pilot files remain explicitly development.
- `executor-archive/*.swift.txt` contains exact executed test code, matching raw
  artifact hashes. The three temporary R37 test files were removed from active
  test discovery as part of explicit rejection archival. No failing production
  test was hidden/disabled; all recorded R37 engine execution passed mechanically.
- `public-contract.md`, schema/API map, validators and comparison are archived
  DEVELOPMENT tooling. They were not promoted to a finally reviewed fresh seal.

Production was restored by reversing the exact R37-only V2 patch; the removed
temporary executor source was first copied byte-for-byte into the archive.
No unrelated source file was restored. `restoration.json` records the resulting
source/resource equality checks. `verify_rejection.py` verifies the retained
raw outcomes, hashes, negative gates and baseline restoration. The restored
multilingual resource/reproducibility test suite is checked separately.
