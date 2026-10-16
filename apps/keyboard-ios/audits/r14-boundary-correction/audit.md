# R14 rejected boundary-correction experiment

**Decision: rejected; artifact retention only.** The parent independent review
agrees with rejection. The sole candidate applied its supposed explicit-Space
exception on a swipe, failed the required existing core gate, and had unavailable
heldout tasks. Nothing in this directory enables the behavior or registers tests.
The subsequent R16 task owns a new experiment; this package does not implement it.

The agent restored production byte-for-byte to `8c7d00a2`. Parent review checked
that restoration, the frozen source/input hashes, the sealed heldout hash, and all
four paired raw-result hashes. Restored engine SHA-256:
`3f0987051ff0f176a5e1ef6396d415b0f8fe0fc2088735c75fef87f75158de97`.
There was no net production-source diff across the R14 round. The rejected
candidate remains identifiable as `024bde2531ccd82fa1b00f34425bef9b06511317`;
`ea85b181` restored it, and `d7f0f16e` recorded rejection evidence.

## What is retained

- [agent-audit.md](agent-audit.md) is the original historical audit, verbatim.
  Its original relative source/test links refer to the agent tree, not registered
  files in this artifact package. The executable snapshots are linked below.
- [protocol.md](protocol.md), [dev.json](dev.json), [heldout.json](heldout.json),
  [freeze.json](freeze.json), [source-review.md](source-review.md) and
  [agent-manifest.json](agent-manifest.json) retain the original content/hashes.
- [dev-report.json](dev-report.json) and [heldout-report.json](heldout-report.json)
  are the unchanged compact paired comparisons. Their historical absolute `/tmp`
  paths are labels, not portable dependencies.
- `results/*.json.gz` retain the four synthetic result arrays, including their
  per-case traces, as deterministic gzip files with zero timestamps and no stored
  filenames. No build logs, xcresults, external corpora or separate trace bundles
  are imported. Original uncompressed hashes are recorded in the manifest.
- [benchmark fixture](fixtures/BoundaryCorrectionSweepTests.swift.txt),
  [source-review regression](fixtures/BoundaryCorrectionReviewTests.swift.txt),
  and [controller protections](fixtures/BoundaryCorrectionControllerTests.swift.txt)
  are exact `.swift.txt` snapshots outside test discovery. None is imported into
  the normal Core or UIKit test targets. The benchmark is report-only and its
  process success must never be interpreted as accuracy acceptance.
- [rejected.patch](rejected.patch) is the small zero-context production diff from
  the baseline to the rejected candidate. It avoids storing compiled/live source
  and avoids whitespace exceptions for blank context lines. Applying it requires
  `git apply --unidiff-zero`; it must not be applied to production.
- [retained-manifest.json](retained-manifest.json) maps historical paths, all
  retained byte lengths/hashes, source revisions and result denominators. It
  excludes its own hash to avoid a self-referential manifest.

## What the results establish

| Dataset | Unique scored tasks | Baseline exact | Candidate exact | Unique gains | Unavailable scored tasks |
| --- | ---: | ---: | ---: | ---: | ---: |
| Development | 33 | 20 | 31 | 11 | 0 |
| Independently authored heldout | 33 | 9 | 15 | 6 | 6 |

Each task is repeated under four timing modes. Aggregate scored executions are
80/132 to 124/132 for development, and 36/132 to 60/132 for heldout. Those are not
132 independent language examples. All unavailable tasks remain in the denominator
as failures. Two development and three heldout ambiguity diagnostics are separate;
the candidate changes both development literal-intent diagnostics adversely.
The compact heldout accuracy gate is false. The development report's true gate
does not incorporate core/native acceptance and did not authorize retention.

There is a narrow product opportunity: an explicit Space could correct an entirely
new word typed at a whitespace/document boundary before inherited text, while
preserving that text. The candidate's source instead inferred the trigger from a
space separator. `insertGlide` uses that same separator, so typing `teh` before
`meeting` and then swiping `hello` unexpectedly changes the pending word to `the`.
The review reproduced this against immutable archived sources. Existing prefix/
suffix text survived and two-step Undo worked; the problem is an unauthorized
trigger expansion, not demonstrated suffix loss.

The full candidate Core run also failed its unchanged partial-word invariant in
four seeds. Review found freshly typed boundary spans with preserved suffixes;
the old blanket oracle could not distinguish the proposed behavior from inherited
midword edits. That explains a policy/oracle conflict without converting a failed
required gate into a pass. No fuzz rule was weakened to accept this candidate.

## Exact remaining limits

- Six heldout tasks supplied unusable relative move offsets. The author brief did
  not fully specify relativity; inputs/oracles were not repaired after reveal.
  Three heldout Undo tasks expected a retained separator contrary to existing
  Backspace Undo behavior. These remain recorded failures, not corrected scores.
- Technical literal retention, selection-origin correction and some grocery
  spellings fail in both sources. Development punctuation-opened Spanish and a
  selection-suffix task also remain failures. No dictionary/ranking fixes occurred.
- Unmarked codenames/prefix fragments and ordinary typos can have identical
  observable keys. An explicit Space is a heuristic, not proof of intended prose.
- The benchmark disables automatic capitalization through ordinary field traits.
  It exercises real Core correction and full-document outputs, but its delayed
  modes apply writes to true text immediately. It does not reproduce a genuinely
  queued remote host write pipeline or unobservable host edits.
- UIKit protection fixtures were compiled only in the agent round. They were not
  executed and do not test the fresh-word accuracy gains. No native runtime,
  installed-keyboard, physical-device or candidate performance claim is retained.
- Heldout inputs are now revealed development evidence. Any new independent
  holdout must be newly authored/sealed. Finite synthetic gains, report generation
  and historical compilation do not establish broad accuracy or zero errors.

## Portable verification and optional replay

From the repository root:

```sh
python3 apps/keyboard-ios/audits/r14-boundary-correction/verify.py
```

This needs only Python's standard library. It verifies every retained file hash,
historical path mapping, sealed input hash and decompressed result hash/count,
then regenerates both compact comparisons from retained paired arrays using the
original report utility. The compact reports alone cannot reproduce rich traces;
the retained compressed arrays supply those traces. Verification does not compile
or run the candidate and is not an acceptance gate for its product behavior.

Optional macOS Core replay, requiring Git and the compatible Swift toolchain:

```sh
python3 apps/keyboard-ios/audits/r14-boundary-correction/verify.py --replay dev
python3 apps/keyboard-ios/audits/r14-boundary-correction/verify.py --replay heldout
```

Replay reads this artifact package from committed `HEAD` (`--artifact-ref` can
select another committed package), archives baseline source and language data
from the recorded ancestor into a temporary directory, registers the archived
benchmark there, and recreates the rejected candidate by applying the retained
patch only to that temporary tree. It checks engine hashes before running Core,
then compares the recreated full results with the retained reports. It does not
need the unmerged candidate commit to exist in a fresh clone. All temporary source,
build and result trees are removed. There is no native build or device operation.

Parent curation verified report regeneration, all retained hashes/counts and
temporary archive/patch source reconstruction. Optional Swift replay was not rerun
during curation; prior execution evidence remains historical. No production,
normal-test-target or other audit-directory file was changed by this import.
