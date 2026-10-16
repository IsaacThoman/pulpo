# Multilingual keyboard resource sweep

## Independently frozen acceptance benchmark

Frozen on 2026-10-16 before reading application source, test source, or audits. Base commit: 8e3bc1e1a83606cbb66cfc090e9abd44af61baa0. This document is owned by the resource sweep; parent QUALITY_AUDIT and other sweep findings are excluded.

Target: spare iOS 27 iPhone 18 Pro simulator 7E1D7979-7307-4C53-8466-BB41154B383C only. Native UI tests run serially. Simulator process memory is a simulator observation, never physical iPhone memory or evidence of a Gboard advantage. No physical deployment.

### Protocol and objective bounds

Measure the same release/configuration, simulator, fixtures, and invocation before and after. Collect at least three fresh-process cold samples per mode and five warm passes per mode where practicable. Report every sample, median, maximum, units, and measurement boundary; do not silently discard startup outliers. Cold means newly launched process with in-process caches absent; persistent vocabulary is separately reset or explicitly seeded. Warm means the same process after a complete prior pass. Distinguish engine/resource timings from visible keyboard/UI timings. Cold system disk caches are not promised. Native-test wall clock is not keystroke latency.

Acceptance gates fixed before optimization:

- Correctness/safety: zero crashes, hangs, lost/duplicated typed characters, mode mismatches, changed expected correction outputs, or learned-word cross-test contamination. No changes to dictionaries, language/compiler settings, ranking, dictation, Shift, existing frozen corpora, or parent QUALITY_AUDIT.
- Interaction cost: ordinary typing requires no extra taps; mode choice at most two taps once its chooser is visible; emoji open at most one tap, search focus at most one additional tap, insert at most one tap after a result is visible; dismissal/reappearance must retain selected mode and usable keyboard. Count taps independently of test synchronization waits.
- Latency: resource/engine request p95 <= 50 ms warm and <= 500 ms cold; mode switch resource readiness <= 500 ms warm and <= 1,500 ms first use; visible keyboard/emoji appearance or reappearance <= 1,500 ms, with any slower XCTest synchronization overhead identified separately. No claimed latency improvement from a timer that excludes the changed work.
- Memory/resource bounds: simulator resident memory <= 150 MiB for the measured keyboard-related test/host process (identify process precisely), post-warmup growth <= 10 MiB after 20 mode/emoji/dismissal cycles; persistent vocabulary test fixture <= 256 words; resource caches bounded by three supported modes or the finite built-in asset set. If process memory cannot be attributed to the extension, say so and use deterministic residency/load counters as complementary evidence, not a replacement disguised as RSS.
- Fix admission: a resource fix must remove measured redundant repeated work or demonstrate >= 10% median improvement in a directly affected measurement, preserve safety gates, and add a clear finite bound. Noise-level latency changes do not qualify. No acceptance thresholds may be relaxed after inspection. A failed or unmeasurable gate is reported, not retroactively passed.

### Development workloads (allowed for tuning)

D1 — English: fresh English mode; type `Please bring the blue folder at nine. We can meet near the library.`; request suggestions after each word and at prefixes `ple`, `brin`, `lib`; repeat warm five times.

D2 — Spanish: fresh Spanish mode; type `Mañana podemos tomar café junto al río. Lleva también el cuaderno azul.`; request suggestions after each word and prefixes `mañ`, `caf`, `cuad`; repeat warm five times. Preserve accents in the fixture.

D3 — bilingual: fresh English+Spanish mode; type `Please trae el cuaderno azul. Tomorrow tomamos café near the library.`; request suggestions at every word boundary plus `tom`, `lib`, `cua`; repeat warm five times.

D4 — switching/learning: cycle English → Spanish → bilingual → English 20 times in one process; after switching, request `ca`, `th`, `ma`. Seed 128 synthetic unique learned words (`devlex000` through `devlex127`), then query first/middle/last entries and repeat after resource reload. Existing production learning semantics remain unchanged.

D5 — emoji/lifecycle: open emoji, browse three categories, search `coffee`, clear, search `smile`, insert one result, return to letters, dismiss and reappear. Repeat 20 times; sample resources/memory before warmup, after warmup, and after cycles. Verify mode preservation. UI cost uses manual XCTest button taps where available; direct engine calls do not establish UI tap counts.

### Held-out workloads (run only after final candidate is fixed)

H1 — cold and warm mode passes with `A quiet train leaves before sunset. Pack the green notebook.`, `El sábado llega mi prima. Buscamos una mesa cerca del jardín.`, and `My prima arrives el sábado. Bring una chaqueta for the train.` respectively; prefixes `qui`, `jar`, `cha`.

H2 — reverse switching: bilingual → Spanish → English → bilingual for 20 cycles; request `re`, `pa`, `co`; use a separate 128-word fixture (`holdlex000` through `holdlex127`), checking first/middle/last retrieval after reload.

H3 — emoji/lifecycle: browse categories in reverse, search `train` and `heart`, insert, dismiss/reappear twice per selected mode for 20 cycles; verify mode and text retention. Use identical measurement boundaries and gates.

Held-out strings and sequences must not be used to tune implementation. If instrumentation cannot execute part of the protocol, retain the missing part as a limitation. New harness code may encode the frozen fixtures; existing corpora must remain untouched.

## Execution and findings

### Ownership, environment and measurement limits

- Worktree: `t3/multilingual-resource-sweep`, based on `8e3bc1e1a83606cbb66cfc090e9abd44af61baa0`; benchmark freeze `ac8b2a1d`; harness `693d3ce2`; final implementation frozen in `d18ec33a375d93d197e458d552ed5c5d1b592d73` before either held-out binary was evaluated. The paired workload file has unchanged Git blob `f0cc6971d82c4caf06b91b6ae99e0de2509a3b42` on both sides.
- Only production change: the saved-scroll-position block in `PulpoKeyboardKit/Sources/KeyboardUI/EmojiPanelView.swift`. Prepare collection layout geometry, set the clamped saved offset, then let UIKit create cells at that position. The old path created cells/images at the start before restoring the offset. Cache limits and release behavior remain unchanged: picker raster cache 48, search raster cache 24, search results 48 (core ceiling 60), recents 32. These bound caches, not total UIKit/OS memory.
- No `KeyboardEngine` or `KeyboardController` edits. This has no textual conflict with the parent's pending spacing follow-up; the parent should still rerun its integrated UI checks after cherry-picking. No dictionaries, language/compiler configuration, correction ranking, dictation workflow, Shift, existing corpora, parent QUALITY_AUDIT, or other sweep findings were changed or used for tuning. No further agents, physical deployment, or PR push.
- Simulator only: iOS 27.0 / build 24A434, arm64, iPhone 18 Pro `7E1D7979-7307-4C53-8466-BB41154B383C`; Xcode 27.1 / 27A9275 with iOS Simulator 27.1 SDK. The parent's iPhone 17 was not driven, built to, reset, or otherwise modified.
- T3 `device_list`, followed by `device_open` for the designated simulator, both exposed the raw limitation: `Device list failed: The device command failed (exit code 127).` The Device panel could not attach. Used the repository XcodeGen/XCTest workflow on the designated simulator instead.
- Release `build-for-testing` failed because existing UI tests import modules with `@testable`, while Release modules are built without `-enable-testing`. Kept compiler settings unchanged and used the repository scheme's default **Debug** XCTest configuration for every paired measurement. These timings are Debug simulator observations, not optimized Release or physical iPhone performance.
- RSS comes from `MACH_TASK_BASIC_INFO.resident_size` on the **XCTest UI runner**, which loads KeyboardCore and KeyboardUI and owns the harness window. It is neither extension-only RSS nor physical iPhone memory, and is not a Gboard comparison. A sample maximum is not an OS high-water mark. No physical-device memory acceptance is established here.
- Three distinct runner PIDs per mode/partition/side establish process-cold samples via `-test-iterations 3 -test-repetition-relaunch-enabled YES`. OS disk caches and persisted OS glyph-support compatibility results may be warm. No timing outliers are discarded.
- An exploratory harness initially lacked a per-cycle autorelease pool, making its cycle growth unreliable. Stopped that run, added pools for both switching and UIKit cycles, and reran the complete paired baseline. The final paired harness is identical on both sides. Preliminary outputs are excluded from acceptance numbers and retained under `/tmp/pulpo-resource-sweep` for inspection.
- Component stack-switch loops construct each requested resource, including consecutive repeated modes. Live controller mode-switch timings separately include its normal no-op when selecting the current mode; maximum timings still bound the actual switches. Reappearance timings use the normal live controller lifecycle.
- Text workloads use normal engine character/space methods and obtain suggestions for each character. Ordinary learning is disabled in this fixture phase; the separate learning phase pins exactly 128 synthetic words, saves/reloads them, checks first/middle/last retrieval and cross-partition exclusion, and preserves the same personal/touch objects through switches. No production learning behavior changed.
- Independent review identified a historical measurement-label error: `cold.firstPrediction` and `warm.firstPrediction` time only `engine.documentDidChange()`, which attaches/refreshes document state and marks suggestions stale. They do not evaluate predictions. Future harness reports use `cold.documentAttachment` and `warm.documentAttachment` for the same operation; historical reports, metrics, hashes and table values retain their original names. A separate cold initial-prediction measurement is missing, so those historical labels establish no prediction-latency gate. The actual `keyAndSuggestions` boundary includes both the key edit and the subsequent `engine.suggestions` evaluation, including real inference, but does not isolate initial-prediction latency.
- UIKit timings include synchronous actions and layout, including the changed resource work. They exclude compositor presentation and hardware event delivery. The 20-cycle lifecycle sequences use real controller/delegate callbacks; they do not establish a full 20-cycle finger-tap UI latency bound. The separate accessibility probe verifies the actual controls and text/mode preservation once per mode. A full installed-extension, end-to-end visible-latency run remains unmeasured.

### Proven change and development outcome

A dedicated collection-view data-source recorder reproduced redundant viewport construction across portrait/landscape and 2x/3x traits, three repetitions each. Before: 50 starting + 50 saved-position cell requests in portrait, 60 + 60 in landscape. After: **0 + 50** and **0 + 60** respectively, while the final visible item set and saved offset match the reference, including safe clamping of an oversized saved offset. This proves removal of bounded, unnecessary cell/image work without retaining resources across dismissal.

The probe's pooled median synchronous restoration cost was **150.045 → 57.095 ms** in portrait and **188.262 → 77.472 ms** in landscape. All twelve individual samples are included in the metrics artifact. This diagnostic uses synthetic emoji solely for resource/layout coverage; it is not a language-quality corpus.

In the full frozen development workload, pooled picker-open-plus-layout medians were **132.012 → 69.210 ms** (English, 47.57% less), **116.791 → 68.015 ms** (Spanish, 41.76%), and **123.342 → 67.890 ms** (bilingual, 44.96%). This exceeds the predeclared 10% admission threshold on each mode. The measured interval includes saved-offset restoration and cell creation on both sides.

Rejected experiment: sharing the existing 48-image raster cache across picker instances retained images while hidden and did not reliably meet the latency admission threshold in the full workload. It was removed entirely, including its warning observer and cache-specific tests. After three English and three Spanish runs, its pooled reopen medians were 132.890 and 128.158 ms respectively, versus baseline 132.012 and 116.791 ms; it failed admission and was stopped. No held-out workloads were run until after that experiment was discarded and the layout candidate committed.

### Functional verification and interaction cost

The baseline and final candidate each passed nine development resource test executions and the actual XCUI interaction probe. Candidate emoji regressions passed **18/18** tests: resource restoration, portrait/landscape glyph geometry, safe-area/inset geometry, category toolbar and recents, preview horizontal scrolling, emoji font pixel equivalence and bounded drawing, delete interruption/VoiceOver behavior, and search layout/query behavior. The installed-keyboard test requiring keyboard enablement was explicitly excluded; no installed-extension verification is claimed.

Actual XCUI actions in all three modes: choose mode with **2 taps total** (chooser then choice, **1** after chooser is visible), open emoji with **1**, focus search with **1**, insert a visible search result with **1**. Each query letter uses one normal key tap. Search preserves the host document until insertion; Home/activate reappearance retains the chosen mode and inserted text. Synchronization/idle waits are not reported as human interaction steps or keystroke latency.

Development typed text and every suggestion slot/kind/autocorrection output match before/after for all six passes in every mode and all three fresh-process repetitions. Only ephemeral per-request source-context UUIDs are excluded from equality comparisons. All learned-word, mode, search-isolation, emoji-release, text-preservation and lifecycle assertions pass. Held-out verification and final gate verdicts follow below.

### Reproduction

Build once with the unchanged default XCTest configuration, then keep a copy of `DerivedData/Build/Products` for each implementation (its `.xctestrun` paths are relative to `__TESTROOT__`):

```sh
xcodegen generate --spec apps/keyboard-ios/project.yml
xcodebuild -project apps/keyboard-ios/PulpoKeyboard.xcodeproj -scheme PulpoKeyboard \
  -destination 'platform=iOS Simulator,id=7E1D7979-7307-4C53-8466-BB41154B383C' \
  -derivedDataPath /tmp/pulpo-resource-sweep/DerivedData \
  -parallel-testing-enabled NO build-for-testing
python3 apps/keyboard-ios/scripts/run_multilingual_resources.py baseline \
  --derived-data /tmp/pulpo-resource-sweep/DerivedData --output /tmp/pulpo-resource-sweep/final-baseline --ui
# After the candidate build, use stage candidate and a fresh output directory.
# Only after the candidate is fixed, evaluate each preserved binary with:
python3 apps/keyboard-ios/scripts/run_multilingual_resources.py heldout --held-out \
  --derived-data /tmp/pulpo-resource-sweep/DerivedData --output /tmp/pulpo-resource-sweep/heldout-baseline \
  --xctestrun /tmp/pulpo-resource-sweep/BaselineProducts/PulpoKeyboard_iphonesimulator27.1-arm64.xctestrun
```

Use new output directories for every run. The runner script rejects an unexpected fresh-process report count. All native invocations use `-parallel-testing-enabled NO`. The viewport diagnostic runs `EmojiPresentationResourceTests` with `TEST_RUNNER_PK_RESOURCE_BASELINE_VIEWPORT=1` on the unmodified source, and with that variable absent on the candidate. `TEST_RUNNER_PK_VIEWPORT_REPORT` records its raw samples. Raw XCTest logs, xcresults, complete suggestion traces, baseline/candidate binary copies and run reports are retained at `/tmp/pulpo-resource-sweep`; committed metrics retain every final timing/RSS sample and report checksum.

### Held-out result and final gate verdicts

The implementation stayed fixed at `d18ec33a` throughout held-out evaluation. Both preserved binaries passed all nine held-out resource executions. Every held-out typed sentence equals its frozen input, and all suggestion slots/kinds/autocorrections match before/after across six passes and three fresh processes per mode, excluding only ephemeral source-context UUIDs. The separate 128-word held-out fixture survives save/reload and switching without finding development-only vocabulary. Reverse category browsing, train/heart search, insertion isolation, and twice-per-cycle dismissal/reappearance assertions pass in each measured mode.

Held-out pooled picker-open-plus-layout medians: **190.451 → 100.175 ms** (English, 47.40% less), **173.384 → 82.185 ms** (Spanish, 52.60%), **143.857 → 83.421 ms** (bilingual, 42.01%). No production or workload changes followed these results.

The complete paired evaluation is **36 resource executions**, two actual XCUI interaction probes (before/after, each covering all three modes), and **18 passing candidate emoji regressions**. The viewport counter separately records all twelve before and twelve after scenarios. These passing test executions establish functional assertions; they do **not** mean every frozen acceptance gate passed.

- **Safety passes for this workload:** zero crashes/hangs/assertion failures; all 216 typed passes equal their frozen input; all public suggestion/correction traces match; mode selection, vocabulary sharing/reload, search isolation, emoji release and document retention assertions pass. This establishes behavior for these workloads, not an exhaustive language-quality guarantee.
- **Measured engine/cold resource bounds pass:** worst candidate pooled warm key-plus-suggestions p95 **32.715 ms** (maximum **47.709 ms**); prefix p95 **2.745 ms**. Candidate cold stack maximum **13.047 ms**, catalog decode **8.748 ms**, index build **78.149 ms**, cold key-plus-suggestions **43.400 ms**. Each is below its relevant 50 ms warm / 500 ms cold gate. This verdict covers those measured operations; separate cold initial-prediction latency remains unmeasured.
- **Mode readiness bounds pass for the measured synchronous boundary:** live controller switching maximum **15.677 ms**, below both the 500 ms warm and 1,500 ms first-use limits. Full component-switch samples are in the raw artifact; mixed live selection samples include normal no-ops, and the maximum still bounds actual switches.
- **Generic warm resource gate is not fully met:** interpreting the frozen 50 ms resource bound conservatively to include picker rendering, candidate picker-open-plus-layout p95 reaches **123.762 ms**, and category work p95 **108.851 ms**. The fix materially reduces work but does not make all warm UI resource operations fit 50 ms in Debug.
- **Visible appearance/reappearance gate remains unmeasured:** synchronous candidate picker open/layout maximum **172.527 ms** and reappearance/layout maximum **16.671 ms** are within 1,500 ms, but exclude compositor and event delivery. The actual XCUI probe verifies controls/state without a trustworthy presentation timer. No full installed-extension or physical-device latency claim is made.
- **150 MiB simulator process bound fails:** the runner already starts at **267.172–269.250 MiB** before resource construction. Candidate sampled peak ranges are **356.156–357.594 MiB** in development and **356.141–357.672 MiB** held-out; baseline ranges are **355.875–357.266** and **356.516–358.234 MiB**. These are XCTest runner RSS, not extension-only or physical iPhone memory. No memory reduction claim is justified by these small peak differences.
- **10 MiB post-warmup growth bound fails:** baseline development **4.734–31.672 MiB** (6/9 failures), candidate development **30.234–31.781 MiB** (9/9); held-out baseline **5.500–32.047 MiB** (4/9), held-out candidate **4.688–32.453 MiB** (7/9). All cycle samples are preserved. The first-cycle warmup is kept exactly as frozen; later plateauing does not convert these failures into passes. The harness cannot attribute this runner-wide settling to the installed keyboard or prove an extension leak.
- **Finite resource and interaction limits pass at their measured boundary:** existing raster/result/recent bounds are unchanged, learning fixtures are 128 words each (below 256), and no cache was added. Actual tap counts meet the frozen interaction budgets. Complete 20-cycle real-finger/installed-extension interaction and compositor timing remain outside this run.

Overall acceptance is **incomplete** because the resource/memory gates above fail or are unmeasured. The retained fix qualifies independently by eliminating 50/60 unnecessary cell requests and exceeding the predeclared 10% median improvement on both development and held-out workloads, while preserving the measured behavior and adding no retained resource cost. Do not infer physical iPhone memory, Release timing, or a Gboard advantage from these results.

### Full paired measurements

All raw timing/RSS samples, per-run process IDs, report checksums, pooled distributions and trace comparison results are in [multilingual-resources-metrics.json](multilingual-resources-metrics.json). No outliers are dropped. Pooled median is the arithmetic middle; p95 is nearest rank. Timing cells below are median / p95 / maximum in ms. Each side has three fresh processes per mode, with five warm typing passes and 20 post-warmup lifecycle cycles per process.

The tables retain the historical `cold.firstPrediction` label.[^document-attachment]

[^document-attachment]: These rows measure only document attachment/state refresh via `documentDidChange()`, not prediction computation. No separate cold initial-prediction measurement was recorded. Actual inference is included in the key-edit-plus-suggestions timings; future reports name the attachment operation `documentAttachment`.

#### development — en_US

| Measurement | Before med / p95 / max | After med / p95 / max |
| --- | --- | --- |
| cold.stack | 7.598 / 10.360 / 10.360 | 7.135 / 7.808 / 7.808 |
| cold.emojiDecode | 7.266 / 7.887 / 7.887 | 6.760 / 6.802 / 6.802 |
| cold.emojiIndex | 62.879 / 66.906 / 66.906 | 55.239 / 55.766 / 55.766 |
| cold.firstPrediction | 0.064 / 0.467 / 0.467 | 0.058 / 0.218 / 0.218 |
| cold.keyAndSuggestions | 1.461 / 15.440 / 25.294 | 1.363 / 13.755 / 23.037 |
| warm.keyAndSuggestions | 1.447 / 15.181 / 26.168 | 1.368 / 13.940 / 24.059 |
| warm.prefixSuggestion | 1.218 / 3.001 / 3.273 | 1.165 / 2.745 / 3.140 |
| controller.init | 84.937 / 85.051 / 85.051 | 58.504 / 65.054 / 65.054 |
| controller.modeSwitch | 1.893 / 2.968 / 4.183 | 1.673 / 2.521 / 3.197 |
| controller.emojiOpenAndLayout | 132.012 / 165.170 / 290.998 | 69.210 / 87.365 / 89.232 |
| controller.emojiCategory | 71.020 / 91.010 / 167.506 | 62.619 / 73.738 / 81.164 |
| controller.searchKeyAndLayout | 2.692 / 12.943 / 21.627 | 2.360 / 11.168 / 21.304 |
| controller.dismiss | 0.056 / 0.110 / 0.161 | 0.050 / 0.066 / 0.136 |
| controller.reappearAndLayout | 4.782 / 16.780 / 20.063 | 4.092 / 11.549 / 12.473 |
| learn.seed128 | 0.150 / 0.221 / 0.221 | 0.140 / 0.142 / 0.142 |
| learn.save | 2.576 / 2.755 / 2.755 | 2.020 / 2.754 / 2.754 |
| learn.reload | 0.343 / 0.435 / 0.435 | 0.320 / 0.343 / 0.343 |
| learn.query | 0.002 / 0.012 / 0.012 | 0.001 / 0.007 / 0.007 |

#### development — es

| Measurement | Before med / p95 / max | After med / p95 / max |
| --- | --- | --- |
| cold.stack | 4.077 / 4.139 / 4.139 | 4.439 / 5.087 / 5.087 |
| cold.emojiDecode | 6.466 / 6.544 / 6.544 | 6.719 / 6.914 / 6.914 |
| cold.emojiIndex | 52.817 / 59.278 / 59.278 | 51.412 / 56.131 / 56.131 |
| cold.firstPrediction | 0.058 / 0.066 / 0.066 | 0.057 / 0.099 / 0.099 |
| cold.keyAndSuggestions | 1.299 / 15.401 / 19.222 | 1.240 / 14.602 / 18.605 |
| warm.keyAndSuggestions | 1.300 / 15.576 / 23.569 | 1.268 / 15.278 / 22.165 |
| warm.prefixSuggestion | 0.994 / 1.483 / 2.135 | 1.009 / 1.481 / 1.795 |
| controller.init | 59.857 / 108.414 / 108.414 | 56.378 / 62.050 / 62.050 |
| controller.modeSwitch | 2.154 / 2.749 / 3.306 | 2.153 / 2.633 / 3.347 |
| controller.emojiOpenAndLayout | 116.791 / 141.060 / 181.828 | 68.015 / 86.426 / 131.008 |
| controller.emojiCategory | 62.582 / 73.990 / 90.486 | 61.791 / 76.904 / 168.358 |
| controller.searchKeyAndLayout | 2.360 / 11.177 / 15.671 | 2.305 / 11.041 / 29.886 |
| controller.dismiss | 0.050 / 0.066 / 0.137 | 0.052 / 0.063 / 0.080 |
| controller.reappearAndLayout | 4.106 / 11.669 / 19.136 | 4.054 / 10.827 / 12.787 |
| learn.seed128 | 0.148 / 0.150 / 0.150 | 0.140 / 0.149 / 0.149 |
| learn.save | 2.447 / 2.600 / 2.600 | 2.220 / 2.438 / 2.438 |
| learn.reload | 0.325 / 0.327 / 0.327 | 0.322 / 0.326 / 0.326 |
| learn.query | 0.001 / 0.010 / 0.010 | 0.001 / 0.008 / 0.008 |

#### development — en_es

| Measurement | Before med / p95 / max | After med / p95 / max |
| --- | --- | --- |
| cold.stack | 6.692 / 9.909 / 9.909 | 5.837 / 6.096 / 6.096 |
| cold.emojiDecode | 6.787 / 6.850 / 6.850 | 6.131 / 6.171 / 6.171 |
| cold.emojiIndex | 56.570 / 58.343 / 58.343 | 51.421 / 51.895 / 51.895 |
| cold.firstPrediction | 0.057 / 0.058 / 0.058 | 0.052 / 0.056 / 0.056 |
| cold.keyAndSuggestions | 2.500 / 30.477 / 36.339 | 2.240 / 28.405 / 34.275 |
| warm.keyAndSuggestions | 2.304 / 30.577 / 38.644 | 2.242 / 29.468 / 41.102 |
| warm.prefixSuggestion | 1.395 / 2.624 / 2.652 | 1.280 / 2.222 / 2.322 |
| controller.init | 67.106 / 77.463 / 77.463 | 59.317 / 67.974 / 67.974 |
| controller.modeSwitch | 2.321 / 3.013 / 3.466 | 2.137 / 3.075 / 15.677 |
| controller.emojiOpenAndLayout | 123.342 / 149.268 / 160.355 | 67.890 / 97.890 / 142.612 |
| controller.emojiCategory | 66.278 / 78.893 / 83.586 | 61.597 / 89.379 / 115.149 |
| controller.searchKeyAndLayout | 2.541 / 12.221 / 16.386 | 2.273 / 10.852 / 16.382 |
| controller.dismiss | 0.053 / 0.065 / 0.072 | 0.046 / 0.068 / 0.103 |
| controller.reappearAndLayout | 4.218 / 11.743 / 19.049 | 3.860 / 10.972 / 13.790 |
| learn.seed128 | 0.136 / 0.151 / 0.151 | 0.137 / 0.147 / 0.147 |
| learn.save | 2.330 / 2.492 / 2.492 | 2.155 / 2.206 / 2.206 |
| learn.reload | 0.285 / 0.335 / 0.335 | 0.291 / 0.297 / 0.297 |
| learn.query | 0.001 / 0.010 / 0.010 | 0.001 / 0.007 / 0.007 |

#### heldout — en_US

| Measurement | Before med / p95 / max | After med / p95 / max |
| --- | --- | --- |
| cold.stack | 12.985 / 18.225 / 18.225 | 12.564 / 13.047 / 13.047 |
| cold.emojiDecode | 9.864 / 13.169 / 13.169 | 8.002 / 8.748 / 8.748 |
| cold.emojiIndex | 89.048 / 141.551 / 141.551 | 77.633 / 78.149 / 78.149 |
| cold.firstPrediction | 0.088 / 0.588 / 0.588 | 0.080 / 0.278 / 0.278 |
| cold.keyAndSuggestions | 2.816 / 29.052 / 49.045 | 2.097 / 19.817 / 33.916 |
| warm.keyAndSuggestions | 2.399 / 29.071 / 77.330 | 2.092 / 21.738 / 34.092 |
| warm.prefixSuggestion | 1.016 / 7.902 / 7.902 | 0.897 / 1.448 / 1.448 |
| controller.init | 136.070 / 200.822 / 200.822 | 107.159 / 130.121 / 130.121 |
| controller.modeSwitch | 3.263 / 4.502 / 5.307 | 2.782 / 3.695 / 12.471 |
| controller.emojiOpenAndLayout | 190.451 / 225.368 / 234.461 | 100.175 / 123.762 / 172.527 |
| controller.emojiCategory | 102.360 / 120.337 / 143.511 | 92.484 / 108.851 / 155.833 |
| controller.searchKeyAndLayout | 11.403 / 19.447 / 30.068 | 9.915 / 16.858 / 22.982 |
| controller.dismiss | 0.076 / 0.158 / 0.492 | 0.070 / 0.099 / 0.316 |
| controller.reappearAndLayout | 7.489 / 10.681 / 15.736 | 6.285 / 8.499 / 16.671 |
| learn.seed128 | 0.259 / 0.276 / 0.276 | 0.243 / 0.289 / 0.289 |
| learn.save | 5.138 / 11.816 / 11.816 | 2.755 / 3.615 / 3.615 |
| learn.reload | 0.381 / 0.437 / 0.437 | 0.348 / 0.437 / 0.437 |
| learn.query | 0.003 / 0.021 / 0.021 | 0.002 / 0.012 / 0.012 |

#### heldout — es

| Measurement | Before med / p95 / max | After med / p95 / max |
| --- | --- | --- |
| cold.stack | 10.223 / 11.443 / 11.443 | 5.575 / 8.660 / 8.660 |
| cold.emojiDecode | 8.853 / 9.738 / 9.738 | 7.411 / 7.426 / 7.426 |
| cold.emojiIndex | 76.411 / 78.492 / 78.492 | 59.811 / 60.959 / 60.959 |
| cold.firstPrediction | 0.080 / 0.084 / 0.084 | 0.065 / 0.065 / 0.065 |
| cold.keyAndSuggestions | 1.665 / 12.571 / 21.283 | 1.226 / 10.899 / 16.316 |
| warm.keyAndSuggestions | 1.398 / 12.792 / 20.036 | 1.191 / 10.339 / 16.376 |
| warm.prefixSuggestion | 0.920 / 1.196 / 1.196 | 0.848 / 0.928 / 0.928 |
| controller.init | 88.807 / 123.221 / 123.221 | 74.676 / 78.362 / 78.362 |
| controller.modeSwitch | 2.881 / 3.674 / 12.909 | 2.544 / 3.155 / 12.587 |
| controller.emojiOpenAndLayout | 173.384 / 207.658 / 215.491 | 82.185 / 107.628 / 114.691 |
| controller.emojiCategory | 91.994 / 105.781 / 152.215 | 74.247 / 87.884 / 97.801 |
| controller.searchKeyAndLayout | 9.896 / 16.858 / 49.023 | 7.948 / 13.409 / 17.629 |
| controller.dismiss | 0.070 / 0.097 / 0.184 | 0.060 / 0.085 / 0.097 |
| controller.reappearAndLayout | 6.358 / 8.596 / 16.648 | 5.395 / 9.122 / 15.837 |
| learn.seed128 | 0.249 / 0.251 / 0.251 | 0.231 / 0.284 / 0.284 |
| learn.save | 2.867 / 2.932 / 2.932 | 2.624 / 2.747 / 2.747 |
| learn.reload | 0.364 / 0.392 / 0.392 | 0.336 / 0.376 / 0.376 |
| learn.query | 0.002 / 0.012 / 0.012 | 0.002 / 0.012 / 0.012 |

#### heldout — en_es

| Measurement | Before med / p95 / max | After med / p95 / max |
| --- | --- | --- |
| cold.stack | 8.235 / 9.126 / 9.126 | 8.397 / 8.669 / 8.669 |
| cold.emojiDecode | 7.389 / 8.036 / 8.036 | 7.763 / 8.027 / 8.027 |
| cold.emojiIndex | 61.965 / 63.500 / 63.500 | 64.220 / 71.072 / 71.072 |
| cold.firstPrediction | 0.066 / 0.073 / 0.073 | 0.068 / 0.072 / 0.072 |
| cold.keyAndSuggestions | 2.201 / 32.937 / 47.955 | 1.874 / 33.008 / 43.400 |
| warm.keyAndSuggestions | 1.795 / 32.528 / 46.645 | 1.844 / 32.715 / 47.709 |
| warm.prefixSuggestion | 1.381 / 1.546 / 1.546 | 1.354 / 1.654 / 1.654 |
| controller.init | 85.578 / 92.012 / 92.012 | 79.340 / 81.801 / 81.801 |
| controller.modeSwitch | 2.403 / 3.018 / 9.887 | 2.361 / 3.045 / 11.486 |
| controller.emojiOpenAndLayout | 143.857 / 176.272 / 185.314 | 83.421 / 102.466 / 110.036 |
| controller.emojiCategory | 76.172 / 87.852 / 122.159 | 77.090 / 91.056 / 105.401 |
| controller.searchKeyAndLayout | 8.404 / 13.351 / 15.441 | 8.044 / 13.750 / 16.592 |
| controller.dismiss | 0.062 / 0.082 / 0.091 | 0.062 / 0.081 / 0.136 |
| controller.reappearAndLayout | 5.702 / 14.520 / 17.119 | 5.559 / 8.058 / 14.357 |
| learn.seed128 | 0.248 / 0.254 / 0.254 | 0.211 / 0.252 / 0.252 |
| learn.save | 2.880 / 2.939 / 2.939 | 2.449 / 3.202 / 3.202 |
| learn.reload | 0.337 / 0.341 / 0.341 | 0.332 / 0.388 / 0.388 |
| learn.query | 0.002 / 0.010 / 0.010 | 0.002 / 0.052 / 0.052 |

### Cold samples and simulator runner memory

Cold sample lists are stack creation in ms in filename/PID order. RSS and growth are MiB. Peak is the maximum sampled resident size, not an OS lifetime high-water mark. Growth is cycle 20 minus cycle 0, exactly as frozen; a negative value means pages were released.

| Partition / mode | Cold stack before → after (all 3) | Sampled peak RSS before → after | 20-cycle growth before → after (all 3) |
| --- | --- | --- | --- |
| development / en_US | 10.360, 7.598, 6.258 → 7.135, 5.809, 7.808 | 356.047 → 356.234 | 5.531, 31.656, 31.672 → 30.969, 30.516, 30.641 |
| development / es | 4.018, 4.077, 4.139 → 3.992, 4.439, 5.087 | 356.500 → 356.438 | 4.734, 31.672, 31.047 → 30.234, 31.109, 31.281 |
| development / en_es | 9.909, 6.114, 6.692 → 6.096, 5.837, 5.755 | 357.266 → 357.594 | 5.172, 31.656, 31.391 → 31.578, 30.766, 31.781 |
| heldout / en_US | 12.903, 18.225, 12.985 → 9.877, 12.564, 13.047 | 357.953 → 356.328 | 5.500, 6.000, 7.172 → 31.094, 4.688, 5.078 |
| heldout / es | 10.223, 11.443, 5.935 → 5.378, 5.575, 8.660 | 357.344 → 357.672 | 5.875, 6.234, 31.469 → 30.484, 30.531, 32.453 |
| heldout / en_es | 7.536, 9.126, 8.235 → 6.668, 8.397, 8.669 | 358.234 → 357.516 | 31.672, 31.844, 32.047 → 31.031, 31.016, 30.953 |
