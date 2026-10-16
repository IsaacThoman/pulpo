# Frozen multilingual Gboard comparison — 2026-10-16

Among the **30 observable pairs**, Pulpo matched **27/30** and Gboard **28/30**.
Twenty-six pairs matched on both, one on Pulpo only, two on Gboard only, and one
on neither. Six other cases were explicitly unavailable on Gboard.

These are **36 curated intended outputs**, not human population accuracy, motor
accuracy, or evidence of overall superiority. The earlier English paired corpus
was already revealed and was not replayed or represented as blind here.

## Freeze and measured revisions

Protocol and exact inputs were committed as `30025e39` **before reading source,
tests, harnesses or audits in this task**. See
[protocol](../benchmarks/gboard_multilingual/PROTOCOL.md) and
[cases](../benchmarks/gboard_multilingual/cases.json). There are 12 cases per mode,
two per category per mode. No case or expected string changed after freezing.
Protocol SHA-256: `b7af36a05226d84f30a30bedf22d0f71af7cb8cbb6220f6c1393b86e24b3a458`.

Benchmark work stayed on isolated `t3/gboard-multilingual-benchmark`, beginning at
`1fc4edb1a7cc68ff2fb6a4cf47ed9ee48a368a7f`. Actual engine/dictionaries were read
from a separate clean detached checkout of PR #782 head observed at setup:
`8891f1971c485e9ab3b4fe4ad16d30857c092256`. The source branch may subsequently
advance. Runner commit: `3c89624e`. No production/dictionary edits, push, physical
deployment, iPhone 17 interaction, or iPhone 18 Pro interaction occurred.

## Configuration and method

Assigned device: `emulator-5554`, Android 17 / Google Play API 37,
Gboard `17.2.2.895242737-preload-arm64-v8a`, versionCode `175753754`.
T3 `device_list` failed with `Device list failed: The device command failed
(exit code 127).` The subsequent `device_open` returned `No device emulator-5554
on host local. Call device_list for current ids.` After this bounded attempt,
we used the authorized SDK adb and Android Studio Java fallback.

English (US) QWERTY and Español (EE.UU.) QWERTY (Ñ) were inspected in Gboard's
Languages UI. Each monolingual pass used its active layout with Multilingual
typing **off**. The bilingual pass used the English layout with Multilingual
typing **on** and Spanish checked. Settings XML, active-language captures, key
hierarchies and screenshots are retained externally. Installed-language lists
alone were not treated as active-mode verification. Active space-key labels were
`English`, `Español`, and `EN • ES`. Enabling the bilingual toggle initially left
Spanish unchecked; it was explicitly checked and captured before that pass.

Auto-correction stayed on; Auto-capitalization was verified off. Both host fields
also avoided capitalization requests. Pulpo smart punctuation and double-space
period were off; equivalent Gboard controls were **not verified** in the visible
settings. No frozen input exercises punctuation or a double space, so these
settings are a documented mismatch with no tested equality claim. Gboard spelling,
grammar and suggestion features remained enabled. The Android field requested
`IME_FLAG_NO_PERSONALIZED_LEARNING`; Gboard's private prior learned state was not
cleared or inspected. Multilingual-off UI settings do not prove isolation of
Gboard's private lexicons. Pulpo used a fresh language stack and nil personal URL for
every case, with learning off. This history/reset asymmetry remains a limit.

Gboard received real injected touchscreen DOWN/UP events, including spaces,
symbol-page digit entry and verified accent-menu gestures. Geometry came from
actual labeled accessibility bounds, checked against screenshots. For example,
English `q=(58.5,1731)`, `a=(85,1885.5)`, `Space=(539.5,2196)`;
Spanish `a=(58.5,1885.5)` and direct `ñ=(1021.5,1870)` differ. These are centers
of observed accessible touch bounds, not assumed QWERTY pitch. Before every
observable case the runner rechecked the active-language label and all 26 letter
positions. No text injection, clipboard, suggestion taps, or context prefix.

Pulpo received `insertCharacter` / `insertSpace` calls on real `KeyboardEngine`,
without touch coordinates. Every input ended in one literal ASCII space. Output
comparison retained case, accents, Unicode scalars, internal and trailing spaces;
no trimming or normalization. Gboard waits were at least 120 ms per key, 350 ms
per space and 750 ms before the final read, plus injection overhead. Pulpo replay
was sequential and untimed. These execution differences preclude latency or
motor-accuracy comparisons. The runner's per-case elapsed times include harness
work, reset, sleeps and captures.

## Accounting and every outcome

Unavailable entry is not an observed correction failure. All six unavailable
Gboard rows remain in the 36-case denominator: three `東京` inputs have no
Japanese keyboard configured/verified, and three `🦑` inputs have no verified
emoji-selector path in this runner. The latter is a harness limitation, **not**
a claim that Gboard lacks emoji support. The preflight explicitly records the
missing entry path instead of typing truncated/substitute input. Pulpo accepted
all six literally through its core API; this does not prove on-screen
reachability in Pulpo's keyboard UI. Paired comparison excludes only unavailable
observations and explicitly reports its denominator below.

| Group | Pulpo exact | Pulpo available | Gboard exact | Gboard available |
|---|---:|---:|---:|---:|
| all | 33/36 | 36/36 | 28/36 | 30/36 |
| en | 11/12 | 12/12 | 9/12 | 10/12 |
| es | 11/12 | 12/12 | 10/12 | 10/12 |
| en-es | 11/12 | 12/12 | 9/12 | 10/12 |
| typo | 6/6 | 6/6 | 5/6 | 6/6 |
| literal | 5/6 | 6/6 | 6/6 | 6/6 |
| switch | 6/6 | 6/6 | 6/6 | 6/6 |
| ambiguous | 6/6 | 6/6 | 6/6 | 6/6 |
| accents | 4/6 | 6/6 | 5/6 | 6/6 |
| unsupported | 6/6 | 6/6 | 0/6 | 0/6 |

Paired available: 30 Pulpo exact: 27 Gboard exact: 28 both exact: 26 Pulpo only: 1 Gboard only: 2 neither: 1

Every case (JSON strings preserve exact text and trailing spaces):

| ID | Intended | Pulpo | Gboard |
|---|---|---|---|
| en-01 | "please bring snacks " | ✓ "please bring snacks " | ✓ "please bring snacks " |
| en-02 | "we should leave soon " | ✓ "we should leave soon " | ✓ "we should leave soon " |
| en-03 | "velvet otters nap " | ✓ "velvet otters nap " | ✓ "velvet otters nap " |
| en-04 | "build zxqv42 now " | ✓ "build zxqv42 now " | ✓ "build zxqv42 now " |
| en-05 | "send el recibo today " | ✓ "send el recibo today " | ✓ "send el recibo today " |
| en-06 | "my vecino is ready " | ✓ "my vecino is ready " | ✓ "my vecino is ready " |
| en-07 | "the form is here " | ✓ "the form is here " | ✓ "the form is here " |
| en-08 | "we can brake here " | ✓ "we can brake here " | ✓ "we can brake here " |
| en-09 | "café mañana " | ✓ "café mañana " | ✓ "café mañana " |
| en-10 | "jalapeño café " | FAIL "jalapeño cafe " | FAIL "jalapeno cafe " |
| en-11 | "東京 " | ✓ "東京 " | unavailable: java.lang.UnsupportedOperationException: No verified entry for U+6771 |
| en-12 | "🦑 " | ✓ "🦑 " | unavailable: java.lang.UnsupportedOperationException: No verified entry for U+1f991 |
| es-01 | "trae la camiseta " | ✓ "trae la camiseta " | ✓ "trae la camiseta " |
| es-02 | "vamos a escribir " | ✓ "vamos a escribir " | ✓ "vamos a escribir " |
| es-03 | "las nutrias descansan " | ✓ "las nutrias descansan " | ✓ "las nutrias descansan " |
| es-04 | "usa zxqv42 ahora " | ✓ "usa zxqv42 ahora " | ✓ "usa zxqv42 ahora " |
| es-05 | "manda the invoice hoy " | ✓ "manda the invoice hoy " | ✓ "manda the invoice hoy " |
| es-06 | "mi meeting termina pronto " | ✓ "mi meeting termina pronto " | ✓ "mi meeting termina pronto " |
| es-07 | "la casa queda lejos " | ✓ "la casa queda lejos " | ✓ "la casa queda lejos " |
| es-08 | "tu sabes el camino " | ✓ "tu sabes el camino " | ✓ "tu sabes el camino " |
| es-09 | "el niño pidió té " | ✓ "el niño pidió té " | ✓ "el niño pidió té " |
| es-10 | "mañana tomaré café " | FAIL "mañana tomare café " | ✓ "mañana tomaré café " |
| es-11 | "東京 " | ✓ "東京 " | unavailable: java.lang.UnsupportedOperationException: No verified entry for U+6771 |
| es-12 | "🦑 " | ✓ "🦑 " | unavailable: java.lang.UnsupportedOperationException: No verified entry for U+1f991 |
| en-es-01 | "please trae la caja " | ✓ "please trae la caja " | FAIL "please trrae la caja " |
| en-es-02 | "necesito the receipt " | ✓ "necesito the receipt " | ✓ "necesito the receipt " |
| en-es-03 | "quiet gatos sleep " | ✓ "quiet gatos sleep " | ✓ "quiet gatos sleep " |
| en-es-04 | "envia zxqv42 today " | FAIL "envía zxqv42 today " | ✓ "envia zxqv42 today " |
| en-es-05 | "bring las llaves tomorrow " | ✓ "bring las llaves tomorrow " | ✓ "bring las llaves tomorrow " |
| en-es-06 | "quiero the blue folder " | ✓ "quiero the blue folder " | ✓ "quiero the blue folder " |
| en-es-07 | "once we arrive llama " | ✓ "once we arrive llama " | ✓ "once we arrive llama " |
| en-es-08 | "sale el sol soon " | ✓ "sale el sol soon " | ✓ "sale el sol soon " |
| en-es-09 | "mañana bring café " | ✓ "mañana bring café " | ✓ "mañana bring café " |
| en-es-10 | "el niño wants tea " | ✓ "el niño wants tea " | ✓ "el niño wants tea " |
| en-es-11 | "東京 " | ✓ "東京 " | unavailable: java.lang.UnsupportedOperationException: No verified entry for U+6771 |
| en-es-12 | "🦑 " | ✓ "🦑 " | unavailable: java.lang.UnsupportedOperationException: No verified entry for U+1f991 |

## Findings and future work

Pulpo's three frozen failures were incomplete restoration of `café` in English,
incomplete restoration of `tomaré` in Spanish, and changing literal `envia` to
`envía` in bilingual mode. Gboard's two were leaving English `jalapeno cafe`
unchanged and leaving bilingual `trrae` unchanged. These are every observed
exact failure; their complete outputs are above. The accent/literal tension is
useful future policy evidence: an accent can be wanted in one case and forbidden
by a literal intention in another. We did not change intentions after seeing
outputs, label these as population-level errors, or tune a correction algorithm.
All six code-switch and six ambiguous-word cases were preserved on both engines;
the literal category was 5/6 Pulpo and 6/6 Gboard on this small curated set.

Useful follow-ups are broader independently authored preregistered sets, diverse
Spanish dialects, a verified emoji selector/non-Latin entry path, and controlled
cross-device/history/touch-model trials. These cases are now revealed; subsequent
replays are regression checks and cannot be called a new blind benchmark.

## Checks, setup failures, costs and retained evidence

Functional checks passed: release SwiftPM build and 36 real engine replays;
Android javac/dex/APK build and 30 actual Gboard entries; all 36 result IDs;
per-mode/category counts; exact-output score consistency; XML assertions for
API 37, correction/capitalization, both monolingual toggles, bilingual toggle and
Spanish checkbox; active labels; Python compilation; shell syntax; and unchanged
byte-for-byte frozen protocol/inputs. A negative check intentionally removed the
unavailable `en-12` row and confirmed that summarization rejects the missing case.
No scored infrastructure error or scored retry occurred.

Unscored setup failures were retained: the two T3 errors above; one external
probe-helper shell-quoting error (`Invalid userId -2`); an unobservable language
picker label; an accidentally overlapping instrumentation probe that reported
`Process crashed`; and requesting English `Symbol keyboard` after switching to
Spanish (`Missing probe label Symbol keyboard`). Those probes were superseded by
serial captures using observed labels. The versioned wrapper rejects incomplete
instrumentation before pulling stale output. Enabling multilingual input also
required explicitly checking Spanish before scoring. No failed case was removed.
See external `setup-errors.txt` for the sequence.

Gboard scored-pass wall times including harness/captures were English **118.011 s**,
Spanish **131.058 s**, bilingual **132.120 s**: **381.189 s total**. Pulpo's recorded
per-case elapsed sum was **0.099915 s**, including fresh dictionary load and
excluding compilation; this is harness accounting, **not a comparable typing
latency metric**. Setup/build/audit work is additional. No paid API/service calls
were made by the benchmark runner; assistant/session billing is not exposed, so
no total monetary cost is claimed.

Raw evidence stays outside Git at
`/tmp/pulpo-gboard-multilingual-20261016/`: `pulpo.json`, `en.json`, `es.json`,
`en-es.json`, per-pass device-file tar archives with all pre/post hierarchies and
final screenshots, labeled geometry/menus, settings XML, bilingual configuration
screenshot, input/dictionary hashes, metadata, commands/build output, and the
missing-row negative check. The separate detached PR checkout is under `pr782/`.
Reproduction commands are in the
[runner README](../benchmarks/gboard_multilingual/README.md).

At handoff Gboard remains on the English QWERTY bilingual configuration (`EN • ES`),
Spanish enabled for multilingual suggestions, Auto-correction on and
Auto-capitalization off. Spanish's standalone layout retains Multilingual typing
off. The test APK remains installed. No app data was cleared, unrelated app was
removed, or emulator/iOS device was reset. `emulator-5554` is available to the
parent again when this task returns.
