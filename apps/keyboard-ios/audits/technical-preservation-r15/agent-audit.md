# R15 anchored technical-text preservation

Retain the narrow candidate for parent review. It protects explicit paths while preserving every measured ordinary output, alternative, automatic correction proposal, learned-word list and touch weight. Independent held-out exact documents improve **79/132 → 99/132**, with **20 gains and zero passing-case losses**. No independent Spanish-only improvement is established. This is a bounded syntax policy with known ambiguity and coverage limits, not broad spelling accuracy or native UX acceptance.

Base: `8c7d00a2579b2e66e231a673a7744953b7dfdb60`. Development/protocol freeze: `d0796674`, before implementation inspection. Selected source/runner freeze: `ce44c06b`, before the single held-out reveal. Full source and input hashes are in `candidate-freeze.json`; post-reveal provenance is in `final-provenance.json`. PR782 is linked to this thread. No push, deployment, device access, dictionary edit, or parent checkout edit occurred. Parent R14's before-existing-text policy is untouched.

## Product behavior and intentional limits

The existing URL/handle/underscore identifier guard now additionally recognizes whitespace tokens beginning with `./`, `../`, `~/`, an ASCII Windows drive root, a UNC double backslash, or a Unix root followed by another directory separator. `/tmp/notes.txt ` stays literal; `a/teh ` and `Wait...teh ` retain correction to `the`. `útil/inportante ` retains correction to `importante` in Spanish/bilingual. A single `/recieve` remains correctable because it is ambiguous between a root entry, command, and slash-leading prose.

No per-word/extension exceptions, any-dot/any-slash rule, leading-option rule, delayed rollback or blanket disable. Bare filenames/extensions, bare relative paths, options and quoted/bracketed paths retain their existing behavior. Those intentional misses remain in the reports. A root entry without a directory separator is deliberately not protected. The engine cannot retroactively recover an early correction before unambiguous path syntax becomes visible. Visible syntax cannot establish user intent; even anchored syntax may be used as prose.

This policy is recomputed from current cursor context, so deleting markers or moving away does not leave sticky literal state. It reuses the existing literal guard for alternatives/automatic commits and final-component learning. Intermediate components still pass through the existing nonseparator learning branch at slash/backslash. The fully typed review diagnostic still learns `clientsecret` on both versions; the candidate suppresses only the final component's learning/calibration. Do not describe this as path-wide learning suppression or privacy detection. Actual private fields retain zero learning/calibration.

## Frozen development and single reveal

All **38 development templates** and **44 independent held-out templates** run on each actual `en_US.pkdict`, `es.pkdict` and `en_es.pkdict` LanguageStack. Content labels never select a substitute bilingual stack. The same exact oracle is retained in all three modes, including foreign-language misses.

Development exact full documents, baseline → frozen candidate:

- English: **20 → 25 / 38**, five gains, zero losses.
- Spanish: **19 → 22 / 38**, three gains, zero losses.
- Bilingual: **23 → 30 / 38**, seven gains, zero losses.

The published `/tmp/notes.txt` bug contributes two diagnostic gains (EN/bilingual) within those totals; it and all exposed R11 examples are development controls, never fresh blind gains. Dedicated ordinary-boundary templates stay **6/13**, **5/13**, **11/13** respectively; all outputs, alternatives, proposals, learning and touch are unchanged, including failures.

Held-out exact full documents, baseline → candidate:

- English: **21 → 31 / 44**, ten gains, zero losses.
- Spanish: **31 → 31 / 44**, zero gains or losses.
- Bilingual: **27 → 37 / 44**, ten gains, zero losses.

EN/bilingual gains are `h01`–`h06` and `h13`–`h16`: rooted/relative/home/drive/UNC path typing, suffix, selection, retained anchor after deletion and external caret movement. Every other full output is unchanged. Spanish already preserves these English typo fragments, so this held-out establishes preservation, not new Spanish-only path gains. Development supplies the Spanish corruption examples.

All **12 meaningful ordinary correction templates** (`h21`–`h32`) end at valid boundaries, not before following text. They stay **6/12 EN**, **5/12 ES**, **11/12 bilingual**. The six English targets all autocorrect in EN/bilingual; five of six Spanish targets autocorrect in ES/bilingual. The `numero` case offers `número` but does not automatically commit it in ES/bilingual; alternatives and automatic commits are separately recorded. The whole prose half stays **14/24 EN**, **12/24 ES**, **20/24 bilingual**.

Independent author task: `node:delegated-task:command%3Amcp%3A343e9f87-4b8b-46cd-9ef9-8820c72a95a2%3Adelegate-task%3Apr782-r15-heldout-author-v1`. It read only the frozen protocol/exclusions, received no proposed fix/development failures, inspected no implementation/results and ran no keyboard. It returned only count/hash/status; its 44 cases were read-only outside Git until `ce44c06b`. The revealed SHA-256 matches `e31e9142f8cd3cb8e77ed9b2ad1cf673fdf0d39eb50ddf66badf092e13a4a45c`. Author checks and an independent typed-token intersection check found zero excluded lexical targets (standard URL scheme scaffold excepted). Exclusions include old R11 development/held-out vocabulary and new development vocabulary. Common prefix scaffolding is allowed; semantic category overlap is required.

Exactly one held-out baseline/candidate run each. No source, runner, cases or expected-document edits followed reveal. No case was removed, normalized, rescued, re-scored or post-reveal retested. All outcomes and failures are committed. The held-out is now exposed and cannot serve as a future blind test.

## Oracle defects and coverage limits

Five primary development expectations are wrong under the requested normal settings: `spaced`, `space-es` expect lowercase after a sentence; `delete-marker`, `delete-option` expect lowercase after returning to an empty document; `undo` expects the delimiter retained after Backspace Undo. All remain failed in their original denominators, both versions. Separate focused assertions verify actual correct capitalization/Undo. Do not report adjusted headline rates.

The held-out author also retains a trailing space in the `h42` Undo expectation. Both versions correctly produce `Teach langauge` without it; this is **0/1 in every mode**, retained. `h40` and `h41` expect correction immediately before existing text. After the first key the caret precedes a word character, so the unchanged inside-word policy suppresses proposals; both are **0/2 in every mode**. This is the parent R14 area, deliberately untouched. These failures are separate from the 12 valid-boundary ordinary controls.

The author's `h33`/`h34` labels say “true inside-word,” but they append to an existing prefix with no suffix, producing `prelangauge`/`microseperate`; they are **2/2 per mode** and are not evidence for the `cursorInsideWord` suffix guard. The actual held-out suffix-policy controls are `h40`/`h41`, with unchanged behavior but failed authored oracles. Development has separately valid suffix/inside-word controls (`inside-word`, `inside-path`), **2/2 in every mode**. This distinction prevents inflating meaningful ordinary controls with cases already policy-disabled.

Held-out ASCII/Unicode ellipsis cases preserve already-correct words before the marker; they do not challenge a following typo. The strong following-typo controls are exposed development cases. Held-out unspaced sentence coverage is absent; development covers it. These gaps limit generalization. The raw literal oracle still does not model all straight-opening-quote/smart-punctuation capitalization interactions; the source reviewer identified that limitation before freeze. It causes no mismatch in these frozen sets and is not evidence that every schema-valid string is covered.

Remaining selected failures, all retained in `summary.json` and full per-case reports:

- Development EN: `filename`, `barepath`, `option`, `slash-es`, `spaced`, `dots-es`, `space-es`, `ordinary-es`, `accent`, `accent2`, `delete-marker`, `delete-option`, `undo`.
- Development ES: `option`, `slash-en`, `slash-words`, `dots`, `unicode`, `sentence`, `spaced`, `space-es`, `ordinary-en`, `delete-marker`, `delete-option`, `caret-away`, `selection`, `suffix`, `undo`, `capital`.
- Development bilingual: `filename`, `barepath`, `option`, `spaced`, `space-es`, `delete-marker`, `delete-option`, `undo`.
- Held-out EN: `h08`, `h09`, `h10`, `h27`–`h32`, `h38`, `h40`–`h42`.
- Held-out ES: `h08`, `h21`–`h26`, `h31`, `h39`–`h42`, `h44`.
- Held-out bilingual: `h08`, `h09`, `h10`, `h31`, `h40`–`h42`.

## Review, nonregressions and validation

Two independent source review rounds are recorded with findings/responses/task IDs in `review.md`. The first variant accepted any single root slash; review identified slash-leading prose ambiguity. Before reveal, the selected refinement requires a directory separator after the Unix root. Initial development outputs are retained in `development-first-candidate.json`. Updated runner fixes opener casing for brackets and caret-move defaults, records touch weight and asserts private-field zero learning/touch. Both versions are rerun before freeze; all development documents/proposals/alternatives remain identical to the first measurement. The second reviewer found no production blocker, confirmed the fixes and accepted the explicit existing limitations. Its stale-evidence finding is resolved by the completed updated reports before freeze; its straight-quote raw-oracle limitation is retained explicitly.

`review-diagnostics.json` is an exposed development supplement, not held-out evidence. It records slash-leading prose correction unchanged, a fully typed path's text/partial learning, and unchanged quoted-path misses. EN **2→2/3**, ES **1→2/3**, bilingual **2→2/3**. No passing-case loss. Both raw replays **9/9**.

- Paired no-autocorrect raw literal controls: development **114/114** on each version; held-out **132/132** on each. Normal capitalization remains active.
- Every prose automatic output, correction alternative, automatic proposal, learned-word list and touch weight is identical between baseline/candidate: **39 development** and **72 held-out** replays. See `preservation-checks.json`. Primary nontechnical controls also have no output changes.
- Secure/email/URL/one-time-code: **12/12 exact per split and per version**, with **zero learned words and zero touch weight** in both automatic/raw replay. Replay assertions and the existing privacy/model-switch tests pass. No replay path writes personal storage.
- Real selection replacement, suffix preservation, caret moves, deletion, Undo and normal capitalization have focused checks, full per-case evidence and existing core regressions. No before-existing-text policy change is made to manufacture passing controls.
- Selected release package: **445 KeyboardCore tests + 3 PulpoServices tests**, passing; six new focused methods have 30 parameterized invocations. Baseline with identical replay runner: **439 core + 3 service**, passing. Both report the same five known issues: three multilingual offered-target expectations and host-revert ambiguity seeds 227/440.
- Baseline scratch initially missed the repo-level audit fixtures and produced eight file-not-found issues. Adding a fixture symlink, without code/input changes, resolves those setup errors; the complete baseline suite then passes. Both attempts are disclosed; logs stay outside Git.
- Data regression discovery (`test_*data.py`): **11 tests pass**. All three dictionary byte hashes are unchanged from base; see freeze manifest. No raw corpus/build log/xcresult is committed.
- Native controller execution is **unavailable/unexecuted by task ownership constraint**. No device is listed, opened, booted, installed or driven; no deployment or native-runtime acceptance is asserted. Parent must coordinate ownership before any such work.

## Reproduction and costs

Committed artifacts contain all synthetic inputs, original full expected documents, baseline/candidate automatic and raw full outputs, pre-delimiter alternatives/proposals, learning/touch, protocol, exclusion list, manifests, summary and source review. Reports use one JSON object per case line for compact diffs; nothing is trimmed. Per-key timings remain outside Git; aggregate timings and costs are versioned in `costs.json`. The original source scratch package is `/tmp/pulpo-r15-baseline/PulpoKeyboardKit`; its engine source is verified byte-identical to base and its runner identical to selected. It shares immutable dictionary/audit fixtures through symlinks.

```sh
PK_R15_CASES="$PWD/apps/keyboard-ios/audits/technical-preservation-r15/development.json" \
PK_R15_REPORT=/tmp/r15-development.json \
swift test --package-path apps/keyboard-ios/PulpoKeyboardKit -c release \
  --filter TechnicalPreservationReplayTests

# Substitute heldout.json for the revealed set; use the original source plus
# the identical runner in a scratch package for baseline (same fixture layout).
python3 apps/keyboard-ios/audits/technical-preservation-r15/summarize.py
swift test --package-path apps/keyboard-ios/PulpoKeyboardKit -c release
python3 -m unittest discover -s apps/keyboard-ios/scripts -p 'test_*data.py'
```

Two pre-reveal syntax variants, one independent held-out author, two independent read-only source-review tasks; no hidden post-reveal tuning. Four development measurements (baseline and first variant, then baseline and selected with updated runner), two review diagnostic measurements and one held-out pair: **738 automatic engine replays plus 738 paired raw replays**, excluding focused/core regressions. Build wall times are local observations, approximately **219 seconds** across six substantive package builds, plus short test runs. The selected full core suite takes about **5.0 seconds** after build. No device minutes or keyboard network/model inference; provider token/billing costs are unavailable.

Selected development timing: 654 keys each; baseline/candidate median, p95 and maximum in `costs.json`. Held-out: 1,602 keys each; baseline median **0.085 ms**, p95 **1.592 ms**, max **3.918 ms**; candidate median **0.027 ms**, p95 **1.470 ms**, max **4.327 ms**. These are single developer-machine runs with cold/warm mixing, include insertion plus suggestion refresh, and make no statistical speed, extension-memory or physical-device claim. The visible policy adds a token scan for a subsequent Unix directory separator; existing last-token scanning already scales with token length.
