# R34 inactive evidence archive — REJECT

The multilingual emoji candidate was rejected before blind reveal. Its frozen candidate control gate passed144/147, failed3, unavailable0. The failures conflict with the approved conservative v5 reservation policy; source conformance does not turn the failed gate into acceptance. Production, resources, tests and builder were restored to baseline. No R34 production code is imported by this archive.

`original/` contains all48 original audit files byte-for-byte, including the original report and independent source review. `audit.md` is the separate parent review. Historical Swift/Python runners are inactive evidence; none is registered in a build/test target. Do not execute smoke-runner.py, performance.py, runner.swift or independent-review executors as part of archive verification. The original sealed110 rows and R31 sealed46 rows are deliberately absent and must not be read or run.

`results/candidate-smoke/` retains every original exposed candidate-smoke JSON file, including all147 raw baseline/candidate outputs and original reports, exact input suite, oracles and negative controls. `results/compat/` retains both full7374-query outputs and all552 changed rows. Gzip uses mtime0; decompressed bytes and their original hashes are preserved, not reserialized. `independent-review/` preserves the small original review manifest, sources,282 stored controls, summary and failure extract; identical7374 outputs are shared with results/compat instead of duplicated. No binaries, raw build/device logs, xcresults, caches, downloaded XML or corpora are retained.

`snapshots/` holds exact uncompiled baseline/candidate source/test/doc/builder blobs, unchanged EmojiSearch wrapper, and both full resource blobs. The original patch excludes the resource; the two resource snapshots make reconstruction independent of candidate Git ancestry. verify.py replays every patch hunk in memory against archived baseline bytes and compares the exact candidate blobs, then checks that removing ONLY `s` fields reproduces the exact baseline serialized resource. Nothing is applied to a working tree. Snapshot code remains inactive `.txt`; JSON is compressed. The original15-path source manifest and v5 preproduction hashes bind the snapshots/original files.

Run from any working directory using Python3.9+:

```sh
python3 /path/to/multilingual-emoji-r34/verify.py
python3 -O /path/to/multilingual-emoji-r34/verify.py
```

Optional historical Git corroboration (requires original worker commits to be available):

```sh
python3 -O /path/to/multilingual-emoji-r34/verify.py --git /path/to/repository/or/its/subdirectory
```

The verifier uses explicit checks under normal and optimized Python. It checks every retained/decompressed hash, strict JSON parsing, exact inventory, original15 source bindings, v5 hashes, inactive patch reconstruction, resource/English preservation, exact147 ID/order/row shapes, all stored oracle fields/summary counts via the archived strict schema/scorer, all7374 paired arrays and552-row derivation,282 stored independent fixture outcomes, and native structured summary totals. Only the two original schema/scorer Python modules execute, over retained EXPOSED inputs/results; no keyboard, Swift, native, cost, binary, author/exclusion tool or sealed payload executes. Temporary files contain only decompressed exposed output arrays and are deleted. No verification output is written into the archive.

Optional Git checks resolve the actual repository toplevel before using repo-relative paths. They verify baseline/candidate source blobs, all48 original audit blobs, the empty restoration diff OUTSIDE this audit, the exact48-path final audit-only diff, and a known nonempty baseline→rejected-source comparison. If original commits are absent, explicitly requested --git fails; portable checks still work without Git or historical commits. A portable check authenticates stored restoration evidence and source snapshots, not the state of an unknown external checkout.

Limits: original native6/6 and baseline5/5 summaries/source-plan hashes are historical receipts, not freshly executed native evidence or a cryptographic execution attestation. Nested native summarySHA256 references identify external original summary serializations not retained separately; current checks validate the retained structured summaries and enclosing original file hash, not an invented reserialization hash. Historical pre-v5 digest lists may refer to superseded bytes unavailable in this compact final48-file package; their bytes are preserved, but they are not checked against current v5 files. Binary digests, external XML hashes, device restoration and seal custody are reported original observations; no binaries/XML/seals/devices were accessed during curation. Costs other than resource byte delta and all blind semantic utility remain UNAVAILABLE/UNRUN. Stored compatibility additions and exposed controls are not utility evidence. No report gate is weakened, no oracle is changed, no source is retuned.
