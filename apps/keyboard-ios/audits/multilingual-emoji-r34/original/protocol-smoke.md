# R34 independent protocol engineering smoke

Completed against production baseline `e6871a164cfbc2eca4d0b3da700364a55e4e4dcb` using standalone `swiftc -O`, without Xcode, devices, network, candidate source, prior exposed rows, or blind data. This report establishes protocol execution and English baseline controls. It does not approve the domain contract, policy, production changes, localization, native behavior, or semantic utility. Domain v5 review belongs to the separate reviewer.

The implementations are `runner.swift`, `validate.py`, `smoke-runner.py`, and `compare.py` in this directory. The runner prints no payload; its ordered output is exactly `{id,values,baseValues,query}`. `search` and `fixture` echo raw input and report equal values/baseValues. `wrapper` reports the actual `EmojiSearchQuery` buffer and the pre-tone base values. Temporary isolated defaults are removed after each wrapper case. Fixtures decode independent JSON catalogs with version/category `fixture`, injecting optional `s` only for present glyphs. Aliases for absent glyphs have no effect. The baseline decoder ignores `s`.

`schema.json` and `api-map.md` were the field-grammar authorities. No normative document was modified. Fixtures require `entries`; `spanishAliases` may be omitted, and must be nonempty when supplied. Entry keyword/tone arrays, recents, forbidden arrays and maps may be empty. Strings inside those arrays/maps must satisfy the specified nonempty-string grammar. Useful cases require en/es/mixed stratum. Both implementations validate the complete suite before executing any row. Signed integer fields accept -1000000 through 1000000; maxRank accepts 1 through 60; version is integer 2. JSON booleans, floating forms and exponents cannot stand in for integers. Duplicate JSON keys, duplicate fixture bases/aliases (including absent aliases), unknown fields/actions, wrong-action parameters, missing fields, invalid family/id references, self references and reference cycles fail. Missing/malformed catalogs and missing inputs fail even for fixture-only inputs.

Executed baseline results:

- 147/147 ordered rows: 17 search, 15 wrapper, 115 fixture; zero useful rows.
- 136 explicit baseline assertions passed, covering English/empty expected arrays, exact-name target first positions, wrapper buffer echo, tones/base mapping and recent dedupe.
- Both validators rejected all 125 invalid-input controls. Three required resource/input failures returned unsuccessful execution without output.
- Every required top-level/case field, all four common optional fields on each action, every action-specific parameter, all fixture entry fields including optional tones, and both alias fields were covered by executable assertions. The complete field matrix is in `protocol-smoke-summary.json`.
- The baseline schema-oracle report honestly contains 82 passing controls and 65 failures expecting localized additions. Those 65 are expected baseline limitations, not localization passes. English-only execution plus known baseline expectations determine this smoke's success.
- 22 independent localized suffix invariant groups are prepared for a later candidate: arbitrary n/ñ, uppercase/NFD and vowel forms; punctuation/apostrophes/digits; repeated/reordered tokens; caps 1/48/60 with 86 entries; and conservative reservation controls containing Mn/Mc/Me/new Unicode. English ASCII/consonant-diacritic compatibility, default/ceiling limits, nonpositive limits, 80-character direct bounds, absent aliases, recents, tones and dedupe were executed. New Unicode uses U+1E4D0; the mark controls use U+034F, U+093E and U+20DD.
- 18 invariant groups actually have two distinct baseline English arrays. No whole-array equality is fabricated for them. Candidate mode requires the exact legacy prefix and compares only the appended localized suffix at fixed preferences/limits. Explicit independent fixture suffix oracles also check capacity reservations. These controls contribute no semantic utility.
- The baseline runner supplied as a candidate was rejected at `spanish-n`; no stale success summary survived. This confirms that baseline-only success cannot satisfy localized candidate gates.
- `--suite` executed an additional arbitrary exposed fixture-only suite, with ordered row and output validation. Any valid exposed suite can be supplied; oracle failures remain in its report.

Comparator self-checks verified explicit per-target ranks/maxRank, forbidden and empty constraints, equality of both ordered values and baseValues (including a baseValues-only mismatch), unique accepted alternatives and separate useful-family accounting, changed arrays for fail-to-fail rows, and malformed/missing/duplicate/reordered/unknown-field outputs. Its report retains every suite row, raw arrays and unavailable cases. Readable rows retain observed ranks/hits even if the whole output is invalid. Global execution errors prevent certification. Missing output CLI verification reported all 147 unavailable rows and exited 1. Oracle failures are report data; invalid/missing execution makes the comparison CLI unsuccessful. Family utility uses only passing useful rows and explicit author alternatives, never array changes or controls. Actual target meaning remains the independent author's responsibility.

All exposed input artifacts for opaque exclusion are under `/tmp/r34-protocol-engineering/smoke/` (the same path resolves as `/private/tmp/...` on this host):

- `protocol-exposed-smoke.json` — all 147 generated cases and independent fixture/alias inputs.
- `protocol-exposed-oracles.json` — baseline expectations, chosen candidate suffix oracles and invariant group membership.
- `protocol-exposed-negative-archive.json` — all structured invalid suite mutations, retained recursively.
- `protocol-exposed-fixture-only.json` — required-resource and arbitrary-suite control input.
- `comparator-selfcheck-suite.json` and `comparator-selfcheck-wrapper-suite.json` — comparator protocol fixtures.

`protocol-exposed-invalid.json` is the transient lexical-negative input, not a valid suite. The negative archive includes every structured mutation rather than only the last one. The separate `/tmp/r34-protocol-engineering/candidate-negative/` run regenerates exactly the same exposed controls; it adds no new query/target oracles. It intentionally fails the candidate localization check. Exclude the input artifacts above, not bulky output arrays, from future independent authorship.

The full baseline output and oracle report are `/tmp/r34-protocol-engineering/smoke/baseline-output.json` and `baseline-oracle-report.json`; raw comparator reports and CLI verification artifacts remain under the same temporary root. The compact repository record is `protocol-smoke-summary.json` (including provenance, exact input hashes, all-field matrix, rejection names and CLI results). No executables, logs, generated 1.4 MB input suite, or bulky result reports were put in the repository. Concurrent audit files were preserved. Git object checks confirmed both production Swift files and the resource still matched baseline when this report was recorded.

Rebuild the baseline only in the temporary root from the frozen commit:

```sh
AUDIT=/tmp/pulpo-r34-e6871a16/apps/keyboard-ios/audits/multilingual-emoji-r34
WORK=/tmp/r34-protocol-engineering
cd /tmp/pulpo-r34-e6871a16
git show e6871a16:apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardCore/Emoji/EmojiCatalog.swift > "$WORK/EmojiCatalog.swift"
git show e6871a16:apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardCore/Emoji/EmojiSearch.swift > "$WORK/EmojiSearch.swift"
git show e6871a16:apps/keyboard-ios/LanguageData/emoji.json > "$WORK/emoji.json"
cd "$WORK"
swiftc -O EmojiCatalog.swift EmojiSearch.swift "$AUDIT/runner.swift" -o baseline-runner
PYTHONDONTWRITEBYTECODE=1 python3 "$AUDIT/smoke-runner.py" "$WORK/baseline-runner" "$WORK/emoji.json" "$WORK/smoke"
```

Direct protocol and comparison CLIs (all execution output outside the repository):

```sh
PYTHONDONTWRITEBYTECODE=1 python3 "$AUDIT/validate.py" "$WORK/smoke/protocol-exposed-smoke.json"
"$WORK/baseline-runner" "$WORK/emoji.json" "$WORK/smoke/protocol-exposed-smoke.json" "$WORK/baseline-output.json"
PYTHONDONTWRITEBYTECODE=1 python3 "$AUDIT/compare.py" SUITE BASELINEOUTPUT CANDIDATEOUTPUT "$WORK/comparison.json"
PYTHONDONTWRITEBYTECODE=1 python3 "$AUDIT/smoke-runner.py" "$WORK/baseline-runner" "$WORK/emoji.json" "$WORK/arbitrary" --suite ARBITRARY_EXPOSED_SUITE
```

For a later candidate, compile its two corresponding production files plus this unchanged runner with `swiftc -O` into `/tmp/r34-protocol-engineering/candidate-runner`, then run:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 "$AUDIT/smoke-runner.py" "$WORK/baseline-runner" CATALOG "$WORK/candidate-smoke" --candidate-runner "$WORK/candidate-runner"
```

Use the same supplied `CATALOG` for both runners; baseline ignores optional `s`, while the independent injected fixture aliases exercise candidate localization regardless of that resource. `--suite` may also be included in candidate mode for arbitrary additional exposed input, whose complete oracle comparison is reported. This smoke does not replace the separate resource, source, compatibility, native, performance or admission work.

SHA-256 recorded after execution:

```text
schema.json       3d764e105588c0f8da40f82313b6b3885e1a05cbad175fae9915deba1e74397a
api-map.md        0f8fa0472cb429e6019656a99755bc5f91f24e280d34915312c2ffca0960cfa9
runner.swift      8e261e7f67e2f2024a27a74e37941de1a8a432b3eb7562743bdbd22a9f1e672c
validate.py       1e925b4e18b9803bb55be8c871aa4be81e443fe8f5482ee3b3554f81aa2e3418
compare.py        7a7283ff9992b97438579306df6f729a8ce7bd08723673ff82c188c732f64b87
smoke-runner.py   25e05b5c2828e3a89fffd02f86a7c0d91e6bed0f65ab4038282a47cf3b973ad2
baseline-runner   d117eb7fba14848948669939b6ffa41b12ff5db027aa47e13cd634628ea7b38c
baseline catalog  2085015d3bd75b7046aecd244b1961230b37fd25ac8aca475c7bc4afabba8117
```

Compiler/runtime: Apple Swift 6.4 (`swiftlang-6.4.0.34.1`), target arm64-apple-macosx27.0.0; macOS 27.0.1, build 26A434. Exact baseline source hashes are retained in the compact JSON. No commit, push, merge, physical deployment, parent checkout edit or domain certification was performed by this protocol task.
