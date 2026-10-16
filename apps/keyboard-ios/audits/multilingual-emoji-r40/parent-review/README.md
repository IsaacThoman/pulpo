# R40 parent evidence review and derived verifier

REJECTED SOURCE; safe to retain as inactive audit evidence only. This small parent packet supplements the original `apps/keyboard-ios/audits/multilingual-emoji-r40` archive. It does not replace its frozen tools, manifests, source snapshots, contract, or oracles. No production patch is applied, no source is compiled, and no benchmark/native/cost execution is performed by these helpers.

The original verifier is preserved verbatim in `original-tools/verify-inactive-candidate.py.inactive.txt`, SHA-256 `0d5757dc6fa3c58c5840c956567896c5dbf0ae7245ee6db37ee8139e68c18315`. Its `assert` checks disappear under `python -O`. A damaged candidate README snapshot failed its normal check but incorrectly passed its optimized check. The original tool remains historical; its optimized success is not integrity evidence. `derived-helper.patch` records the full textual difference to the separately named parent helper; it is a review artifact, not a patch to apply to the original archive.

Use Python 3.9+ and Git for the optional baseline check:

```sh
python3 verify-inactive-candidate-parent.py --packet /path/to/multilingual-emoji-r40
R40_PACKET=/path/to/multilingual-emoji-r40 python3 -O verify-inactive-candidate-parent.py
python3 -O verify-inactive-candidate-parent.py --packet /path/to/multilingual-emoji-r40 --check-baseline
```

The helper prints JSON to stdout and errors to stderr; it writes no files. `--check-baseline` locates the actual Git toplevel from the audit directory. For a standalone copy, supply `--baseline-root /path/to/exact-before-image-tree`; a Git subdirectory is rejected. Baseline checking validates all six exact present/absent before-images, then runs **only** `git apply --check` from that tree. It never runs `git apply` without `--check`, never reconstructs/applies candidate source, and does not require historical Git objects.

Always-enabled checks pin the original 153-entry retained-hash manifest, check all those bytes, pin the candidate manifest and inactive patch, require the exact six-file source inventory and five non-resource patch paths, validate decompressed resource size/hash, and reject absolute/traversing/symlink paths. Six source hashes and baseline bindings are transitively frozen by the pinned manifest. Later additive parent files are outside the original manifest and outside this helper's integrity claim; it does not require an audit directory to contain only the original 154 files. The helper does not validate an arbitrary experiment schema, independently score all R40 outcomes, or prove runtime equivalence. It binds snapshots and retained bytes, not external reports or executable behavior.

`check-derived-helper.py ORIGINAL_AUDIT BASELINE_ROOT` uses disposable copies only. Its retained receipt has 18 checks: 4 expected successes, 14 expected rejections, equally exercised under normal and optimized Python. Covered negatives: damaged retained source bytes; changed/missing before-images; a newly introduced file incorrectly present in baseline; symlink snapshot; mutated unsafe manifest; a Git subdirectory passed as baseline root. All input files were unchanged by every checker invocation. Separate four recorded current-root checks pass normal/optimized from repository root and unrelated `/tmp`. No product/runtime benchmark was run. Receipts describe the state checked; future production changes can legitimately make optional before-image checking fail.

## Evidence limits

Portable decisive bytes are copied unchanged in `decisive-original-evidence/`: the exact minimal NUL input and raw baseline/candidate outputs, NUL scalar/lowercase details, all 307 recorded tokenizer mismatches, three public-control failures, and three mandatory smoke failures. They preserve the rejection without needing the external full sweeps. Their original archived hashes are checked by the original archive manifest; this parent packet also has its own manifest.

The original archive preserves summaries and hash references, **not full raw paired outputs**, for all 569 mandatory smoke rows, 66,366 compatibility pairs (and all changed arrays), 1,134 independent controls, 212 invariant groups, or 44 development outcomes. These full totals cannot be independently rescored from this portable packet. They remain historical reported totals and externally hash-bound references. The preserved 307 failures are a failure subset of 71,805 recorded token comparisons, not a portable complete tokenizer run. Full inactive source/resource snapshots are in the original archive; they are not duplicated here.

Parent reported a separate actual immutable-source NUL replay in `/tmp/pulpo-r40-parent-nul-witness`. That execution is owned by parent and not counted among this review's executions or checker receipts. The present review did no source/native/cost replay. Do not read or execute earlier R31/R34 sealed payloads to reproduce this review.
