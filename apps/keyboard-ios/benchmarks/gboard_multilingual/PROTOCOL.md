# Frozen multilingual comparison protocol

Frozen before reading source, tests, harnesses or existing audits in this task.
Inputs are novel synthetic curated intentions, not population samples. The old
English paired comparison is already revealed; its replay is not a blind test.
This freeze fixes all 36 cases (12 per mode) in cases.json. No correction tuning.

## Pairing and denominators
Each ID pairs an actual Gboard character-key entry with real Pulpo KeyboardEngine
calls using identical typed Unicode text and one final ASCII space. Modes are
English, Spanish, and English/Spanish multilingual. Six separate categories each
have two cases per mode: typo recovery, literal preservation, code switching,
ambiguous valid words, accents (direct and restoration), unsupported entry.
All cases stay in the report, including infrastructure errors and unavailable
entry. Report per-product exact successes / 36 and availability / 36, per mode
and category; also paired exact outcomes only where both are observable, with
that denominator explicit. Unavailable is not an observed correction failure
and never a success. No significance or overall-superiority claim.

## Entry and controls
Clear only the benchmark text field before each case. Reset Pulpo engine per
case; do not clear Gboard app data or learned state. Fixed file order, one scored
pass. Retry only documented infrastructure failures; retain every attempt.
Type lower case exactly as written, including internal spaces, then the final
space. Disable auto capitalization, smart punctuation and double-space period
where possible and record actual settings and mismatches. Do not lowercase,
trim, remove accents, or normalize observed output for scoring: exact Unicode
string equality, including the trailing space, is required. Separately report
any diagnostic normalization; it cannot change scores.

Gboard must use verified visible key geometry (including language layout changes)
and actual taps; no adb text injection, clipboard, or suggestion selection.
Direct accented characters may use verified long-press menus; if unavailable,
retain the case as unavailable with the precise reason. Non-Latin/emoji entry
must use visible verified keys or be unavailable; do not substitute ASCII.
Pulpo receives the same character stream through its public engine entry API;
unsupported accepted literal characters must be distinguished from UI reachability.

Use at least 120 ms delay after each Gboard key, 350 ms after spaces, and 750 ms
before reading the final field; actual adb overhead may increase these delays.
Pulpo replay is sequential and untimed; this is an output comparison, not latency.
No context prefixes, manual case repairs, or per-case setting changes. Record
active Gboard languages, multilingual setting, correction toggles, app/version,
Android version, geometry, engine revision and commands before scoring. If any
mode cannot be verified, all its Gboard rows remain explicitly unavailable.

## Evidence and interpretation
Keep raw outputs, attempt/error records, hierarchy dumps, screenshots, build logs,
and timing outside Git. Version only synthetic inputs, runner and concise audit.
List every observed exact failure, unavailable row, configuration mismatch and
execution limit. Literal controls and ambiguous valid words are scored as frozen,
not retroactively relabeled. Accent restoration expectations are curated intents;
valid alternatives can fail this narrow test without being general errors.
The engine API and Android Gboard differ in UI, context, lexicon and training;
state these limits. Record functional checks, wall time, API/financial cost if
known; do not invent unknown costs. Do not edit production keyboard/dictionaries,
push parent branches, deploy physical devices, or touch other simulators.
