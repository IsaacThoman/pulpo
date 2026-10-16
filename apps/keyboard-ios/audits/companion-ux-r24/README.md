# R24 companion accessibility and navigation

Two evidence-backed companion fixes, frozen in `8f962784` before independent heldout reveal:

- An already-open editor now follows live system Dynamic Type changes. Baseline actual system Large → accessibility XXXL changed the editor trait but left its font at 17pt rather than the expected 53pt. Candidate reaches 53pt. Both preserve `Hola 👩🏽‍💻 café\nmañana`, selected UTF-16 range `[13,4]`, and actual first-responder/binding focus. Candidate replacement at the retained selection also succeeds.
- Try It now scrolls, and installed-mode guidance wraps fully. At the actual largest system size, baseline guidance rendered 104.7pt, visibly ending `touch a…`, despite exposing the full AX label. It needs 260.5pt. Candidate renders 260.7pt and a real scroll exposes the complete switching instruction above the keyboard. The setup branch also wraps; its button label retains a minimum 44pt height and explicit content shape. That branch's action/hit area was not independently exercised.

The underlying keyboard's fixed metrics and compact segmented labels remain intentional. No font-size-only defect claim is made. Cursor math, TextViewDocument lifetime, dictionaries/ranking, literal/path policy, correction and spacing were not changed. No push, physical deployment, parent checkout changes, or other simulator operations were performed.

## Freeze, review, and workflow evidence

Started clean at `0d5394c2aed76e55fb9db46291ebbec44e25f6f2`. `development.json` freezes six fresh development intents before implementation inspection (SHA256 `4fd7d9a48b16b63a90e7b688ec401c79baf524d739d3bca2cedba1fc49c99114`). Its exact proposed starting fixtures were not all executed: actual UI uses smaller observed drafts, while native counterchecks use separate explicit Unicode inputs. These are task exploration and developer reproductions, not six exact-case passes.

One independent author read no implementation/audits/device state and sealed six fresh workflows before candidate freeze. Two independent source reviewers challenged reflow, actual retained documents, focus and enabled-control assumptions, nested scrolling, and VoiceOver claims. Their findings and responses are in `review.json`; none inspected the sealed corpus or drove a device. Three child tasks total. Production SHA256 values in `pre-reveal-freeze.json` still match after reveal; no post-reveal product edits or heldout replays occurred.

Final scoped regression run: **11/11 methods**, consisting of eight existing DraftEditorTests, one actual TryItView native binding workflow, and two real UI regressions. The native workflow hosts Try It at 320×568, preserves a selected `café` inside an emoji/combining/multiline draft across all five field kinds and preview/system/preview modes, then dismisses, restores focus without a positioning tap, and replaces at the exact retained range. This is a small host viewport surrogate on iPhone 17, not a second physical/simulator device or full Home-route proof. The UI regressions measure/read the full guidance and complete multiline inner scrolling → installed mode/outer scrolling → Tips → dismissal → preview refocus → Clear → exact final `Ok`, including Clear enabled states.

The broader UI exploration reached Tips, all five fields, bilingual/Spanish settings, and one-handed move/expand. Initial baseline was 2/3 methods: one incorrect English `Hola` assumption encountered actual `Hole team`. Strengthened candidate checks then exposed three retained end-append misses: ` SiHola team` vs `Hola team si`, and twice ` OkHole team` vs `Hole team ok`. Tapping an editor positions the caret; it is not the non-positioning focus action assumed by those oracles. No caret/ranking fix was introduced. Exact failed expectations remain in `development-ui.swift.fixture` and `ui-misses.json`. The fixture is outside normal test discovery because these are unresolved exploration contracts, not product regression assertions; they are not counted in the 11 passing methods.

The first guidance frame check was also too permissive: AX's full-screen ScrollView frame included keyboard-occluded space. It passed while a screenshot still showed the sentence's end behind the keyboard. Before freeze, verification was corrected to drag in visible margin space and check against the inputView's top. The final screenshot shows the complete sentence above the keyboard. This harness miss remains recorded.

## Original R17 broad inputs: exposed development only

The original six broad inputs remain unchanged at `../editing-ux-r17/broad-heldout-authored.json`, SHA256 `ec2dca24e445fa2d9993d9b8dfd516f76859cf8b49a2c182cb824ea6a1421d02`. They were all historically unexecuted in R17, and reading/executing them here does not create blind gains.

The native adapter attempts each case and stops at the first action without a real fixture binding. Four cases execute five literal prefix actions total, all matching exact authored documents and selections on baseline and candidate. Two stop before any action. Twenty-two authored actions per version remain unavailable/unexecuted; **zero complete original UI workflows** pass. The adapter uses production PreviewHost.document and real UITextView, without an engine or language setting; it does not simulate absent onboarding steps, Shift-arrow UI, offscreen draft access, or selection controls. It records outcomes rather than equating one successful XCTest method with six workflow passes. `r17-exposed-prefix-results.json` retains per-action outcomes and original expectation references.

The unchanged R17 `testBlindExploration` was also executed at actual AX5 after freeze, as exposed development only. Its XCTest method completes, but full-document comparison gives 2/4 matches: `Hola team ok` and Clear/search → `Hi` match; `Hello\nWorld\nOk` misses the frozen lowercase `world`, and `Hola familiasol` misses selected replacement `Sol` because the adapter did not establish selection. Every AX selection remains unavailable. `r17-exposed-ui-results.json` retains the original oracles and actuals. The unchanged one-handed persistence/settings method confirms launch persistence, then fails its bounded six-scroll reachability assertion for the setting at AX5; change/return stages remain unexecuted. No product impossibility is inferred from that harness bound. These outcomes remain separate from the original six broad authored cases and the 11 passing regressions.

## Fresh heldout accounting

Corpus remains outside Git at `/tmp/pulpo-r24-sealed/heldout.json`, SHA256 `c9b6e19365547fc039e300f6e52baad50989d8029a9df017f85b284adae35ab5`. It was revealed only after `8f962784`. Original expectations were not repaired.

Five cases have unavailable feature preconditions: draft editor/preview pair, qualifying independent two-field workflow with semantic dismissal, secure form with reversible help/settings navigation, explicit read-only draft presentation, and staged settings with discard-capable Cancel. Existing input-source preview, credential forms, Tips, and immediate-apply settings were not substituted for those features. See `heldout-binding.json` for each binding decision.

The language-settings case was attempted **once per version** with the same test adapter. Both enter the exact 28-unit multilingual draft, then fail to expose Select All after long press. Exact initial selection cannot be established; all four authored workflow actions remain unexecuted. Both commands exit 65. No replay, locator repair, or product tuning followed. Exact stored selections, offscreen documents, smallest supported viewport, and real VoiceOver are additionally unverified. **Zero complete fresh workflows executed or passed; no new blind gain is claimed.** Per-case limitations/failures are in `heldout-results.json`; raw UI reports and screenshots remain outside Git.

## Environment, reproduction, and limits

T3 device_list/device_open reported `Device list failed: The device command failed (exit code 127).` Repository XCTest/CoreSimulator fallback used exclusively iPhone 17 `1EDC5D9A-7E25-432A-B5B1-9A8B702306A7`. Every native run used separate R24 derived data, serialized execution, `-parallel-testing-enabled NO -collect-test-diagnostics never`. The hardware helper was pinned to this UUID and left hardware keyboard disabled as received. Actual system content_size was verified as accessibility-extra-extra-extra-large; no size launch argument or native trait override established the live-size result. Restore system size to its original `large` on release.

From this checkout, while exclusively owning the simulator:

```sh
python3 apps/keyboard-ios/audits/companion-ux-r24/run.py live --output /tmp/r24-repro-live
python3 apps/keyboard-ios/audits/companion-ux-r24/run.py regression --output /tmp/r24-repro-regression
python3 apps/keyboard-ios/audits/companion-ux-r24/run.py exposed --output /tmp/r24-repro-exposed
python3 apps/keyboard-ios/audits/companion-ux-r24/run.py heldout --heldout /tmp/pulpo-r24-sealed/heldout.json --output /tmp/r24-repro-heldout
```

`heldout` intentionally fails at its retained binding failure. Live and heldout methods explicitly skip outside their external-runner context; they were executed in this audit, and their conditional skips do not affect the parent's separate open retention test. To reproduce the three original exploration misses, copy `development-ui.swift.fixture` over the matching UITests file in a disposable archive and select its original methods. Do not replace the active regression tests in an integration checkout.

Raw build logs, xcresults, screenshots, full AX trees, baseline source archive and corpora stay in `/tmp/pulpo-r24` or `/tmp/pulpo-r24-sealed`. Logs were inspected only after indicated nonzero exit. `runs.json` records every completed run's test-method outcomes and xcresult duration; those durations include launch overhead and are not latency benchmarks. Exact derived-data/archive sizes and method totals are in `costs.json` (about 835 MiB for the two build caches). Three child tasks; token/currency costs unavailable. No data bundle or learning-storage cost changed, and runtime reflow cost was not benchmarked.

Real VoiceOver traversal/speech, live Bold Text, installed extension secure-field behavior, physical small-screen/one-handed comfort, full selected Home/Tips/settings navigation, and the disabled-keyboard setup branch remain unproven. Existing labels are preserved, not asserted to establish VoiceOver usability. The parent 47/48 result's open standalone consumer-retention countercheck belongs to R23 and was not fixed, skipped, or counted green here. PR782 is linked; integration and push remain the parent's work.
