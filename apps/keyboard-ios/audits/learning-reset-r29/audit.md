# R29 — learned-word reset ownership (audit only)

No product change is accepted. Production is byte-for-byte baseline `9d6841e678ad19a8e961839a2a6f284da3752a66`; freeze/evidence commit `b7f92379`. No product candidate was implemented, so there are no candidate bytes to restore or inactive product patch to retain. The inactive development probes and deterministic counterevidence are retained here. No push, merge, deploy, simulator, physical device, parent checkout, engine, preview, Try It or Settings edits occurred.

The exposed hypothesis is confirmed for a background save from a separate process: a successful clear can be followed by restoration of pre-clear contents. This is a real public-API/filesystem reproduction of a source-permitted extension lifecycle, not an observed installed-iPhone failure or an estimate of frequency. Normal same-process preview navigation does not establish a controller bug.

## Freeze and independence

- The development contract was frozen before relevant source inspection: SHA256 `823325cbd3f50565a084d66f8335894647681a209550cadd88c31d7c3ccc6228`.
- `source-freeze.json` records exact hashes for 13 production/lifecycle files, the runners, and contract; all production bytes matched baseline before reveal and at final verification. Its historical raw-development-output hash remains a freeze witness; that working log was removed from the final tree and replaced with structured outcomes, without changing source, frozen executable inputs, or oracles.
- Independent source review task `pr782-r29-lifecycle-review-1` produced `source-review.md`, SHA256 `f52af714c3d476071d54c7612a7b97a022707471f18ec9ffaaa061afadb0a930`. This is a source review, not an independent execution. It supports the separate-process persistence defect and rejects a speculative preview/controller hook.
- Independent author task `pr782-r29-heldout-author-1` received only three hash-verified immutable files: executable contract `11ac09e43a14d669452a4ab268371e06d47e889f24f973259fe8b9c5bea72731`, runner `2f985aec3512d20464f07b1d7540c68529028ad5c340a7d047930a036741a31a`, static validator `60e575a90a776505da905e76f77160db588f50938498af735ea3e2c37eb1f25a`. No source, dev inputs, prior benches or outcomes were given. One draft, zero rejected attempts; static validation preceded sealing.
- Original heldout bytes are retained losslessly in `heldout.json.gz`: 35,267 uncompressed; SHA256 `6c0bb76ce5a1724433cdb6a9cf1686f1a59555a2b013d546ba09af8dc22e0c54`. `heldout-seal.json` records review and source freeze before the single reveal/execution. No source or harness tuning followed reveal. This is a baseline-only bench, not a paired improvement experiment.

## Actual lifecycle and deterministic evidence

`KeyboardController` retains one shared language stack per URL **within each process**. Its construction and `hostWillAppear` reload dictionary and touch storage. `hostDidDisappear` calls `KeyboardEngine.save(inBackground:true)`; engine first accepts pending learning, then queues full dictionary/touch snapshots. `AppModel.clearLearnedWords` constructs separate group-backed dictionary/touch objects, clears/resets, and saves. Their static queues cannot synchronize another process.

The ordinary preview route ends editing/removes the keyboard and saves before navigating to the clear button; app-process initialization waits for previous app-process dictionary saves. Reappearance reloads. The iPhone app disables multiple scenes. A clean retained dictionary's later plain save does nothing. Retention alone is not proof of reset resurrection in that route. Language switches share the personal dictionary and tap model; this storage has no EN/ES/bilingual selector.

The C test gate interposes only a standalone worker's Foundation atomic replacement syscall; no production source or private state is altered. Public operations seed/pin old words, save, pin another old word, and enqueue a background save. That executing write pauses immediately before atomic replacement. A second real process completes `clear()` and a fresh public read sees zero words. Releasing the prepared pre-clear write restores both old words. The retained writer then calls public reload and gets `false`: its own late write updated its stamp. There is **no post-clear learning** in this schedule and no synthetic notification. All waits are bounded pipe/select barriers; timeouts mean unavailable/failure, never success. There are no sleeps or clock-based ordering oracles.

`queued-write-results.json` preserves three recorded repetitions, all available and all failing reset preservation (empty → 2 old words; own reload false), 0.016–0.063 seconds each. One earlier exploratory repetition also failed; total executions 4, **one unique schedule**, not four discoveries. This proves real separate-process storage ordering; actual iOS suspension/termination frequency and behavior remain unmeasured. TouchModel has the analogous unconditional-write source path, but no tap resurrection runtime case was run. Group reset cannot erase an inaccessible extension-local fallback URL.

## Development and heldout outcomes

Eight unique frozen-contract development probes: 4 pass, 4 fail, 7 failed assertions. The first exploratory run contained 6 of these (2 pass/4 fail); the final 8-probe run contained all eight (4 pass/4 fail): 14 executions, 8 unique probes, 6 repeats. Structured outcomes and original output hash/path are in `development-results.json`; raw working logs stay under /tmp; the probes remain inactive as `development-probes.swift.txt`, outside the root suite.

Passing probes cover ordinary save → clear → appearance reload → new learning; no-URL learning/reset; own completed write/reload preserving later unsaved learning; failed background write retaining dirty state and retrying successfully after removing a filesystem blocker. They do not prove arbitrary process interleavings, app private-field policy, or touch reset.

Failing probes show dirty stale snapshot resurrection, valid post-clear learning carrying pre-clear contents back, ordinary external reload dropping unsaved local learning, and stale save undoing external learning/normalized forget. Arbitrary retained public-instance sequences are broader than the ordinary preview UI lifecycle; the cross-process gate above establishes the product-relevant defect separately.

The single heldout run has **18 unique/available schedules, 0 invalid/unavailable schedules; 11 pass, 7 fail; 109/133 checks pass, 24 fail**. Raw actual and expected values for all 133 checks are preserved in `heldout-results.json.gz` and were inspected, including every passing check in failing schedules. Failure IDs are h02/h03/h04/h05/h15/h17/h18; `heldout-summary.json` maps every failure to reset carryover, ordinary merge/reload loss, or overwritten forget/block decisions. These are correlated manifestations, not seven new bugs. No candidate exists, so there are no changed or fail→fail paired outcomes to omit.

Pass limits: h01 and h14 call save on clean stale writers, so their no-op saves do not establish active-writer safety. h10 covers the same-process queue only. EN, ES and mixed spellings exercise exact case/accent/forget and pair normalization; they do **not** count as three language stacks. No-URL cases retain memory behavior and create no persistence file; transient names survive clear and never reach fresh disk readers.

Author metadata retains **8 unsupported coverage categories** (including process suspension, fault injection, controller lifecycle, real language stacks, clocks, caret, ranking, synthetic notifications). These remain separate from the 18-schedule denominator; zero unsupported operations were invented or silently converted into executable cases. Failed-write retry is covered by a development probe and cross-process overlap by the separate gated reproduction, not by the JSON heldout adapter.

## Ownership decision and rejection boundary

Choose **observed ownership epochs** as the principled direction: reconcile on actual input ownership acquisition; reset revokes older epochs; old pending writes cannot commit; new learning in an observed current epoch survives. Ordinary same-epoch external changes require operation-aware reconciliation, including explicit forget/relearn and retry identity. A reset needs durable identity, not an inference from an empty file, inode change, or notification arrival time.

That policy cannot honestly satisfy the frozen contract's stronger requirement to distinguish all post-clear learning **before observing reset**. Compare W.learn(x) → external.clear → W.save with external.clear → W.learn(x) → W.save. Without another observation boundary, replaying the pending local mutation restores old learning in one schedule; discarding it loses new learning in the other. Local operation logs or delayed notifications alone do not supply that missing causal order; `lastUsed` timestamps are not a reset protocol. This is not a claim that a new shared observation mechanism is universally impossible. It rejects claiming the current API/lifecycle supplies one.

Therefore implementation was rejected **before a product candidate**, rather than changing the frozen oracle, throwing away every external writer, adding keystroke I/O, or disabling background saving. A future round must freeze an explicit epoch/ownership contract and an actual reset observation mechanism before authoring new heldouts. Cooperative cross-process transactions must validate at execution and commit, not merely enqueue; a process-local queue or unlocked pre-write check is insufficient. Stable sidecar locks or database transactions need platform/process evaluation and a non-hanging failure/retry policy; an atomic-file inode lock is invalidated by replacement. No lock, suspension, crash or partial-failure guarantees were validated here. Complete UI reset also includes tap adaptation and the two-store reset boundary; a dictionary-only fix cannot claim the whole promise.

## Checks, costs, and reproduction

Initial existing persistence suite: 3/3 pass, 7.22-second build / 0.008-second run. Final focused development build ~2 seconds / 0.007-second run, exits 1 intentionally with the four contract failures above. Root Debug run: 439 core tests, 9 issues including the same 5 known issues plus 4 timing-threshold failures; services 3/3 pass. Debug core runtime 150.400 seconds. Debug timing measurements were ~0.297-second suggester worst, ~0.557-second full-personal operation, ~0.299-second noisy-swipe worst, and ~0.294-second timed-glide worst. No production diff explains these thresholds, and no acceptance claim is based on that run. Release passed: 439 core tests with exactly the same 5 known issues, no additional issues, and services 3/3; 40.10-second build / 5.553-second core run. Exact command outcomes and counts are in `validation-summary.json`. No raw build/test logs are retained in the final Git tree.

The two Swift standalone executables compile the actual 24 Core sources (`swiftc -swift-version 5 -O`); the C gate uses `clang -dynamiclib`. All builds, test packages and raw working outputs are under temporary paths. Agent token/service cost is not exposed by returned T3 metadata; no estimate is substituted. Failed commands include the intentionally failing development runs, Debug timing run, and initial discovery queries for nonexistent Core/Shared/Tests and a misplaced TextNormalizer path (resolved by rg). No build failed and no device command was attempted. No continuous watchers were created.

From this baseline checkout, substitute a newly created temporary scratch directory for `/tmp/r29-replay`:

```sh
mkdir -p /tmp/r29-replay
clang -dynamiclib apps/keyboard-ios/audits/learning-reset-r29/queued-write-gate.c -o /tmp/r29-replay/gate.dylib
swiftc -swift-version 5 -O -o /tmp/r29-replay/worker apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardCore/*/*.swift apps/keyboard-ios/audits/learning-reset-r29/queued-write-worker.swift
python3 apps/keyboard-ios/audits/learning-reset-r29/queued-write-check.py /tmp/r29-replay/worker /tmp/r29-replay/gate.dylib
swiftc -swift-version 5 -O -o /tmp/r29-replay/bench apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardCore/*/*.swift apps/keyboard-ios/audits/learning-reset-r29/schedule-runner.swift
gzip -dc apps/keyboard-ios/audits/learning-reset-r29/heldout.json.gz > /tmp/r29-replay/heldout.json
python3 apps/keyboard-ios/audits/learning-reset-r29/validate-schedules.py /tmp/r29-replay/heldout.json
/tmp/r29-replay/bench /tmp/r29-replay/heldout.json
```

To independently repeat the focused probes without changing any checkout, copy PulpoKeyboardKit to a temporary directory excluding `.build`, copy `development-probes.swift.txt` into that temporary package's `Tests/KeyboardCoreTests/PersonalDictionaryResetR29Tests.swift`, then run `swift test --package-path <temporary-package> --scratch-path <temporary-build> --filter PersonalDictionaryResetR29Tests`. Expect exit 1 / four failing tests on the frozen baseline. The standalone JSON runner exits 0 after recording all outcomes; inspect its case/check booleans, not just its exit status.
