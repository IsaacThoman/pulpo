# Multilingual acceptance benchmark

Frozen before inspecting implementation or shared audit findings, 2026-10-15.

## Independent cases and acceptance criteria

This benchmark measures usable language modes rather than translation. All cases
must run locally without sending typed content to a service. English is the
compatibility baseline; Spanish and bilingual modes are explicit user choices.

1. **Mode persistence:** English, Español, and English + Español can be selected
   in settings; the extension reads the same persistent selection. Missing or
   invalid persisted values fall back to English. A mode change updates active
   dictionaries and the visible language indicator without reinstalling.
2. **English compatibility:** `hello`, `world`, `keyboard`, `thanks`, `tomorrow`
   remain recognized; `teh` → `the` and `hellp` → `hello` are correction candidates.
   Prefix `hel` offers `hello`. Existing English tests continue to pass.
3. **Spanish vocabulary breadth:** `hola`, `gracias`, `mañana`, `niño`, `corazón`,
   `familia`, `trabajo`, `comida`, `quiero`, `estamos` are recognized. A licensed,
   pinned, reproducible Spanish dictionary contains at least 10,000 entries;
   document source, license, transformations, and an integrity check.
4. **Spanish correction/completion:** `hols` offers `hola`, `graciss` offers
   `gracias`, `corazon` offers `corazón`, and prefix `maña` offers `mañana`.
   Preserve correctly spelled accented words and distinguish `ano` from `año`;
   accent-insensitive matching must not erase correct literal words.
5. **Bilingual switching within a sentence:** `hello familia`, `gracias friend`,
   and `mañana meeting` retain both languages' valid words. Prefix suggestions
   can find `hello` and `hola` without toggling modes. No claim of grammatical
   code-switching inference is required.
6. **Swipe:** where a swipe decoder exists, representative paths for `hello`,
   `hola`, `gracias`, and `mañana` yield the target in the first five candidates
   in the relevant mode. Accented letters use their base-key geometry while
   retaining the dictionary spelling. Measure unsupported paths explicitly.
7. **Prediction:** Spanish and bilingual modes offer Spanish next-word choices
   (e.g. after `muchas`, `gracias` appears); English predictions remain available
   in bilingual mode. Report any missing contextual model honestly.
8. **Language UX:** a user can discover/change the language in both host settings
   and keyboard context. Spanish letters/diacritics are enterable; settings copy
   describes scope accurately and does not imply translation or cloud processing.
9. **Personal learning/privacy:** language changes never delete learned words;
   disabling learning still prevents writes, secure-field protections remain,
   and no dictionary update or language choice creates a content network path.
10. **Operational quality:** deterministic meaningful tests cover language
    selection, normalization, correction/completion, bilingual vocabulary and
    resource integrity. Run applicable existing checks and a build if available.

Before/after results, implementation decisions, commands and limitations will
be appended below without changing these frozen cases or criteria.

## Implementation and evidence

Benchmark freeze commit: `b52bef20`. No implementation file or shared
`QUALITY_AUDIT.md` finding was inspected before that commit. No other sweep
findings were consulted, no subagents were used, and no PR push was made.

Implemented explicit English, Español and English + Español modes in shared
settings and a persistent keyboard menu above the keys. The active mode feeds
the same correction, completion, prediction and swipe stack. Language changes
replace static data, invalidate old suggestion/undo choices, preserve composing
text, and share the existing personal dictionary, transient contact names,
text replacements and touch calibration. The app refreshes settings on returning
from its preview and handles the keyboard's Settings action by returning home.

Without Full Access, the installed keyboard saves its language choice in its own
preferences. Host settings still require Full Access to reach the extension;
the settings screen explains this. Spanish input keeps the existing QWERTY
geometry with accent/ñ and inverted-punctuation holds. The extension reports
Spanish as its primary language in Spanish mode; bilingual mode reports English
to hosts because UIKit accepts one primary language.

Spanish is compiled from the complete pinned AOSP dictionary and 442,544
Tatoeba sentences. It contains 236,193 entries with corpus-calibrated bigrams and
trigrams. Bilingual mode merges the compiled models into one indexed resource
with 392,087 entries, preserving/remapping histories and English literal-only
spellings. No English-specific demo words or shortcuts are imported into Spanish.
The original English resource is byte-identical. Source revisions, licenses,
1,952 contributor credits, hashes and reproduction commands are in
[`LanguageData/MULTILINGUAL.md`](../LanguageData/MULTILINGUAL.md).

## Frozen benchmark before/after

Before measurements used the only existing English dictionary for missing-mode
diagnostics, while explicitly failing their missing-resource assertions. These
diagnostics do not count as existing Spanish/bilingual modes. The initial
benchmark run recorded 39 issues, including the missing resources and the
pre-existing English prefix miss. After measurements use each mode's own file.

| Frozen case | Before | After |
| --- | --- | --- |
| Mode persistence and UX | English only; no mode setting | Three persisted choices; keyboard menu and host picker; safe migration to English |
| English compatibility | 5/5 literals; both typo targets in first five; `hello` swipe first | Same vocabulary, typo and swipe results; English resource unchanged |
| English `hel` completion | `hello` absent from bounded completion pool | Still absent; frozen criterion remains unmet |
| Spanish vocabulary | 1/10 recognized (`familia`) | 10/10; 236,193 dictionary entries |
| Spanish correction candidates | 0/3 targets in first five | `hols`→`hola`, `graciss`→`gracias`, `corazon`→`corazón` all rank first |
| Spanish completion | `maña` does not offer `mañana` | `mañana` ranks first |
| Accented literals and `ano`/`año` | Spanish entries absent; e.g. `niño` could become `nine` | Distinct spelling IDs, accepted literals; no separator replacement of tested accented forms or `ano`/`año` |
| Bilingual vocabulary and sentences | 6/15 literals under English-only diagnostics; no bilingual mode | 15/15; all three frozen mixed sentences preserved exactly |
| Bilingual corrections | Spanish targets absent | `graciss` and `corazon` targets first; `hola` for `hols` sixth, below English alternatives |
| Bilingual short-prefix recall | No bilingual mode | `hel`→`hello` and `hol`→`hola` miss; `maña`→`mañana` first |
| Swipe | English `hello` first; 0/3 Spanish targets in first five | All relevant frozen paths first: English 1/1, Spanish 3/3, bilingual 4/4 |
| Next-word prediction | After `muchas`: English fallback words | `gracias` third after `muchas` in both Spanish and bilingual; `thank`→`you` remains available |
| Language characters | Existing accent and inverted-punctuation holds | Preserved; unit coverage added |
| Learning and privacy | Existing local learning and private-field policy | Shared personal data survives switches; learning-off and secure-field tests show zero learned entries |

These are small deterministic acceptance cases, not an estimate of population
accuracy. Swipe paths are synthetic QWERTY paths with rounded corners. No human
Spanish swipe dataset or broad dialect-specific evaluation was used. The frozen
criteria were not rewritten to remove misses. The three prefix misses are
reported with Swift Testing `withKnownIssue`, which also flags an unexpected
future pass, so a passing test command does not imply full benchmark acceptance.

## Verification

- `swift test --package-path apps/keyboard-ios/PulpoKeyboardKit -c release --no-parallel`:
  **331 core tests across 41 suites pass**, plus **3 service tests**. Five known
  issues remain: the three disclosed prefix cases and two existing engine
  proxy-lag ambiguities. The entire release core run took 10.6 seconds. Existing
  English noisy-swipe accuracy remains 96.5% top-1 / 100% top-3; timed swipe
  accuracy is 96.83% / 100%. Worst measured English release suggestion pass was
  1.91 ms, full-personal-dictionary pass 3.20 ms, spatial swipe 2.26 ms and timed
  swipe 2.31 ms. These macOS measurements are not physical iPhone claims.
- `python3 -m unittest discover -s apps/keyboard-ios/scripts -p 'test_*.py'`:
  **28 tests pass**, including six new data tests for pinned resources,
  deterministic merging, every remapped index/range, retained English
  conditional probabilities, valid-Spanish/English-typo conflicts, suppressed
  vocabulary, and matching source attribution.
- Full source reproduction into `/tmp/pulpo-multilingual-reproduced` using
  `build_multilingual_data.py --wordlist ... --sentences ... --detailed ... --output-dir ...`:
  reproduced Spanish bytes and attribution exactly; regenerated the final
  bilingual resource. The deterministic merge test checks its exact bytes.
- `xcodegen generate --spec apps/keyboard-ios/project.yml` and unsigned
  `xcodebuild ... -sdk iphonesimulator ... build`: **pass**, including app,
  extension, resource copying and both simulator architectures.
- New `KeyboardLanguageTests` simulator UI tests cover selection persistence,
  explicit Spanish correction, Spanish swipe input, mixed-language typing,
  switching back to English, and the host settings/keyboard round trip:
  **3 tests pass with zero failures** on iPhone 18 Pro / iOS 27.0 in 83.8 seconds.
  Command: `xcodebuild -project apps/keyboard-ios/PulpoKeyboard.xcodeproj -scheme PulpoKeyboard -configuration Debug -destination 'platform=iOS Simulator,id=7E1D7979-7307-4C53-8466-BB41154B383C' -derivedDataPath /tmp/pulpo-multilingual-build -resultBundlePath /tmp/pulpo-multilingual-ui-verified.xcresult -only-testing:PulpoKeyboardUITests/KeyboardLanguageTests -test-timeouts-enabled YES -default-test-execution-time-allowance 90 -maximum-test-execution-time-allowance 120 CODE_SIGNING_ALLOWED=NO test`.
- `git diff --check`: **pass**.

The initial UI test expected `Hols` to autocorrect automatically and failed.
The frozen criterion calls for an offered correction, so the final UI test
asserts and taps the visible `Hola` choice; the conservative separator behavior
is explicitly retained above and below. No correction threshold was weakened.
The first host-settings round trip also failed; moving route observers from the
hidden home list to the active navigation container fixed it, and the final
test verifies synchronization in both directions. An intermediate unbounded UI
run stalled during a menu interaction and was interrupted; the final bounded
three-test run completes successfully.
Debug-mode runs also failed four existing latency thresholds (including when
serial and isolated); the documented release-mode command passes all four.
Those debug failures are not hidden as behavior regressions or waived tests.

## Limitations and integration notes

- The frozen short-prefix greeting criteria are not fully met. In bilingual
  mode short ambiguous errors can favor English, including `hols` placing
  `hola` sixth. Choosing Español gives stronger Spanish results. The Spanish
  UI test explicitly chooses the offered `Hola` correction: the conservative
  autocorrect confidence threshold leaves `Hols` unchanged on space. `graciss`
  does automatically correct to `Gracias` in the tested sentence-start flow.
- The model uses general Tatoeba Spanish and an older AOSP vocabulary. It has
  no dedicated conversational Spanish corpus, code-switch grammar model,
  regional layout, Spanish emoji keywords, or UI translation. Dictation is
  unchanged. Personal learning can supply habitual phrases locally.
- Added dictionaries cost 42,668,888 uncompressed bytes. Only the active stack
  is cached, using memory mapping; overlapping controllers can retain earlier
  mappings. Physical-device extension memory and latency remain unmeasured.
- The data builder pins the existing English binary hash. If another integrated
  change replaces it, intentionally update the pin and regenerate bilingual
  data and integrity hashes; do not silently merge mismatched English versions.
- The Device panel could not open a simulator: raw error
  `Device list failed: The device command failed (exit code 127).` Simulator UI
  verification uses this repository's XCTest workflow instead. No physical-device
  deployment or installed-extension Full Access flow was performed.
