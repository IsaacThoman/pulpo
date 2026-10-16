# Mobile optimistic branch preparation — October 16, 2026

Sending, regenerating, editing, rolling back, and deleting a mobile message all
recompute branch controls with `withBranchMetadata`. Reconciliation also uses
this path while an optimistic response is absent from a stale server detail.
The old implementation filtered the complete response array separately for
every response, then rebuilt the same prompt/version groups repeatedly. Even
a linear conversation with no alternate versions incurred quadratic work.

The implementation now sorts in the existing timestamp/ID order, indexes
parents and prompt variants once, and reuses each ordered assistant-version
list. Each response gets its own user-variant list so an older active answer
continues to replace its variant's newest answer in that control. Modern
`userMessageId` grouping and the serialized-input legacy fallback are unchanged.
Input arrays and response objects are not mutated.

Preparation is proportional to sorting, indexing, and emitted user-control IDs.
For a linear chat this is O(N log N), including the existing sort. A deliberately
wide group of distinct prompt variants still requires quadratic total user-ID
output, because every control lists every variant. This change does not claim
constant-time reconciliation, virtualized native layout, or bounded total chat
memory.

## Same-runtime Node comparison

Apple M5 Pro / arm64, Darwin 27.0.0, Node 26.12.0. The driver calls the actual
mobile function and a frozen copy of its exact original implementation at
`08b2b232`. It bundles mobile modules as ESM before measurement because the
mobile workspace is CommonJS and shared packages expose ESM imports.

Fixture construction and a full equality assertion occur outside measurement.
Three warmups precede nine retained samples per version, with alternating order.
These are synthetic JavaScript preparation timings; React, native Markdown,
bridge work, network latency, and SQLite are excluded. The empirical p95 in
the raw report is the maximum of only nine samples, not an SLO estimate.

| Fixture | Responses | Before median | After median |
| --- | ---: | ---: | ---: |
| Linear | 100 | 0.124 ms | 0.089 ms |
| Linear | 1,000 | 9.102 ms | 0.779 ms |
| Linear | 5,000 | 94.345 ms | 2.448 ms |
| Linear | 10,000 | 370.412 ms | 7.657 ms |
| Mixed parents, edits, regenerations, legacy inputs | 1,000 | 3.967 ms | 0.356 ms |
| Mixed parents, edits, regenerations, legacy inputs | 5,000 | 79.064 ms | 2.023 ms |
| Versions of one prompt | 300 | 12.636 ms | 0.061 ms |

The 10,000-response linear fixture improves about 48×. The regeneration fixture
also benefits from sharing version-ID arrays rather than constructing them for
every answer. These ratios measure this function, not tap-to-content latency.
Raw samples and environment metadata are in the accompanying JSON report.

## Reproduction and correctness

```sh
npm run build -w @pulpo/contracts
npm run build -w @pulpo/client-core
BENCH_OUTPUT=/tmp/pulpo-mobile-branches.json node --import tsx scripts/benchmarks/mobile-branch-metadata.ts
NODE_OPTIONS=--no-experimental-webstorage npm run test -w @pulpo/mobile -- \
  src/mockup5/src/production/optimisticMetadata.test.ts \
  src/mockup5/src/production/optimisticResponses.test.ts \
  src/mockup5/src/production/optimisticBranches.test.ts
```

Regressions compare 24 deterministic mixed graphs against the previous
algorithm, including timestamp ties, reversed source order, distinct parents,
legacy prompts, and edited/regenerated variants. Explicit cases check the
selected older answer, empty input, input immutability, and large version groups.
A 4,000-response test counts parent-field reads to guard against repeated
whole-array scans without relying on a wall-clock threshold. Existing optimistic
send, branch selection, cancellation, stale-detail, and deletion tests exercise
the integration path. Mobile type checking and all 41 focused tests passed.

`apps/mobile/e2e/performance/branch-metadata-entry.tsx` runs the same fixture,
original function, equality checks, and alternating measurements in Release
Hermes. Export it using the existing performance harness instructions, replace
the bundle in a temporary app copy, and install only on a disposable simulator
or emulator. Results are written to `Documents/branch-metadata-results.json`;
Android also emits ordered `PULPO_BRANCH_PERF_<offset>:` chunks. Verify
`hermes: true` and `dev: false` before interpreting native-runtime timings.


## Release Hermes comparison on iOS

A fresh Release binary was built after Expo prebuild and CocoaPods installation,
then the standalone branch entry bundle was installed in a temporary copy on a
disposable iPhone 18 Pro simulator, iOS 27.0, running on the same M5 Pro host.
The recorded runtime reports `hermes: true`, `dev: false`, React Native 0.86.2.
The host ran no concurrent builds, test suites, or other benchmarks during this
measurement. The fixture, complete output equality checks, three warmups and
nine alternating samples match the Node experiment; the native harness pauses
30 ms between samples. These results characterize simulator Release Hermes,
not a physical iPhone or Android device.

| Fixture | Responses | Before median | After median |
| --- | ---: | ---: | ---: |
| Linear | 100 | 1.119 ms | 0.952 ms |
| Linear | 1,000 | 41.019 ms | 8.730 ms |
| Linear | 5,000 | 938.517 ms | 53.024 ms |
| Linear | 10,000 | 3,415.513 ms | 109.909 ms |
| Mixed parents, edits, regenerations, legacy inputs | 1,000 | 47.577 ms | 9.317 ms |
| Mixed parents, edits, regenerations, legacy inputs | 5,000 | 817.236 ms | 46.668 ms |
| Versions of one prompt | 300 | 123.083 ms | 1.938 ms |

The 10,000-response preparation improves about 31× inside Hermes, but 110 ms
remains a meaningful synchronous JS task. This is not evidence of a frame-budget
or tap-latency guarantee. The small 100-response case is close, while the scaling
benefit grows with history size. The [raw iOS report](mobile-branches-ios-2026-10-16.json)
retains every sample; its p95 is again only the maximum of nine values. Android
Release Hermes runtime measurements remain unverified because disposable
emulators did not boot on this host. Shared source tests/type checking cover
both mobile platforms; no Android-specific timing claim is made.
