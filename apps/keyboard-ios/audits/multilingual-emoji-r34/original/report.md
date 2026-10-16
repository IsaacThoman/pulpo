# R34 rejected before blind reveal; production restored exactly

Candidate `96a28b98e154077da10f5dbe1f7e968020b2f9fb` is archived, not accepted.
Restoration `35a18150323ec03ebe41c6bcea0d1b2eeea9385f` restores every production,
normal test, resource, and builder byte to `e6871a164cfbc2eca4d0b3da700364a55e4e4dcb`.
Final changes are confined to this audit directory. Work took place in the additional
isolated checkout `/tmp/pulpo-r34-e6871a16`, branch `codex/r34-emoji-search`; the supplied
parent checkout was not edited. PR782 is linked to the R34 delegated thread.
No push, merge, physical deployment, or blind reveal occurred.

## Decisive result

Independent review **approves source conformance to frozen v5 but rejects admission**.
The required frozen candidate smoke executed all147 controls:144 pass,3 fail,0 unavailable.
The three failures are retained fail-to-fail rows, not relabeled passes or removed.

Its one-entry fixture has English name `copper lantern`, keyword `beacon`, and Spanish
alias `ñavoru`. For `ñ`, `Ñ`, and NFD `ñ`, the coarse reservation token is `n`.
It occurs inside the English vocabulary, so v5 places the entry in the English envelope
and excludes it from localized additions even with spare slots. Both baseline and
candidate return[]. The frozen oracles require that entry. Their required presence
conflicts with the approved conservative exclusion policy; this is a protocol/policy
incompatibility, **not a demonstrated source violation of v5**. Non-ASCII single letters
may add matches under v5; this fixture cannot. The unsuccessful gate remains unsuccessful.
No policy, oracle, fixture, feature, or acceptance threshold was retuned to salvage it.

Exact inputs, outputs and adjudication are in `source-counterexample.json` and
`source-review.md`. All147 raw rows and their oracle report remain in
`/tmp/pulpo-r34-candidate-smoke/`; `candidate-smoke-summary.json` binds the full report.
This rejection does not establish a blind semantic loss or an overall Gboard comparison.

## Frozen policy and candidate

Before production edits, independent domain review approved contractSHA256
`bebb6034c35bfb576e39f033013ac560a24d15f5128fc2490199b08cb66d5d01` after3432 capacity
rows and180 Unicode fixtures. Preproduction all-action execution smoke passed147rows,
136 baseline assertions,125 invalid inputs, every declared action/optional field,
and explicit failure on absent/malformed required resources. These certify protocol
execution, not candidate localization or utility. The later candidate gate is separate.

Four earlier proposed contracts were rejected before implementation: apostrophe joining;
vowel-mark deletion versus retained Mc; Swift/Foundation Unicode-version differences;
and Foundation's letter set including marks. Exact bytes, executable witnesses and
independent decisions are preserved in the earlier commits/reviews. V5 uses the intersection
of Foundation letters and Swift base-letter categories with explicit Mn/Mc/Me handling.
Previous R27/R31 rejections remain unchanged. No old candidate implementation was imported.

The concrete candidate adds optional Spanish CLDR48 speech names, preserving every old
English catalog field/order and the original English/contextual search bodies. Spanish
and mixed matching requires conjunctive word prefixes with ñ preserved, vowel accents
folded, and sorted unique tokens before ranking/caps. Localized ranking and a fixed
conservative English reservation are independent of token order/repetition; the English
subsequence stays its exact prefix. This reservation can suppress a valid alias even
when actual legacy output is empty, as the decisive fixture illustrates. No query cache,
learning path, word-specific exception, or disabled existing feature was introduced.

Resource growth is242085→286829bytes (+44744), with1914 Spanish names among1923 unique
base entries;9 Unicode18 entries lack CLDR48 names. Main verified the two pinned XML
hashes and independently regenerated the resource, SHA256
`d201157dd725d8e8af6ef91ed56aee867bf52dc0d3cb314e649a8614b3876edd`. Stripping only `s`
reproduced the baseline serialized bytes. Revision, exact XML hashes, attribution and
import behavior are archived in the candidate README/builder at96a28b98.

`candidate-source.sha256` binds15 archived source/runner/comparison/plan paths and was
verified against96a28b98 after restoration. ManifestSHA256
`e6690f18a99b95ce7f9a9185296ad27f1e5deb83cd8e0b1ceabee32dcbcf7486`.
`candidate-source.patch` preserves the source/test/doc changes; the full resource is
available at the candidate commit instead of duplicated as a large JSON patch.
There was no successful final admission freeze or subsequent blind reveal.

## Compatibility and ordinary verification

Candidate:445core tests/66suites with unchanged5 known issues, plus3service tests; Python5pass.
Restored:441core tests/65suites with unchanged5 known issues, plus3service tests; Python3pass.
No reset to the older439-test baseline. The four candidate Swift tests and two Python
additions are removed normally during restoration, not disabled.

All7374 exposed query strings preserve baseline search arrays as exact prefixes,
contextual default/exact-only arrays, single-ASCII results, caps and deduplication.
Independent review rebuilt both immutable snapshots and reproduced both entire outputs,
then passed282 further fixture controls including caps1/48/60, orthography, ordering,
Unicode and preference maps. All552 changed raw pairs are retained at
`/tmp/pulpo-r34-perf/compat-all-changed-rows.json`, SHA256
`28a92c94350cafa096ff85f34fafd8115387fe65390174bfe5279a3a02d7fa69`.
The2143 added occurrences/1075 glyphs are mechanical counts with no semantic oracles:
**no useful-alternative, accepted-target, family-success or fail-to-fail utility labels**
are invented. Full arrays include every changed row; no favorable subset was selected.

## Actual native validation

Device list/open returned raw `Device list failed: The device command failed (exit code 127).`
The platform was reported available. Fallback used serialized XCTest/CoreSimulator on ONLY
assigned iPhone18Pro `7E1D7979-7307-4C53-8466-BB41154B383C`, iOS27.0, Debug,
`-parallel-testing-enabled NO -collect-test-diagnostics never`. Successful build/test
logs were not read; structured xcresult summaries provide results.

Baseline picker/layout checks passed5/5. Candidate functional checks passed3/3 at actual
system content_size Small and3/3 at Large,0failures/0skips. Real XCUI letter/result taps
exercise `vicuna`, `teclado`, and `keyboard teclado` under each actual configured language:
English, Español, English+Español. There are9 search/pick flows and3 cancel/letter-ownership
checks per size. Existing field-kind switching verifies focus returns to that field's keys.

A separate hosted production UITextView/PreviewHost/KeyboardController test covers18
language/trait configurations per size (regular/password/username/oneTimeCode/email/URL).
A selected combining-accent+skin-tone/ZWJ string and surrounding Unicode stay unchanged
while query keys are activated; the rendered result control then replaces selection,
retaining suffix and caret. This is hosted private-trait/document evidence, not an
installed password-keyboard or XCUI selection-drag claim. Executed source hashes matched
the frozen `.swift.txt` plans. Temporary opt-in native files were removed afterward.
`native-interaction-summary.json` retains all structured summaries and scope limits.
No physical-device, VoiceOver, Gboard speed, keystroke, or latency claim is made.

## Blind custody and costs

The independent author received ONLY the exact immutable normative packet, public API/schema,
and opaque static/exclusion commands, after the complete preproduction smoke. It saw no
source/resources/results/exposed rows. Recursive input exclusions include strings inside
arrays and dictionaries, prior exposed families/queries/target oracles, all7374 exposed
compatibility queries, references/fixtures and a machine-only collision check against the
untouched R31 seal. The old payload was never displayed or behaviorally run.

Fresh R34 seal `/tmp/pulpo-r34-sealed-v1.json`, mode0444, SHA256
`a00397e33f570f0aa79975b21ae906bdb7fd2a327011e03affca4b753391ee35`, contains110rows:
36 useful (12EN/12ES/12mixed),74controls,12 independent useful families. Static/exclusion
checks pass with0collisions against17 protected input digests; all schema parameters/actions
are represented. Only metadata was read by main. Author oracle caveats and disjointness-
limited control encodings remain recorded in the metadata/private notes, without revealing
semantic content. No missing boundary control is converted into a blind success; the
exposed complete protocol controls remain separately reported.

**All110rows remain UNRUN and unavailable in the denominator.** Useful successes,
accepted alternatives, unique useful glyphs and12-family utility are unavailable, not zero
and not passing. R31's46 rows also remain unopened/UNRUN; its original SHA256
`a7067871f9f61e2b8d4d6378c259e8fbd7c9e1ac5fcbaa4db5a50c5b4ac891de` is unchanged.
Both seals were verified by machine-only digest at closure. No blind policy retuning occurred.

Costs remain frozen: construction median ANDp95<=2x matching baseline AND<=60ms;
queryp95<=max(2xbaseline,baseline+.25ms) AND<=2ms; max<=10ms;
retained extra<=2MiB/index; singletonpeakextra<=4MiB; resource<=128KiB.
Only resource delta was measured/passes. Construction/query/memory and repeated native
cold-init/first-search comparisons are **UNAVAILABLE/UNRUN** because admission failed
before proceeding. No quiet-host window was requested or batch salvaged; the earlier
R31 contention problem is not relabeled resolved. Timing harnesses/plans are inactive
and confer no evidence. No macOS check or XCTest duration is called iOS latency.

## Release

Baseline app was reinstalled on18Pro; installed embedded emoji resource hashes exactly
`2085015d3bd75b7046aecd244b1961230b37fd25ac8aca475c7bc4afabba8117`.
Hardware keyboard restored true; system content size verified Large. `device_close`
succeeded with shutdown:false. Device remains booted/released. Production diff outside
this audit is empty; `closure.json` retains restoration, hashes, denominators and limits.
Orchestration task IDs and inherited provider/model are retained in `orchestration.json`.
