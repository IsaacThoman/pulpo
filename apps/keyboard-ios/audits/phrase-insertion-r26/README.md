# REJECT: R26 phrase insertion candidate

The frozen `f3921a48` candidate is rejected. After an owned separator deletion or punctuation insertion, a host can silently replace the fully visible prefix with `FOREIGN`, retaining the document identifier and suffix `supplies`. The candidate then writes into that visibly different destination: `FOREIGN, supplies` after deletion, or `FOREIGN supplies` after punctuation. These are detectable prefix changes, not the previously disclosed ambiguity of an unchanged old-owned snapshot. Callback variants stop at `FOREIGNsupplies`.

The independent exposed diagnostic freezes seven contexts and executes all three real stacks: 21 traces per version, 42 total. Six candidate executions violate the destination guard. Baseline punctuation interruption has no subsequent write; baseline deletion/marker hooks never execute because baseline has no owned phrase marker. These unequal hook opportunities remain explicit, rather than scoring unexecuted baseline hooks as successful interruptions. See [source review](independent/review.md), [client](independent/Client.swift.txt), original [protocol](independent/protocol.txt), [summary](independent/summary.json), and lossless raw baseline/candidate traces under `independent/`.

No candidate source, active test, or changed ordinary oracle is imported. The candidate engine and the authorized historical `Hello againA` test migration are separate **inactive patches** under `fixtures/`. The root's ordinary historical expectation remains unchanged. Three frozen drivers are `.swift.txt` files outside discovery. Root normal guards are committed in `7e1c8f02`; parent reports 441 core plus three services passing with the same five known issues, and 12 guard issues against isolated frozen R26 across all three stacks. Those runs are parent-reported context, not raw results supplied by this archive. No native candidate acceptance or post-reveal tuning occurred.

## What the original experiment actually established

The original [agent audit](original/agent-audit.md), [source review](original/candidate-source-review-v1.md), and [post-reveal acceptance](original/post-reveal-review-v1.md) are preserved verbatim as historical decisions, **superseded by this rejection**. Their passing bounded matrices do not establish the absent silent-interruption behavior. Original reports, oracles, hashes, timings and decisions remain unchanged.

| Original paired matrix | Cases × modes | Baseline → candidate full passes |
| --- | ---: | ---: |
| R26 development | 89 × 3 | 90 → 243 / 267 |
| R26 heldout | 40 × 3 | 48 → 93 / 120 |
| Exposed R20 development | 40 × 3 | 68 → 92 / 120 |
| Exposed R20 former heldout | 36 × 3 | 45 → 66 / 108 |
| Exposed R20 source controls | 22 × 3 | 36 → 54 / 66 |
| Exposed R5 development | 28 × 3 | 71 → 77 / 84 |
| Exposed R5 former heldout | 22 × 3 | 56 → 59 / 66 |

The 45 heldout gains are **15 unique cases repeated across three modes**, including only 14 final-document gains: h34 improves an earlier checkpoint while final documents are equal. h35 has intermediate differences without a score or final-document gain. Nine unavailable executions and 15 ambiguous executions overlap through three native-Undo rows; they are not disjoint exclusion buckets. All remain in the 120 denominator. The remaining 27 nonexact rows are six own-lag/queued misses, six controller-unavailable rows, and 15 ambiguous rows including unavailable Undo. Three natural English/Spanish/mixed examples support nine repeated-mode gains, not 45 independent natural-language accuracy gains.

Every case runs EN/ES/bilingual real stacks with recorded dictionary hashes and matching settings. Timing/context is assigned **per case**, not every case under every timing. Development includes full/fresh/hidden/own-lag/queued/reentrant contexts. No UIKit transcript delivery, native Undo grouping, physical extension, human sample, Gboard, or latency result is established. Ordinary gates were baseline 439 core tests/64 suites plus three services and candidate 446/67 plus three services, preserving five known issues. Green driver tests record aspirational misses instead of asserting all benchmark oracles.

All changed failures remain in raw evidence: development `.NET`, `!important`, and unavailable native Undo; heldout unavailable native Undo only. Passing development controls include awkward possessives and retained spaces before punctuation/newlines; contract passes are not universal UX gains. Historical R5 `passed` checks completion plus full document, not caret or conservation. D17 English and D28 Spanish already have `conserved=false` in both versions; no blanket legacy conservation-pass claim is supported.

The independent author receipt binds the exact contract/schema and heldout bytes. The specification commit followed exploratory implementation; its own provenance note relies on earlier reviewer/author receipts, not an invented earlier Git timestamp. The 14-file freeze and heldout hash match committed bytes; no source/runner/oracle changes follow the freeze. Final development outputs were re-paired after reveal from existing pre-reveal results, as the original evaluation record explains.

The heldout contains 19 lexical content tokens. They are disjoint from the exposed R5/R20 cases, exclusions and new development content. h26's decomposed `café` **host prefix** overlaps a later pre-freeze source probe: full-content novelty is not complete, although insertion payload/right-suffix targets remain disjoint. Original 120 rows stay fixed. Analytical removal of h26 gives 48 → 90 / 117; removing h26 and checkpoint-only h34 leaves 39 gains across 13 cases. These are sensitivity calculations, not revised acceptance oracles.

## Verify and reproduce without changing production

Run from any directory, using Python 3.9+ and Perl's core `JSON::PP`/Unicode grapheme support:

```sh
python3 /path/to/phrase-insertion-r26/verify.py
python3 -O /path/to/phrase-insertion-r26/verify.py --history /path/inside/pulpo
```

The bounded verifier checks stored/decompressed hashes, exact author bindings, schema, three-mode Cartesian coverage, source dictionary identities, recomputed scores/checkpoints, bounds, all 3,049 primitive chains across 1,662 original results, historical conservation exceptions, and all 42 adversarial traces/post-mutation writes. Optional Git checks resolve the actual repository root before using repo-relative paths, compare all 87 originals/inactive patches that have Git provenance, and verify frozen source hashes. The manifest is provenance, not a signature. Verification cannot establish unrecorded behavior or provenance beyond retained receipts.

`manifest.json` maps every original to its source commit/path or diagnostic source path, with packed and original SHA256/byte counts. The scoped `.gitattributes` preserves required single-space unified-diff context lines in the two inactive patches. JSON files larger than 20 KB use deterministic gzip (`mtime=0`); decompressing restores exact original bytes. Original relative links may need the corresponding `.gz` file decompressed. The original Python runners/pairers are retained verbatim for historical reproduction; their assert-based validation and trusted score flags are superseded by `verify.py` for archive checking.

For an intentional historical replay, create **two temporary checkouts of `74a4af2d`**, with unchanged bundled `LanguageData`. In both, copy the three `fixtures/*.swift.txt` drivers to `PulpoKeyboardKit/Tests/KeyboardCoreTests/` with only the final `.txt` removed. Apply `fixtures/rejected-candidate.patch` only in the candidate checkout. Apply `inactive-hello-again-oracle-migration.patch` there only when reproducing the candidate full ordinary gate; its expectation change was authorized before freeze and retains stronger capitalization/caret/suffix/no-deletion assertions. Never apply either patch to current production.

Decompress original JSON files in a temporary copy of this archive, retaining their names. With `AUDIT` set to that temporary `original` directory, `BASE`/`CAND` set to the temporary repository roots, the frozen main replay commands are:

```sh
python3 "$AUDIT/run-swift-v1.py" --package "$BASE/apps/keyboard-ios/PulpoKeyboardKit" --suite "$AUDIT/heldout-v1.json" --results /tmp/r26-baseline.json --summary /tmp/r26-baseline-gate.json --filter PhraseInsertionR26Tests.frozenDocuments
python3 "$AUDIT/run-swift-v1.py" --package "$CAND/apps/keyboard-ios/PulpoKeyboardKit" --suite "$AUDIT/heldout-v1.json" --results /tmp/r26-candidate.json --summary /tmp/r26-candidate-gate.json --filter PhraseInsertionR26Tests.frozenDocuments
python3 "$AUDIT/pair-v1.py" "$AUDIT/heldout-v1.json" /tmp/r26-baseline.json /tmp/r26-candidate.json /tmp/r26-paired.json
```

Substitute `development-v1.json` for the development replay. Legacy case inputs and all paired outputs are embedded in the retained matrices; R20 original suites are also retained directly. Legacy driver filters and original command metadata remain in the corresponding gate records. No new sealed workload is required.

The independent public-API client can be linked to separately built baseline/candidate `KeyboardCore` libraries as recorded in [original commands and library hashes](independent/commands.txt). Its absolute paths record the historical run; rebuild in isolated checkouts elsewhere. Its baseline library came from `e9f5d6bb`, whose complete Core tree equals `74a4af2d` (`9461e76ced19b360c20449e42536a64ae0c8d4c4`). Executables, dictionaries, libraries, caches, raw logs and generated build artifacts are intentionally absent. Archive validation performs no keyboard execution or build.
