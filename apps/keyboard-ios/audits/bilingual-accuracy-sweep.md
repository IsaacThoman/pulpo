# Blind English / Spanish / bilingual typing accuracy sweep — PR 782

Decision: **retain no production change**. A new production-engine tap benchmark and reproducible evidence are committed. A candidate that protects an accented name causes substantially more accented-typo failures and is rejected. No tuning followed the one held-out reveal.

## Provenance and blind boundary

Work took place only in isolated worktree `t3-a9793499`, branch `t3/bilingual-typing-accuracy-sweep`, starting at `5b972d2a13ad20d5e8202ffda82334972361713a`. No parent checkout edits, push, deployment, device interaction, or Gboard comparison.

Before opening AGENTS.md, implementation, tests, or existing audits, authored and committed both exact task sets and [the protocol](bilingual-accuracy-sweep/PROTOCOL.md). Commit `e2db42d4` freezes 38 development and 38 held-out cases, each with explicit desired committed text, trailing spaces, category, and applicable modes. Each split expands to 74 case/mode observations: 18 English, 18 Spanish, 38 bilingual. Typo recovery, clean literal protection, and editor punctuation literals are separate categories. There are names, intentional accents, contractions, code switches, valid ambiguous words, and case/punctuation controls.

SHA-256 at freeze (verified again by the summarizer):

- Protocol: `b84609541007f8aef44df546f92f4924819436c4ba8e01ced685f81f5819d88a`.
- Development: `6b8f6bc2d79adefdf6a0da6a4defeeaa5f7569a0cf482e439cecf187222ba290`.
- Held-out: `86d912dfb4cf74a8794eadd7737bd5cb95e2d912a1502fcd12fc9623a5714855`.

The two sets were authored together by this agent without repository evidence. They are implementation-blind synthetic tasks, not independently authored human-blind data. Authorship necessarily exposed both sets initially; held-out cases were not consulted or executed during diagnosis. Content-bearing terminal correction targets are lexically disjoint (16 distinct desired typo targets per split); function words and sentence scaffolding overlap. Mode replays are correlated, not independent participants. This convenience sample cannot estimate population accuracy, touch-error distributions, or comparative Gboard quality.

## Adapter and production path

[Benchmark](../PulpoKeyboardKit/Tests/KeyboardCoreTests/BilingualTypingAccuracyBenchmarkTests.swift), committed in `d24d58db`, loads the real `en_US.pkdict`, `es.pkdict`, and `en_es.pkdict` and creates a real `LanguageModel`, `SpellCorrector`, `Suggester`, and `KeyboardEngine`. Every character is a key event. It does not insert the desired token or call a standalone corrector as a substitute for committed text.

The adapter mirrors `KeyboardController.activate`: ASCII letters receive QWERTY key-center taps; spaces receive `(5, 3)` in key-pitch units; punctuation and accented alternate input have no tap. The space position is outside the production 0.8-pitch space-slip radius. Uppercase intent uses Shift down/up. Suggestions are read after each key, including that computation in timing. The text document is a synchronous in-memory proxy with the cursor at the end, full context visibility, and no selection. It exercises editing and punctuation boundaries, not selection or hidden-selected-context behavior.

Automatic capitalization and smart punctuation are disabled to preserve the exact frozen casing and straight apostrophes. Other correction/prediction behavior is enabled. Learning is disabled and every case receives fresh personal/touch state. Dictionaries are mapped once per mode solely as harness setup; there is no language-cache implementation change. Each input is also replayed with autocorrection off, and an assertion verifies that raw output exactly equals the frozen typed string. All 148 original split observations passed that raw-adapter assertion, as did all 24 diagnostic observations, in both builds.

This is engine-level linguistic and commit accuracy, not a UIKit/device integration or Spanish layout/alternate reachability test. Centered taps do not model real finger variance. No generated dictionary, language source/binary, display accent-ranking partition, language cache, Spanish layout/alternates, or dictation code was edited. Parent-owned selected-context handling was excluded.

## Frozen acceptance and candidate decision

Original threshold, with no amendment: improve at least two development typo outcomes, or independently justified editor behavior by at least two development editor outcomes; introduce zero new clean/editor failures; improve at least one corresponding held-out outcome with zero new held-out failures overall. Release regressions must pass. No clean-name-only eligibility exception was added after seeing data.

Development baseline: **70/74 (94.59%)**. Typo recovery **28/28**, clean literal protection **30/32**, editor literals **12/14**.

By mode:

- English: typo 6/6, clean 6/6, editor 6/6; total 18/18.
- Spanish: typo 6/6, clean 5/6, editor 4/6; total 15/18.
- Bilingual: typo 16/16, clean 15/16, editor 6/6; total 37/38.

Every development baseline mismatch follows. Every displayed string below includes its trailing space:

- `dev-023`, Spanish: typed/desired `Íñigo `, actual `Índigo `.
- `dev-023`, bilingual: typed/desired `Íñigo `, actual `Indigo `.
- `dev-033`, Spanish: typed/desired `hello,world `, actual `bello,world `.
- `dev-034`, Spanish: typed/desired `foo.bar `, actual `foto.bar `.

The Spanish punctuation cases deliberately request literal English/code text in Spanish mode; these are user-intent misses under this task, not proof that all Spanish corrections on foreign text are defective. The period case also exposes correction before a complete dotted identifier can be observed. Disabling punctuation corrections generally would discard useful sentence-boundary recovery, so no such blanket change was selected.

The [rejected patch](bilingual-accuracy-sweep/rejected-accented-name-guard.patch) extends the existing title-case name safeguard to explicitly accented sentence-initial words, retaining its existing transposition/directed-touch exceptions. It protects `Íñigo` in es/bi, scoring **72/74 (97.30%)**, with no original-development regressions. Typo recovery remains 28/28 and editor literals remain 12/14; clean literals rise to 32/32. It does not meet the frozen development eligibility threshold.

Before reading hold-out, separately froze [12 diagnostic accented-typo inputs](bilingual-accuracy-sweep/diagnostic-accented-typos.json) in `18b37607`, producing 24 es/bi runs. These are post-inspection development probes, not additional blind evidence. Baseline is **22/24 (91.67%)**; candidate is **11/24 (45.83%)**. Lowercase counterparts serve as controls for the title-case rule. All eleven newly regressed inputs remain literally misspelled with the guard:

- Spanish: `Díass ` → expected `Días `; `Árboll ` → `Árbol `; `Adióss ` → `Adiós `; `Mañanaa ` → `Mañana `; `Aquíi ` → `Aquí `; `Fácill ` → `Fácil `.
- Bilingual: `Árboll ` → expected `Árbol `; `Adióss ` → `Adiós `; `Mañanaa ` → `Mañana `; `Aquíi ` → `Aquí `; `Fácill ` → `Fácil `.

Baseline already fails bilingual `Díass ` → `Días ` and `díass ` → `días `, leaving both typed inputs unchanged; candidate also fails these. Thus all thirteen candidate diagnostic mismatches are enumerated above. No other diagnostic output changes occur.

Two name-protection gains cost eleven demonstrated typo-recovery regressions. Candidate rejected, production source restored, and [the no-change decision](bilingual-accuracy-sweep/SELECTION.md) committed in `4fcfe824` before held-out evaluation. This decision is justified independently by both the frozen threshold and the observed harm.

## Single held-out reveal

After that decision commit, performed one paired final evaluation of the previously built baseline and rejected-candidate release binaries, without recompilation or tuning between runs. Reusing separately built artifacts prevents restored source from accidentally substituting the baseline for the rejected candidate. No further implementation experiments occurred after reveal.

Both builds score **73/74 (98.65%)**, with identical output for every observation:

- English: typo 6/6, clean 6/6, editor 6/6; total 18/18.
- Spanish: typo 6/6, clean 6/6, editor 6/6; total 18/18.
- Bilingual: typo 15/16, clean 16/16, editor 6/6; total 37/38.

Only mismatch: `held-001`, bilingual, typed `adn `, desired `and `, actual `adn `. There are **zero candidate gains and zero candidate regressions on held-out**. Its required held-out improvement is absent. The unchanged implementation retains the same remaining failure. The held-out result is evidence, not a prompt for another tuning round.

## Costs and release regressions

Single-run host release timings include key edits plus immediate suggestion refresh, with exact arrays in the reports. They are not device input latency or evidence of a statistically meaningful speed difference.

- Development, 655 timed keys per build: baseline replay 0.431501 s, median 0.107250 ms, p95 1.630208 ms, mean 0.421812 ms; rejected replay 0.410860 s, median 0.107500 ms, p95 1.567542 ms, mean 0.389629 ms. Candidate mean delta −0.032183 ms/key.
- Held-out, 668 timed keys per build: baseline replay 0.290747 s, median 0.069875 ms, p95 0.987167 ms, mean 0.234254 ms; rejected replay 0.287751 s, median 0.071688 ms, p95 0.943083 ms, mean 0.223956 ms. Candidate mean delta −0.010298 ms/key.
- Diagnostics, 164 timed keys per build: baseline replay 0.141098 s; rejected replay 0.129723 s. Replays also include untimed raw-control passes and dictionary setup in elapsed time.
- Fresh release build reports: baseline 55.22 s; candidate 60.50 s. No final production code is added, so retained production runtime/memory cost is zero. No device or external comparison cost was incurred; monetary inference cost was not measured.

Final-production regression binary was built from unchanged parent production source plus the new opt-in benchmark. Command:

```sh
swift test -c release --skip-build --no-parallel \
  --package-path apps/keyboard-ios/PulpoKeyboardKit \
  --scratch-path /tmp/pulpo-bilingual-baseline
```

Result: **405 tests in 57 suites passed in 12.047 s, with five existing known issues and no unexpected failures**. The final production source is byte-for-byte unchanged from the parent. The rejected candidate was not promoted or claimed to pass the full release suite.

Exact known issues:

- `EngineFuzzRegressionTests.swift:219`, `hostRevertToARecentOwnStateIsAKnownAmbiguity`, seed 440: `.deleteWord` spans two tokens, before ` A`, after empty, removed ` A`. Existing one-second own-snapshot/proxy-lag ambiguity.
- Same test/line, seed 227: after `.deleteRange(0.989, 4, .now)`, composing `tehi` versus before `teh`. Same existing ambiguity.
- `MultilingualTests.swift:34`, `frozenAcceptanceBenchmark`, en_US completion `hel → hello` unavailable.
- Same test/line, en_es completion `hel → hello` unavailable.
- Same test/line, en_es completion `hol → hola` unavailable.

Compilation also emits the existing `TouchModel.swift:155` warning about converting a non-Sendable function to an `@Sendable` block. No changes were made in those areas.

## Reproduction and artifacts

From repository root, the reports can be regenerated on the final unchanged source. This is a reproduction on already revealed data, not a new blind sweep:

```sh
PK_BILINGUAL_CASES="$PWD/apps/keyboard-ios/audits/bilingual-accuracy-sweep/development.json" \
PK_BILINGUAL_REPORT=/tmp/bilingual-development.json \
swift test -c release --no-parallel \
  --package-path apps/keyboard-ios/PulpoKeyboardKit \
  --filter BilingualTypingAccuracyBenchmark

python3 apps/keyboard-ios/audits/bilingual-accuracy-sweep/summarize.py
```

Use `held-out.json` or `diagnostic-accented-typos.json` for the other respective runs. The summarizer validates freeze hashes, raw input equality, score consistency, complete case/mode coverage, paired identities, and exact transitions. It reproduces [summary.json](bilingual-accuracy-sweep/summary.json) from the six committed raw reports. Rejected-candidate reproduction requires applying the audit patch in a disposable checkout; the patch is not an intended production change.

Commits before final audit publication: `e2db42d4` freezes blind sets; `d24d58db` adds the real engine benchmark; `18b37607` freezes explicitly non-blind diagnostic probes; `4fcfe824` records rejection and locks the final no-change decision. This audit publication adds held-out reports and the reproducible summarizer. No parent push, physical deployment, or external messaging was performed.

Independent parent review recomputed the summary and checked every report row against its frozen case. The summarizer now enforces those identity checks (`id`, `mode`, `typed`, `desired`, and `category`), complete coverage of all three case sets including diagnostics, and duplicate rejection for both reports. The diagnostic fixture is also pinned by SHA-256. The six original reports still reproduce `summary.json` byte-for-byte; temporary copies with an altered desired string, a missing diagnostic observation, or a duplicate observation are rejected. This validation hardening changes no cases, results, thresholds, or production code.
