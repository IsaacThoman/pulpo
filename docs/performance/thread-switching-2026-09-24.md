# Thread and message-version switching — September 24, 2026

The delays reproduce with cached data. The main causes are transcript remounting, discarded inactive branch pages, and a quadratic descendant lookup. This change keeps the existing virtual list mounted across thread/version switches, retains a small cache of visited branches, and indexes descendant selection.

## Findings and changes

1. **Virtualizer initialization dominated cached navigation.** Both the thread ID and branch version were React keys. Changing either discarded measurements and restarted Virtuoso's initial `LAST` positioning. The installed virtualizer waits four animation frames before its initial scroll and then waits for measurements to settle; its list is hidden during that process. The existing early-reveal workaround shortened the wait but did not eliminate it. Keep one virtualizer mounted, retain stable message keys, and reposition it in a layout effect. On branch changes, shared message rows now stay mounted. Initial uncached opening still uses the existing measurement path.
2. **Paginated branch history was effectively uncached after switching away.** `mergeHistory` correctly keeps only the active lineage, but doing that also discarded the data needed for immediate back/forward navigation. A separate memory-only LRU now retains up to six visited windows within an 8 MiB serialized UTF-16 budget. It also captures the outgoing version before regeneration or editing. The main query and persisted transcript remain active-lineage-only. Query identity scopes the windows to an account/session; removing a query releases its windows. Oversized windows fall back to fetching normally.
3. **Early-message selection could scan the entire history once per descendant.** `newestDescendantId` used `filter` inside its walk. Building a last-child index once changes the operation from quadratic to linear while retaining the same server-order choice. Malformed cycles also terminate.

Keeping the list alive requires explicit lifecycle handling: inline edit drafts reset when changing threads; history loading/error state is scoped to the current account, thread, and branch; a newly selected thread still warms another history page. Resize anchoring now corrects estimated positions against the actual rendered row after reflow. Activation acknowledgments and stale detail refetches cannot replace a newer locally selected branch, and responses from removed queries are ignored.

## Browser comparison

Production Chromium renders the actual `MessageList`, `MessageItem`, Markdown, Radix scroll area, Zustand store, and React Query cache. Only the activation transport is synthetic, with a fixed **200 ms delay**. Fixtures contain 10 or 1,000 turns, with two messages per turn. Rich content includes Markdown formatting, a table, and highlighted code. Desktop width is 1,440 px; the constrained case is 390 px with 4× CPU throttling. Height is 900 px.

Each scenario uses a fresh page and three navigation cycles: six cached thread switches, five revisits to a branch, and one first visit to a branch. Timing starts at the DOM click and ends at the first animation frame containing the visible target message. Every frame is inspected for an empty/hidden transcript. Background acknowledgments settle before the next action. These are local diagnostic medians, not full-application production latency estimates: router/sidebar work, real API/database latency, IndexedDB cold hydration, providers, native mobile, and non-Chromium browsers are outside the benchmark.

| Scenario | Cached thread before → after | Revisited version before → after | Median blank time before, thread / version | Blank frames after |
| --- | ---: | ---: | ---: | ---: |
| 10 turns, plain | 145 → 13 ms | 345 → 12 ms | 129 / 133 ms | 0 |
| 1,000 turns, plain | 163 → 12 ms | 363 → 12 ms | 146 / 150 ms | 0 |
| 1,000 turns, rich | 196 → 13 ms | 380 → 13 ms | 180 / 167 ms | 0 |
| 1,000 turns, rich, narrow, 4× CPU | 263 → 45 ms | 494 → 27 ms | 246 / 267 ms | 0 |

The baseline labels a branch revisit as “cached” by user action; its implementation had actually discarded that branch page. The improvement therefore removes both a network wait and a render restart.

An intermediate experiment removed only the branch-remount key. It eliminated blank frames and retained the shared rows, but revisited versions still took **212–228 ms**, approximately the injected request delay. Retaining visited pages removes that remaining wait. Reusing the list across threads also avoids their repeated initialization; a separate snapshot cache was unnecessary.

Across all **48 final measured switches**, there were zero sampled blank frames and zero settled bottom gap. Every branch switch retained the sampled shared DOM row. First visits to uncached branches took 208–229 ms, with the existing transcript remaining visible during the request. A cache miss still requires the server; the optimization does not claim otherwise.

Sanitized aggregate measurements, including the intermediate experiment and descendant microbenchmark, are in [the JSON summary](thread-switching-2026-09-24.json). The isolated 20,000-response descendant lookup fell from seconds to approximately 2 ms. It matters most after loading extensive history and selecting an early version; the default recent page is much smaller.

## Regression coverage

- Production-browser checks at desktop and narrow widths repeatedly switch between an eight-turn thread and a 1,200-turn paginated thread, shorten and restore branches, and traverse all history pages.
- Shared inline edits survive a version change. Growing an answer preserves bottom alignment. Width changes retain the reading anchor within 0.4 px. The fixture draft remains intact. Screenshots were visually inspected and browser checks reported no uncaught errors.
- Store tests cover immediate restoration of paginated branches, stale refetches, superseded acknowledgments, removal during activation, and returning to a version while regeneration is pending. Hook tests cover switching chats without remounting while old requests are pending. Cache tests cover LRU/size limits and owner isolation. The descendant test counts property accesses on a deep chain to guard against quadratic traversal.
- Web suite: **927 passed**. Client-core suite: **151 passed**. Production web build, repository lint, and diff whitespace checks passed. Under Node 26.4.0, the web tests require `NODE_OPTIONS=--no-experimental-webstorage`; without it, existing storage-dependent tests fail because the runtime's native storage global interferes with the test environment.

The changes reuse existing message components and styles. They retain the current behavior of positioning a selected branch/thread at its newest message. Huge individual Markdown answers can still be expensive to mount or update. The branch cache is bounded and lasts only for the session; evicted versions and cold thread opens still need their normal load path.

## Reproduction

```sh
npm ci --ignore-scripts
npm run build -w @pulpo/contracts
npm run build -w @pulpo/client-core
BENCH_OUTPUT=/tmp/pulpo-switching.json node scripts/benchmarks/thread-switching.mjs
node scripts/benchmarks/thread-switching.mjs --check
node scripts/benchmarks/branch-selection.mjs
NODE_OPTIONS=--no-experimental-webstorage npm run test -w @pulpo/web
```

The browser driver builds its fixture into a temporary directory and removes the build afterward. The baseline is commit `be8d0c00` with the same fixture/driver. Raw samples, screenshots, and logs stay outside Git; this report and its aggregate summary are the retained evidence.
