# R36: enforce the emoji-query cap without rejecting Unicode joins

`EmojiSearchQuery.append` could grow an already-full query beyond its public maximum of 40 Swift Characters. The fix checks the newly segmented whole-string concatenation before accepting each incoming Character. A combining mark, flag component or joiner continuation can still fit at capacity. The current call stops at its first nonfitting Character; it does not split a cluster or inspect later input. Existing whitespace normalization, literal scalar order and deletion delimiters remain as specified in [contract.md](contract.md).

Two exposed normal regression functions produced **13 assertion failures** on baseline. Candidate Release validation passed **442 core functions/65 suites plus three services**, retaining the same five known issues and adding no allowances. These are recorded parent core results, not a rerun performed by this curation.

The single frozen fresh evaluation improved **9→16/16 cases** and **98→123/123 checkpoints**: 98 pass-to-pass, 25 fail-to-pass, zero losses or dropped/unavailable checkpoints. Exactly 25 raw states change across seven improved cases; baseline has 16 over-capacity states. All changes remain visible in [comparison.json](comparison.json). These correlated checkpoints exercise one capacity-boundary correction across Unicode mechanisms; 16 family labels are not 16 independent people, broad typing accuracy, Spanish retrieval, Gboard superiority or native usability evidence.

## Chronology and preserved evidence

- The initial pre-author packet is `e59d5bf1`. Its 19-checkpoint smoke and original observer/comparator remain preserved; the historical tools under `historical/` are byte-identical to that packet. The initial observer did not bind its exact input bytes, and its comparator trusted reported Character counts. Its smoke is not retroactively described as repaired evidence.
- Independent domain review clarified incoming whitespace versus marked stored spaces, presegmented inputs and per-call stopping **before authoring**. The approved contract SHA starts `83e53e1c`; the earlier proposed contract hash and exposed witnesses remain in [domain-review.md](domain-review.md).
- Input-SHA and independent runtime-count repairs occurred before freeze. The original tool bytes, initial peer objections and later repair probes remain in `historical/`, `snapshots/`, [integrity-receipt.json](integrity-receipt.json) and [source-review.md](source-review.md). Root recorded 14 negative integrity rejections in normal/optimized modes; the peer separately exercised stale-count, stale-input and impossible-oracle rejection plus retained valid-overflow failure behavior.
- The repaired **actual baseline and candidate** observers each pass the same 19 all-operation smoke checkpoints. Their bound outputs are separate from the original unbound smoke. The 228-checkpoint smoke and 60-checkpoint overflow controls each clone one exposed template 12 times; their receipts establish developer/scoring checks, not fresh independent families. Their external scratch raw files are not dependencies or silently reconstructed here.
- The source peer approved exact candidate `b31bb9df…`, ordinary tests and frozen tools without reading sealed inputs. The independent author and separate sealed-oracle validator likewise read no candidate, implementation, development or results. Their exact receipts and payload are retained.
- Freeze `1e84fc39` binds 13 files, two external observer binaries, the sealed input and validator approval before the one reveal. No source, scoring tool, policy or oracle was retuned after reveal. [run-receipt.json](run-receipt.json) binds both actual outcome files. The [independent post-evaluation review](post-evaluation-review.md) reproduces all rows and reports zero frozen file/binary mismatches; execution provenance still relies on the parent command receipts.

## Portable verification

On macOS with Python 3.9+ and an installed `xcrun swiftc` toolchain:

```sh
python3 /path/to/emoji-query-cap-r36/verify.py
python3 -O /path/to/emoji-query-cap-r36/verify.py
python3 /path/to/emoji-query-cap-r36/verify.py --git /path/inside/pulpo
```

Default verification works from a standalone copy. It checks strict local manifest paths/hashes, all 13 freeze bindings, inactive historical source snapshots, author/validator/output hashes, complete case/action coverage, scalar/emptiness/count fields, all 123 transitions and seven improved cases. It imports the unchanged frozen comparator and recompiles **only the tiny Foundation segmentation helper**, independently counting Swift Characters and requiring the full reconstructed comparison to remain byte-identical. It also rechecks the 19 repaired smoke checkpoints per version. It never compiles or runs app/core/query source, the benchmark observer or historical binaries, and follows no stored `/tmp`/binary paths.

Optional `--git` resolves the actual repository root and compares immutable initial/baseline/freeze blobs—not later production. `manifest.json` maps every local artifact and the initial eight-file packet; `snapshots/*.swift.txt` are inactive source evidence. Original tools, contract, schema, oracles, outcomes and comparison remain unchanged. Manifest hashes establish byte consistency, not signatures or proof that a binary was built/run from a source.

Evaluation used Swift 6.4 on macOS 27.0.1 (compiler target `arm64-apple-macosx27.0.0`). No devices/native tests or query-latency/memory measurements were performed. Process wall times include startup and JSON I/O and are not query latency. Forty graphemes is **not a byte/scalar memory bound**. Catalog search/ranking, host insertion, separate R34 work and other accuracy claims remain outside this change.
