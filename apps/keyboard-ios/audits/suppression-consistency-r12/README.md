# R12 rejected suppression benchmark

The parent decision is **REJECT / no production change**. Start with
[audit.md](audit.md). This is retained evidence of a failed product policy,
not a suppression requirement or an accuracy improvement. All inputs are now
revealed; later replays are reproductions/regression checks, not fresh blind tests.

## Verify and inspect without inference

From the repository root:

```sh
python3 apps/keyboard-ios/audits/suppression-consistency-r12/tools/benchmark.py verify
python3 apps/keyboard-ios/audits/suppression-consistency-r12/tools/benchmark.py compare --split dev
python3 apps/keyboard-ios/audits/suppression-consistency-r12/tools/benchmark.py compare --split heldout
```

Verification reads only retained files. The manifest checks every retained file
except itself, and checks the decompressed bytes of each report against its
original SHA-256. Comparison binds every observation to its frozen case/profile,
recomputes actual target-document/returned/slotted matches, and reports correct
target documents lost or gained. It does not count suppression as accuracy.
Groups remain separate; secure engine rejection is an intentional policy boundary.

`reports/*.json.gz` are deterministic gzip wrappers (`mtime=0`) around the
**unmodified original JSON bytes**, including original timings and scores. To
extract one original, for example:

```sh
gzip -dc apps/keyboard-ios/audits/suppression-consistency-r12/reports/baseline-dev.json.gz > /tmp/r12-baseline-dev.json
```

`original/agent-audit.md` and `original/agent-summary.json` preserve the author's
original **retain** decision. The original comparator/generator/finalizer scripts
are historical, contain old absolute worktree paths, and must not be used as the
portable tools. They are retained to make the original biased gate inspectable.
The original member manifest also describes external files intentionally omitted
from Git. The full archive remains at
`/Users/isaacthoman/.t3/artifacts/pulpo-r12-53439f72.tar.gz`.

## Reproduce the two revealed versions in a temporary checkout

Requirements: Python 3.9+, Git and a compatible Swift compiler. The historical
runner was compiled with `swiftc -O`; its recorded source hashes and build result
are in `original/build.json`. The original production baseline is
`46a92b564fc77d22137a09a3395f5cd28e3b38da`; candidate source commit `51934da4`
must **not** be checked out as current production or cherry-picked wholesale.

Use a detached temporary checkout and new external output directories:

```sh
git worktree add --detach /tmp/pulpo-r12-source 46a92b564fc77d22137a09a3395f5cd28e3b38da
python3 apps/keyboard-ios/audits/suppression-consistency-r12/tools/replay.py \
  --checkout /tmp/pulpo-r12-source --output /tmp/r12-baseline-dev \
  --split dev --variant baseline
python3 apps/keyboard-ios/audits/suppression-consistency-r12/tools/replay.py \
  --checkout /tmp/pulpo-r12-source --output /tmp/r12-rejected-dev \
  --split dev --variant rejected
python3 apps/keyboard-ios/audits/suppression-consistency-r12/tools/benchmark.py compare \
  --split dev --baseline /tmp/r12-baseline-dev/report.json \
  --candidate /tmp/r12-rejected-dev/report.json
```

Repeat with `--split heldout` and fresh output paths for the other split. Neither
tool overwrites the original reports. Replay requires the three unchanged pinned
bundled dictionaries. The rejected variant applies only
[`rejected-compiler.patch`](rejected-compiler.patch) to a **disposable compiler
copy**, merges the unchanged bundled English/Spanish inputs, and checks the
rejected bilingual hash. The supplied checkout and its resources are never edited.
No dictionary binary is stored in this audit directory.

The original `harness/Runner.swift` bytes generate each dense path file. Replay
checks generated paths against `original/harness-freeze.json` or
`original/heldout-reveal.json` before inference. Generated dictionaries, paths,
executables, replay reports and provenance remain only in the external output
directory. There is no need to download training corpora. Replay compiles the
explicit checkout's core; its revision and complete source hashes are recorded.
Using another clean revision is a new revealed-data regression check, not a
recreation of the historical binary. Runtime timings will vary with host load,
compiler and filesystem state; no device-latency conclusion follows.

## Frozen byte mapping

- `inputs/dev.json`, `inputs/heldout.json`, `inputs/exclusions.json` are unchanged
  original inputs. Held-out receipt and selection source are under `original/`.
- `protocol.md` is unchanged from freeze commit `7e4e7a56`; other original freeze,
  reveal and manifest documents keep their old absolute paths as provenance.
- `harness/Runner.swift` is the unchanged original harness.
- `original/regeneration.json` lists all 57 affected spellings/IDs and binary
  payload invariants. `original/cold.json` preserves the original cold samples.
- `retained-manifest.json` maps retained byte hashes, original report hashes,
  and original external member paths. The original reports/inputs are not rewritten
  to encode the parent's rejection.
