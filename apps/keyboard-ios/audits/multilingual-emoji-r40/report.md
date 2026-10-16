# R40 rejected before fresh authoring; production restored

Candidate 8369f266cb9ad58e9ca9b76a9f50dd0cfca3c7b0 is inactive, not accepted.
Restoration 52bf72e4 restores all six owned production/test/resource/builder files
exactly to baseline 00e2a0e7a283bc4a780b02f847ea9d82dfe9e5ae. The final net
change is confined to this audit. No push, merge, physical deployment, native
device action, quiet window, fresh blind author, or blind reveal occurred.

## Independent source rejection

Independent review rejects both SOURCE and ADMISSION. The candidate's ASCII fast
path differs from the exact required Foundation locale-aware lowercase operation
on the review host. For raw A\u0000B, Foundation returns only a before tokenization;
the candidate byte loop also processes b. With one entry (English opaque, Spanish
a b) at cap1, normative T=[a] requires the ASCII-single-letter baseline output [],
but the immutable candidate returns [L]. The direct API/schema admits this input.
This is an actual source nonconformance independent of the frozen oracle errors.

The reviewer executed 71,805 tokenizer comparisons and found 307 mismatches, all
containing NUL. Public independent controls passed 1,131/1,134; all three failures
reproduce this defect across preference maps, plus a separate minimal cap1 case.
This Foundation behavior was observed on macOS 27.0.1 / Swift 6.4; no iOS behavior
is inferred. source-review.md records the final verdict, exact counterexample,
independent reference and retained raw hashes. Compact results and inactive
reproduction sources are in independent-source-review. No fix was attempted after
candidate evaluation, and the rejected source bytes remain unchanged.

## Decisive mandatory smoke failure

The actual frozen candidate executed all 569 generated required controls:
566 pass, 3 fail, 0 unavailable. All 119 localized invariant groups pass.
All seven additional arbitrary-suite controls pass. Full raw observations,
including every failed row, remain under /tmp/pulpo-r40-candidate/smoke.
candidate-smoke-summary.json and candidate-failed-controls.json bind the results.

The three failures are r40-ranking-0, r40-ranking-1 and r40-ranking-2. Their
queries are mavela romulo, romulo mavela and ROMULO MAVELA ROMULO. Their frozen
exact-suffix oracle requires IDs 002,003,000,001,004; the candidate returns
002,003,000,001. ID004 has alias mavelar romular: romular does not begin romulo.
The four returned entries have the expected relative order. The implementer
missed this fixture error before freezing the controls. Independent source review
confirms that the four eligible results conform to v7 and the fifth expectation
is incompatible. The mandatory failure remains recorded without an oracle edit.

No oracle, query, alias, ranking, source or acceptance threshold was retuned.
The required gate remains unsuccessful. Its exact-suffix failure is separate from
the looser acceptable-any-target comparator: those three rows pass that comparator
after failing in baseline, but remain fail-to-fail under their mandatory full
suffix assertions. Both raw reports are retained. No schema pass or useful
development result cancels a required failed assertion.

## Preproduction proof and complete protocol execution

Six earlier proposed policies were rejected or superseded before source authoring.
Their exact reviewed snapshots, independent reports, minimal executable witnesses
and hashes are preserved in preproduction-rejections. Earlier failed denominators
remain failures. In particular, the old coarse substring policy was not proved by
R34's passing resource sample.

The new v7 source-domain policy received independent approval BEFORE production
edits. Exact normative hashes are in normative-freeze.json and domain-v7-verdict.json:
contract b2d87ff12173e5d43288becaa84dbdabf997373b94fedd8982228ff547351324;
API map 273a68136943c8fd4635e23c3d97d9634c8bb6353abb4ffc5bb38c21233819ca;
schema 3d764e105588c0f8da40f82313b6b3885e1a05cbad175fae9915deba1e74397a.

The approved canonical identity is explicitly the TRIPLE (T,W,X): Spanish
orthographic tokens, unchanged legacy-normalized whole words, and actual
exact-folded-name whole words. It does not claim the rejected same-T-only
equivalence. Ordinary variants preserving this triple share localized membership
and order; arbitrary raw mark/punctuation changes can change the identity.

Reservation uses actual retained English posting keys plus a necessary
conjunctive word check, and exact-name word sets derived directly from the
folded exact keys. It uses no coarse substring projection, scalar exception,
generic whole-catalog fallback, disabled aliases or query cache. The independent
proof follows all three actual legacy result-entry paths. It avoids assuming
Foundation folding, scalar classification and Character whitespace splitting
commute. The literal prefix/splitting proof and its limits are in
domain-v7-report.md.

Domain evidence: 135,195 raw rows, 406,901 assertions, zero failures. All 7,374
exposed queries were paired as baseline controls at three caps and three preference
maps (66,366 rows). Sequence challenges exercised 682,452 concrete prefix trials
and 145,488 canonical equality/splitting checks, with zero failures; another 51
saturation rows and 342 baseline public-API controls passed. These are domain
controls, not executed candidate outputs or semantic utility families.

Before source authoring, the final v7 protocol executed 569 generated plus seven
arbitrary baseline rows; 131 invalid inputs and three missing/malformed resources
were rejected. Every declared action/parameter was covered. All 569 generated and
seven arbitrary isolated evaluator corruptions were rejected. Baseline-as-candidate
correctly rejected all three inherited ñ assertions and the other unavailable
future localization assertions. That rejection-path test is not candidate admission.
The exact protocol files and input hashes were frozen before source. Its completed
report export arrived later; the execution summaries and matching file hashes had
already been inspected and bound in preproduction-admission.json before edits.

## Concrete candidate and verification

The candidate was implemented from the unchanged parent English code, rather than
importing an old candidate implementation. It added optional Spanish speech names,
immutable localized postings and documents, an ASCII tokenizer fast path subsequently
rejected for its NUL behavior, canonical localized ranking and the proved capacity
reservation. The original English search body, contextual suggestions, normalizer,
word lookup, posting collector, value lookup and accepted R36 query/wrapper bytes
are conserved; english-body-conservation.json records those checks.

The pinned CLDR48 base and derived Spanish XML inputs were downloaded afresh and
both source hashes verified. The new builder joined only speech names for existing
sequences and verified the pinned pair for rebuilds. The resource added 1,914 names;
nine newer bases have no CLDR48 speech name. Stripping only s and serializing with
the established format reproduces all 242,085 baseline bytes exactly. The resource
grew by 44,744 bytes to 286,829, SHA256
d201157dd725d8e8af6ef91ed56aee867bf52dc0d3cb314e649a8614b3876edd.
Only the verified names/provenance are shared with R34; its source was not imported.

Candidate ordinary Release verification passed 449 core tests in 66 suites with
the same five known issues, plus three service tests. Python emoji tests passed
5/5. Seven focused normal Swift tests and two Python tests covered actual useful
Spanish/mixed intents, generic internal-only capacity, orthography, contextual and
ASCII isolation, English saturation, predecessor exact-name failures and chosen
tone/history behavior. They were removed normally in restoration, not disabled.

All 7,374 actual paired baseline/candidate development queries preserved English
ordered prefixes, contextual default and exact-only arrays, caps and deduplication.
There are 747 changed raw arrays and 3,825 added occurrences. These mechanical
counts have NO semantic utility labels. Every changed row and failure is retained:
/tmp/pulpo-r40-candidate/compat-all-changed-rows.json and compat-all-failures.json.
compatibility-summary.json binds all raw arrays, not a favorable subset.

A separate semantic development suite was frozen BEFORE candidate source:
36 useful rows across 12 intent families (12 English, 12 Spanish, 12 genuine mixed)
and eight negative controls. Baseline passed 12/36 useful rows and 8/8 negatives;
candidate passed 36/36 and 8/8, with zero regressions. It accepted the same 12
target glyphs through 24 additional Spanish/mixed intents. This is exposed,
correlated development evidence, not a blind generalization result or 36 families.
development-intents-summary.json binds every family and raw result.

The initial Debug baseline run had 442 core tests with five known issues plus
four timing failures under concurrent host work. It remains a failed Debug run.
The ordinary Release baseline passed 442 core tests/65 suites with the same five
known issues plus three services. No Debug timing failure was relabeled as an
accepted cost measurement. Candidate and restored ordinary checks used Release.

Independent actual implementation review paired all 7,374 queries at caps1/48/60
and three preference maps: 66,366 rows, zero English-prefix/contextual/exact/cap/
dedupe failures. Its 4,707 changed arrays and 24,948 added occurrences across nine
configurations are mechanical only. All English index keys/postings and exact
winner maps match baseline. Independent metadata checks cover all 1,923 entries,
7,287 keys, 12,712 postings and 1,910 exact folded-name word-set keys. All 212
same-triple/preference suffix groups pass. These passing safety controls do not
erase the 3/1,134 public source failures or the 3/569 mandatory smoke failures.

## Restoration, inactive bytes and unavailable later gates

verify-inactive-candidate.py verifies all six archived source files and the
inactive patch; with --check-baseline it verifies every restored before-image and
git apply --check without applying the patch. candidate-source-manifest.json binds
the exact candidate bytes. The text patch excludes the separately gzipped resource.
The complete frozen files are preserved as inactive .txt/gzip artifacts under
candidate-source. They are never normal compiled sources or active tests.

After restoration, Release passed 442 core tests/65 suites with the unchanged five
known issues, plus three services; Python passed 3/3. All production/resource/test
and builder bytes match 00e2a0e7. The accepted R36 buffer/wrapper remains SHA256
b31bb9dfd4f0eaca8e7c71e5d5779d43a2e60649067b9a78ac6b0b12bc5b7d47.
The restored emoji resource is SHA256
2085015d3bd75b7046aecd244b1961230b37fd25ac8aca475c7bc4afabba8117.

No fresh R40 author or oracle validator was delegated because development
admission failed. Fresh blind utility, alternatives/family success and all-row
paired blind results are UNAVAILABLE, not zero or passing. Opaque exclusions for
a future new seal were not certified as completed. Both old R31/R34 sealed
payloads remain undisplayed and behaviorally UNRUN, with their original digests:
R31 a7067871f9f61e2b8d4d6378c259e8fbd7c9e1ac5fcbaa4db5a50c5b4ac891de
(46 rows); R34 a00397e33f570f0aa79975b21ae906bdb7fd2a327011e03affca4b753391ee35
(110 rows, 36 useful/74 controls/12 families). Historical denominator and rejection
claims are not replaced by the new exposed development gains.

No quiet window was requested. Construction median/p95, query p95/max,
retained/peak memory, native cold-index/first-search, real language search/pick,
cancel, selected-Unicode and trait/size checks are UNAVAILABLE/UNRUN. Only resource
delta was measured and meets the unchanged 128KiB addition budget. All other cost
gates remain unchanged and unmeasured. There is no native latency, installed app,
physical-device, VoiceOver, keystroke or overall Gboard superiority claim.

## Final archive verification

The inactive six-file source archive, every restored before-image and patch
applicability check pass. All frozen normative hashes, independent reviewer
original evidence hashes and copied review artifact hashes pass. audit-files.sha256
binds every committed audit artifact except itself; verify from this directory
with shasum -a 256 -c audit-files.sha256. Historical freeze receipts are preserved
as snapshots, including their then-pending labels; final states are in closure.json
and orchestration.json.

The complete staged git diff --check reports 11 space-only unified-patch context
lines and one final blank line in the frozen protocol_final_controls.py. These
are preserved exact archive bytes. The same check excluding only those two
artifacts passes. No production file is part of the final net diff. The final
audit-only commit can be cherry-picked directly onto the parent baseline; the
rejected candidate and restoration commits should not be cherry-picked.
