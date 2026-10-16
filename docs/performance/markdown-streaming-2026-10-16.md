# Avoid redundant Markdown parsing during streaming — October 16, 2026

`Markdown` already limits displayed text updates to one every 100 ms. However, each incoming
`content` prop still rerendered its `ReactMarkdown` child with the previous displayed text.
That repeated the full parser/plugin/JSX conversion work between display ticks. The timer
then parsed the newly displayed text again. Memoizing the rendered element by its actual
inputs makes the existing throttle cover parsing as well as text display.

The dependencies include normalized text, line breaks, caret state, custom components, and
URL transformation. Changing those options still updates the renderer. The existing
completion effect, normalization, highlighting, and display interval remain in use.

## Production-browser comparison

The driver builds the actual production `Markdown`, `react-markdown`, remark/rehype plugins,
and syntax highlighting in a temporary Vite fixture. The baseline is `08b2b232`'s
`Markdown.tsx`; both versions use this checkout's dependencies. No server or model runs.
Three fresh Chromium pages per scenario receive the same number of independently committed
updates, scheduled over 1.5 seconds. Updates use `flushSync` to prevent scheduler batching
from obscuring the number of prop changes. An overloaded baseline can therefore finish
substantially after the scheduled interval. This is an isolated stress test, not an
end-to-end provider latency result. The normal socket bridge coalesces deltas over 50 ms;
the 20 Hz case models that direct prop-update cadence, while 30/100 Hz intentionally exceed it.

Measurements ran sequentially without other benchmark/build workloads on an Apple M5 Pro,
Node 26.12.0, Playwright 1.63.0 / Chromium 153.0.8010.12, without CPU throttling. Plain text
contains 10,080 characters. Rich text contains 7,805 characters including 35 repeated
sections with headings, links, lists, tables and TypeScript fences. The large answer is
315,000 characters of prose. Parser time wraps the real synchronous `react-markdown`
function, including plugins and conversion to React elements; it excludes subsequent child
rendering, browser layout and normalization. Wall time includes those operations.

The following numbers are medians of three runs. The retained [JSON measurements](markdown-streaming-2026-10-16.json)
include every sample, frame timing, and blocking time.

| Answer | Target updates/sec | Parser calls before → after | Total parser time before → after | Stream/completion wall time before → after |
| --- | ---: | ---: | ---: | ---: |
| Plain | 20 | 47 → 17 | 77 → 35 ms | 1.53 → 1.52 s |
| Plain | 30 | 62 → 16 | 96 → 33 ms | 1.53 → 1.52 s |
| Plain | 100 | 167 → 16 | 263 → 38 ms | 1.53 → 1.53 s |
| Rich | 20 | 46 → 17 | 289 → 168 ms | 1.53 → 1.53 s |
| Rich | 30 | 61 → 16 | 391 → 153 ms | 1.53 → 1.53 s |
| Rich | 100 | 171 → 16 | 1,089 → 117 ms | 1.89 → 1.53 s |
| Large | 20 | 59 → 17 | 3,149 → 748 ms | 3.34 → 1.63 s |
| Large | 30 | 82 → 16 | 3,736 → 795 ms | 3.93 → 1.60 s |
| Large | 100 | 291 → 16 | 13,823 → 785 ms | 14.34 → 1.60 s |

Before every timed run, a separate deterministic probe commits 20 incoming chunks within
one browser task, so the display timer cannot fire. This produces exactly **20 redundant
parses before, zero after** in all scenarios. The probe is excluded from timing totals.
All 54 measured runs verify final text after completion, preservation of the
draft and keyboard focus, identity of existing links/highlighted code nodes, caret removal,
and no uncaught browser errors.

Large-answer frame p95 remains approximately 50 ms in the 100 Hz case. A single 315 KB
answer still takes tens of milliseconds to parse; this change removes repeated work but
does not move parsing off the main thread or make one expensive parse cheap. It does not
measure input latency, attachment rendering, socket/store overhead, native mobile,
production traffic or Core Web Vitals. The controlled fixed-count workload measures
overload recovery as well as CPU cost; its roughly ninefold large-case wall-time gain
must not be treated as a universal application speedup.

## Regression coverage and reproduction

The streaming unit test counts real renderer invocations through a wrapper: initial mount
parses once, 20 prop changes before a display tick do no extra parsing, the tick parses
once, idle ticks do no work, and completion renders the final answer. Existing interaction
tests retain focus and links through streaming/completion. Option changes are also covered.
The focused Markdown, summary/branch, grouping and sidebar drag/sort suites pass: **119 tests
across eight files**. Lint and diff whitespace checks pass for the changed web/benchmark files.

```sh
npx playwright install chromium
BENCH_OUTPUT=/tmp/pulpo-markdown-before.json node scripts/benchmarks/markdown-streaming.mjs --baseline 08b2b232
BENCH_OUTPUT=/tmp/pulpo-markdown-after.json node scripts/benchmarks/markdown-streaming.mjs
BENCH_HZ=20 BENCH_OUTPUT=/tmp/pulpo-markdown-before-20hz.json node scripts/benchmarks/markdown-streaming.mjs --baseline 08b2b232
BENCH_HZ=20 BENCH_OUTPUT=/tmp/pulpo-markdown-after-20hz.json node scripts/benchmarks/markdown-streaming.mjs
NODE_OPTIONS=--no-experimental-webstorage npm run test -w @pulpo/web -- src/components/chat/Markdown.streaming.test.tsx src/components/chat/Markdown.caret.test.tsx src/components/chat/Markdown.test.tsx
```

`BENCH_CASES=plain,rich,large`, `BENCH_HZ=30,100`, `BENCH_REPEATS=3`,
`BENCH_DURATION_MS=1500`, and `BENCH_CPU=1` control the matrix. The baseline parser-count
assertion expects the pre-fix implementation; set `BENCH_EXPECT_BURST_PARSES=0` when comparing
against a commit that already includes the fix. Temporary fixture/build directories are
removed after the run. Measurements and synthetic state contain no account credentials.
