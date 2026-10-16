# Web account preparation and remaining boundaries — October 16, 2026

Two account-level preparation paths still performed quadratic work after the earlier
transcript virtualization improvements:

1. `replaceSummaries` searched the complete current chat array separately for every incoming
   summary. It also scanned every new summary to decide whether to retain each provisional
   local chat. A current-chat map and server-ID set now perform those lookups once per ID.
   Transcript conversion, server order, streaming tracking and local-only retention retain
   their existing behavior.
2. The sidebar grouped chats by replacing a folder's array with a spread copy for every chat
   in that folder. A large closed archive folder incurred this cost too. The grouping helper
   now appends to newly allocated local arrays. Input chat objects and arrays remain untouched;
   each call owns its returned arrays.

The production-store and grouping measurements are retained in the [JSON report](web-large-account-2026-10-16.json).
They exclude network, mounted store subscribers, React reconciliation and DOM/layout work.
They establish improvement in preparation CPU cost, not a bounded or virtualized sidebar.

| Server chats (+25 local) | Actual summary replacement before → after | Folder grouping before → after |
| ---: | ---: | ---: |
| 1,000 | 3.4 → 0.8 ms | 0.6 → <0.1 ms |
| 5,000 | 61.3 → 3.1 ms | 8.0 → 0.2 ms |
| 20,000 | 346.3 → 10.9 ms | 103.7 → 0.2 ms |

These are medians of seven retained samples on an Apple M5 Pro, Node 26.12.0,
Playwright 1.63.0 / Chromium 153.0.8010.12, without CPU throttling. Baseline and implementation
ran sequentially without competing benchmark/build workloads. Values below 0.1 ms approach
the browser timer's precision, so a speedup ratio would be misleading there.

## Validation and reproduction

`web-large-account.mjs` builds a production Vite fixture containing the real `useChat` store.
For the baseline it substitutes the complete `08b2b232` version of `stores/chat.ts`, using
the same dependencies as the implementation. Grouping compares the original sidebar loop
with the actual new helper. Each fixture has 1,000, 5,000 or 20,000 existing chats, server
summaries in reverse order, one retained transcript, and 25 unacknowledged local chats.
All chats share a folder to expose the growing-array copy. Assertions check server/local
order, counts, original transcript identity and grouping identity. Each operation discards
one warmup and retains seven samples; garbage collection occurs outside timed samples.

```sh
BENCH_OUTPUT=/tmp/pulpo-account-before.json node scripts/benchmarks/web-large-account.mjs --baseline 08b2b232
BENCH_OUTPUT=/tmp/pulpo-account-after.json node scripts/benchmarks/web-large-account.mjs
NODE_OPTIONS=--no-experimental-webstorage npm run test -w @pulpo/web -- src/stores/chat.order.test.ts src/features/sidebar/chat-groups.test.ts src/components/layout/Sidebar.sort.test.tsx src/components/layout/Sidebar.drag.test.tsx
```

The summary regression test uses counted ID getters on 1,000 existing chats to distinguish
linear lookup work from repeated array scans without depending on wall-clock thresholds.
Behavior tests cover provisional/awaiting-summary retention, active temporary chats,
discarding removed ordinary chats, stream tracking, transcript identity, folder order,
pinned chats and items shown only in Files. Existing sidebar drag/sort tests exercise the
integration path.
The focused web selection passes **119 tests across eight files**, including the Markdown
and branch suites. Changed web/benchmark files also pass lint and diff whitespace checks.

The full web suite subsequently passed **1,281 tests across 207 files**. Its first run exposed
an existing dictation-test isolation race: unmount asynchronously saves the previous test's
composer draft, while the next test clears IndexedDB outside the serialized draft-write queue.
A pending cleanup write can land after that clear, restoring `hello from dictation` in the
next test even though cancellation uploads nothing. The unchanged dictation file passed 15
isolated repetitions. A temporary, in-memory diagnostic using baseline `08b2b232` chat-store
code, 40 ms draft-put latency and a 100 ms pause after clearing storage reproduced the exact
failure: an empty table became a table containing the previous transcript. The same diagnostic
reproduced on the implementation. These timing perturbations were diagnostic only.

The test setup now awaits the existing serialized `deleteComposerDraft(userId, 'new')` before
clearing its storage. That orders reset after prior cleanup writes; no assertion changed and
no sleep was added. With the same injected timing, the baseline dictation suite then passed
all eight tests. The normal full web suite also passed under concurrent native-build activity.
Production dictation and persistence code were not changed.

## Remaining findings

- **Sidebar rendering remains proportional to the visible tree's total row count.**
  `Sidebar.tsx` directly maps pinned/root entries and expanded-folder entries into React
  rows. Rows are not virtualized. A large closed folder avoids mounting its children, but
  thousands of unfiled chats or an expanded large folder still create thousands of rows.
  Virtualizing this tree needs explicit drag/drop, multiselection, keyboard, menu and scroll
  anchoring coverage; changing only the grouping loop does not resolve that work.
- **Every chat-store update still computes an account-wide revision string.**
  The sidebar selector near `chatListRevision` maps every chat and joins displayed/sort fields
  before checking equality. A streaming update can avoid rerendering the sidebar while still
  allocating this string. Addressing it cleanly likely requires a separately maintained
  summary projection or revision rather than a comparison over every chat on each event.
  No end-to-end input/frame cost was measured for this selector in this audit.
- **Response snapshots have an additional unbounded lifetime.**
  `stores/chat.ts` owns the module-level `accumulatedResponseSnapshots` map. Both
  `rememberResponseSnapshot` and `applyResponseSnapshot` store snapshots including full
  output. There is no deletion or clear operation for that map. The query-removal subscriber
  releases branch windows only; `clearLocalChats` removes detail queries and storage, and
  `auth.logout` clears Zustand/query state, without releasing this map. Thus snapshots can
  remain reachable after the corresponding chat/query is discarded, until the page/module
  is destroyed. This is a source-proven retention path, not a quantified heap-growth result.
  A follow-up should define account/reset/query-removal ownership and late-event behavior,
  then verify collection with fresh-process heap tests. Arbitrary eviction could discard
  sequence/merge state needed for delayed stream events, so it is not included here.
- **Persistent-cache limits do not cap the live session's memory.**
  The query client's seven-day `gcTime`, Zustand's loaded transcripts, and loaded history
  pages retain response bodies independently of the 25 MiB IndexedDB budget. Virtualized
  DOM does not release already loaded history. The separate visited-branch cache is bounded
  (six windows / 8 MiB) and is cleared by query removal. Measuring and designing a live
  transcript budget requires navigation/branch/offline durability tests beyond the focused
  fixes here.
- **The summary request remains unpaginated.** The `/api/chats` route returns all accessible
  non-temporary chats and the web `ChatDataBridge` requests that complete list. The new
  preparation algorithms make CPU scaling linear; they do not bound payload size or row
  count. Pagination would affect local order, folder counts, searching and streaming discovery.
- **One huge answer remains expensive.** The [Markdown report](markdown-streaming-2026-10-16.md)
  removes redundant parses between display ticks but still measures approximately 50 ms
  frame p95 for a 315 KB answer. Parser workers, incremental Markdown boundaries or content
  segmentation need separate correctness work for tables, math, fences and node identity.

The earlier lazy authenticated layout/settings/search, 100 ms streaming display cadence,
virtual transcript, incremental per-response IndexedDB records, bounded branch-window cache,
bootstrap request sharing and reconnect coalescing remain in place. Their historical reports
describe their original measurements; those numbers are not presented as new results here.
Startup bundle transfer, real provider/API latency, physical low-end devices, Safari,
Firefox and production Core Web Vitals were not measured by these isolated experiments.
