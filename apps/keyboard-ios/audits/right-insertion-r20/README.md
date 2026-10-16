# R20 rejected insertion experiment

Read [audit.md](audit.md) for the parent rejection and limits. [agent-audit.md](agent-audit.md), the frozen protocols, inputs, original summaries/reviews, and historical scripts preserve original bytes. Four larger paired reports use deterministic gzip (`mtime=0`); the manifest records both stored hashes and exact decompressed original hashes. Links in the verbatim agent audit retain their historical `.json` names; use the corresponding `.json.gz` or extract them below.

```sh
python3 apps/keyboard-ios/audits/right-insertion-r20/verify.py
python3 -O apps/keyboard-ios/audits/right-insertion-r20/verify.py
python3 apps/keyboard-ios/audits/right-insertion-r20/verify.py --extract /tmp/r20-paired-reports
```

The verifier validates this bounded retained dataset, including full primitive replay for development, held-out and source controls. Those strings use one Unicode scalar per Swift Character; this is not a general Unicode editor oracle. The old R5 report lacks primitive/caret traces, so its verifier checks identity, exact document scores and counts only. No keyboard inference occurs. The historical `pair-v1.py` trusts several supplied fields and uses `assert` (disabled by `-O`); preserve it for provenance, not as an independent hardened validator. `run-swift-v1.py` is an opt-in historical command wrapper and records test summaries, not acceptance by itself.

For an explicitly authorized future replay, use temporary detached checkouts rather than current production. The following is documentation only; builds were not run during retention. Keep outputs outside Git. Reconstruct the rejected candidate from the retained patch, so replay does not depend on the original child branch's candidate commit being available in a clone.

```sh
AUDIT="$PWD/apps/keyboard-ios/audits/right-insertion-r20"
git worktree add --detach /tmp/r20-baseline f17109e7033eb849c9a2b98180e8c0f9d6174c3c
git worktree add --detach /tmp/r20-rejected f17109e7033eb849c9a2b98180e8c0f9d6174c3c
git -C /tmp/r20-rejected apply "$AUDIT/candidate-v1.patch"
cp "$AUDIT/RightInsertionR20Tests.swift.txt" /tmp/r20-baseline/apps/keyboard-ios/PulpoKeyboardKit/Tests/KeyboardCoreTests/RightInsertionR20Tests.swift
cp "$AUDIT/RightInsertionR20Tests.swift.txt" /tmp/r20-rejected/apps/keyboard-ios/PulpoKeyboardKit/Tests/KeyboardCoreTests/RightInsertionR20Tests.swift
```

Run those commands from the repository root. Verify runner and engine SHA-256s against `retained-manifest.json`; the reconstructed candidate engine must be `b9d11bd85692290a96e7798d2257e3b4b2cd3bd2ff12745ccd567d026dc93a1f`. The runner uses each checkout's unchanged bundled bilingual dictionary; no dictionary download or generation is needed. Run the original wrapper separately for each variant:

```sh
python3 "$AUDIT/run-swift-v1.py" \
  --package /tmp/r20-baseline/apps/keyboard-ios/PulpoKeyboardKit \
  --filter RightInsertionR20Tests --suite "$AUDIT/development-v1.json" \
  --results /tmp/r20-baseline-dev.json --summary /tmp/r20-baseline-dev-gate.json
python3 "$AUDIT/run-swift-v1.py" \
  --package /tmp/r20-rejected/apps/keyboard-ios/PulpoKeyboardKit \
  --filter RightInsertionR20Tests --suite "$AUDIT/development-v1.json" \
  --results /tmp/r20-rejected-dev.json --summary /tmp/r20-rejected-dev-gate.json
python3 "$AUDIT/pair-v1.py" "$AUDIT/development-v1.json" \
  /tmp/r20-baseline-dev.json /tmp/r20-rejected-dev.json /tmp/r20-replayed-dev.json
```

Substitute `heldout-v1.json` or `source-controls-v1.json` for exposed replays; neither is blind now. A direct replay test asserts conservation, not all aspirational exact oracles: inspect its structured report. The original full candidate gate is expected to fail its unchanged capitalization/output control. `candidate-v1.patch` is inactive evidence; never apply it to current production as part of artifact validation. The `.swift.txt` runner is outside native/SwiftPM test discovery here. Original candidate revision `dd8b142a` is recorded for provenance, not required by this reconstruction.
