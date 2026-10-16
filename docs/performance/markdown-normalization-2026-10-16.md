# Avoid redundant Markdown preprocessing work

Pulpo's shared math normalizer repeatedly walked backwards over the same escape
run. A 32 KiB run of backslashes could therefore block JavaScript for roughly a
second before native Markdown or browser rendering began. Streaming an unfinished
code fence can expose its current contents to this normalizer until the closing
fence arrives. Both mobile `SafeMarkdown` and web `Markdown` use the shared code.

The display-bracket scanner already consumes the character following every
unescaped backslash. It consequently never visits an escaped backslash, making
its additional backwards `isEscaped` check redundant. Removing that check keeps
the same delimiter/escape/nesting behavior while making this scanner linear in
the source length.

The same change adds conservative no-op guards. Math normalization returns the
original source when it has neither dollar signs nor backslashes; image linking
returns when no `![` occurs; boxed-minipage unwrapping returns when the word
`boxed` is absent. Every transform requires its corresponding trigger. Searching
for the distinctive word also avoids repeatedly matching a leading backslash
when checking long escape runs.

## Before/after evidence

The [raw report](markdown-normalization-2026-10-16.json) compares the source at
`08b2b232` with the final working-tree implementation in one Node process, on an
Apple M5 Pro / arm64 host with Node 26.12.0 and Darwin 27.0.0. The measured path
is mobile's complete JavaScript preprocessing sequence: minipage unwrapping,
image linking, and math normalization with Android's inline-math length option.
The web option and pipeline are additionally checked for identical output.

Each fixture has three warmups and seven measured samples, alternating baseline
and changed implementation order. Each side independently calibrates its inner
iteration count toward a 10 ms sample, capped at 5,000 iterations; the slowest
baseline stress cases use one iteration. Builds and other agents' measurements
were stopped for this run.

| Fixture | Before median | After median |
| --- | ---: | ---: |
| Plain prose, 32,768 UTF-16 code units | 1.268 ms | 0.005 ms |
| Unicode prose, 32,768 UTF-16 code units | 1.436 ms | 0.005 ms |
| Escaped paths/regex prose, 32 KiB | 1.039 ms | 0.480 ms |
| Rich Markdown, 32 KiB | 1.030 ms | 0.915 ms |
| Complete code fence with a 32 KiB escape run | 0.011 ms | 0.005 ms |
| Unfinished code fence with a 32 KiB escape run | 771.395 ms | 0.389 ms |
| Bare backslash run, 2 KiB | 3.071 ms | 0.023 ms |
| Bare backslash run, 4 KiB | 12.596 ms | 0.045 ms |
| Bare backslash run, 8 KiB | 49.122 ms | 0.095 ms |
| Bare backslash run, 16 KiB | 296.293 ms | 0.266 ms |
| Bare backslash run, 32 KiB | 1,050.257 ms | 0.509 ms |

The bare runs and escape-heavy code fences are synthetic stress cases, not a
claim that ordinary answers contain thousands of consecutive backslashes. Paths
and regex prose exercise a more typical escaped-text workload. The complete
fence is a control: the existing code-span segmentation already excludes its
contents from math processing. Rich Markdown contains headings, lists, a table,
math, code, images, and currency. The Unicode fixture includes non-ASCII scripts,
emoji, and combining characters; raw UTF-8 byte lengths are recorded separately.

These are **repeated, warmed, identical-string microbenchmarks**, providing a
lower bound for the preprocessing operation. Engine optimization, string and
regex caches, function-call overhead, allocation/GC, and host frequency changes
affect the small timings. They do not establish equivalent improvements in a
live stream, UI input latency, native layout, DOM layout, frame rate, or total
app rendering time. Large stress samples also vary; the raw report retains
every sample rather than treating these medians as an application SLO.

## Correctness and reproduction

The comparison driver checks **2,242 baseline/final output equivalences**:
mobile and web preprocessing of complete fixtures and varied streaming
prefixes, plus 1,000 deterministically generated delimiter/code/Unicode mixtures
under both platform options. These correctness checks use varying inputs; the
timings described above intentionally repeat each completed fixture.

The 23 focused Markdown tests pass, including 576 combinations of opening and
closing escape-run parity, escaped nested delimiters, an unfinished outer block,
128 KiB runs, plain Unicode/code no-op cases, and the existing currency/math,
boxed-document, image, and fenced-code cases. No wall-clock assertion is added
to the unit suite.

```sh
npm run test -w @pulpo/client-core -- src/markdown.test.ts
BENCH_BASE_REF=08b2b232 BENCH_OUTPUT=/tmp/pulpo-markdown-normalization.json node scripts/benchmarks/markdown-normalization.mjs
```

The comparison needs Node 22.13+ and Git, and does not require a workspace build.
It loads baseline source with `git show` and strips TypeScript in memory;
`BENCH_SAMPLES` changes the default seven samples. Checked-in evidence uses the
full mobile preprocessing pipeline rather than timing only the changed scanner.

The other `isEscaped` calls remain: they run at dollar signs or image markers,
where successive calls examine separate preceding escape runs. The regular
expressions for unfinished parenthesized math and boxed wrappers are unchanged;
repeated malformed openings can still backtrack. This change does not promise
linear time for every possible Markdown input, and it does not change Markdown
syntax or native rendering behavior.
