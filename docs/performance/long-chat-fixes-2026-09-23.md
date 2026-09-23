# Long-chat performance fixes — September 23, 2026

This follow-up implements the three changes identified in [the baseline audit](long-chat-benchmark-2026-09-22.md): indexed branch metadata, paginated and virtualized history, and incremental transcript persistence. Performance measurements use implementation `e94b91f9` on `dev` at `6a5533aa`, including the code-preview panel. The final branch was subsequently rebased onto `f0c0937c` (sidebar-position preservation and an agent-prompt wording change); the combined build received additional regression and browser checks. Final regression fixes preserve pagination metadata when sidebar summaries arrive after transcript details and confirm readiness from the rendered viewport. Repeated cold opens also vary summary/detail arrival order.

## Behavior

- The initial request loads **500 turns / 1,000 messages**. Once the latest message is rendered, another 500 turns are prefetched, giving the reader approximately **2,000 messages already loaded**. Scrolling requests the next page while roughly **400 messages remain above the rendered range**. Each page contains 500 turns; the server caps requested page sizes at 1,000 turns.
- Only nearby rows mount. Overscan includes 3,000 pixels above and 1,500 below the viewport, with minimum row counts for unusually tall messages. Existing message components, widths, Markdown, actions, and composer remain in use.
- Prepending uses stable message keys and absolute item indices. Width changes preserve a visible message anchor. Streaming follows the bottom only while the reader stays there; reading earlier messages does not follow new output. Branch changes replace the visible lineage and start at its newest message.
- Unsaved assistant edits survive virtual row unmounts, and restoring an editor does not steal keyboard focus. The loading indicator occupies the existing header space. Its disappearance at the oldest page does not change the header height.
- Branch metadata is indexed once per payload. Paginated requests read the complete lightweight topology but fetch full response bodies, costs, and attachments only for the requested page. The unpaginated API remains compatible with existing clients.
- IndexedDB v3 stores chat headers and individual responses separately, in one atomic transaction with their manifest. Unchanged response records are not rewritten. Serialized byte measurements are reused for unchanged responses. v1/v2 caches remain readable and migrate on a successful write.
- The existing 25 MiB aggregate serialized-detail budget remains. Oversized chats keep a connected recent active window rather than losing their entire offline transcript. A single response larger than the available budget still cannot be retained.

## Measurement method

The same synthetic fixtures, local PostgreSQL/Redis/API stack, production Chromium browser, hardware, and timing definitions from the baseline audit are used. A turn contains one user message and one assistant message. Ordinary cases use three fresh browser contexts; constrained-CPU and extreme cases are separate diagnostic probes. API measurements discard one warmup and retain three samples. Tests/builds use Node 24.11.1; the API/benchmark runners use Node 26.4.0. Measurements on this working developer machine are diagnostic, not production capacity guarantees.

Opening now ends when the newest message is present plus two animation frames. The baseline waited for all Markdown blocks because its UI mounted the entire transcript. Heap/DOM measurements happen after the warm page settles and a forced GC. Thus the comparison measures usable opening of the actual implementations, not the time to download every historical message. API totals use uncompressed bodies; browser requests negotiate compression. Providers, generation workers, real attachment downloads, native mobile, and non-Chromium browsers are outside this experiment.

The benchmark publishes 60 ordered deltas through the real Redis/Socket.IO path, types and scrolls, checks draft/delta integrity and settled bottom alignment, then reloads with chat-detail requests blocked. This is transcript recovery with the application shell available, not a fully disconnected application boot. Sequence numbers increase across runs. Completion restores the seeded answer, so cache recovery checks fixture content and the draft rather than temporary timestamped stream markers.

## Results

The ordinary rows below are medians of three fresh browser contexts. Full sanitized measurements are in [the JSON summary](long-chat-fixes-2026-09-23.json).

| Fixture | Turns | Open before → after | Cached reload after | JS heap before → after | DOM elements before → after |
| --- | ---: | ---: | ---: | ---: | ---: |
| plain | 10 | 0.56 → 0.71 s | 0.69 s | 13 → 14 MiB | 875 → 937 |
| plain | 100 | 0.54 → 0.71 s | 0.72 s | 18 → 15 MiB | 6,005 → 1,214 |
| plain | 1,000 | 1.59 → 0.83 s | 0.75 s | 68 → 18 MiB | 57,305 → 1,214 |
| plain | 5,000 | 4.68 → 0.71 s | 0.66 s | 282 → 18 MiB | 285,305 → 1,215 |
| rich | 1,000 | 3.34 → 0.79 s | 0.78 s | 136 → 19 MiB | 181,305 → 1,959 |
| large | 100 | 7.86 → 2.88 s | 2.85 s | 47 → 43 MiB | 6,005 → 660 |

Short-chat opening has approximately 150–170 ms more overhead in this run, including virtualizer measurement and initial scrolling. Long plain and rich chats now open close to the short-chat range. At 5,000 turns, opening is about 6.6× faster, cached reload about 10.7× faster, and measured JS heap about 94% lower.

All 18 ordinary runs preserved the draft and all 60 deltas and restored the latest transcript plus draft with the chat-detail endpoint blocked. The oversized fixture now retains about 85 recent turns inside the 25 MiB budget; previously all three runs failed transcript recovery. In every stream, only one distinct response record was rewritten; unchanged historical response bodies were not rewritten.

Plain/rich stream and scroll frame p95s are approximately 16.7–16.8 ms. At 5,000 turns, newest-delta freshness p95 fell from about 180 to 113 ms. **Huge individual answers remain expensive:** the 305 KB answer case still has an approximately 83 ms stream-frame p95, despite much faster opening. Virtualizing other rows does not remove parsing/layout work inside the actively growing answer.

| Additional probe (one sample each) | Open | Cached reload | JS heap | Stream frame p95 | Newest-delta freshness p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 5,000 plain turns, 4× CPU slowdown | 1.31 s | 0.98 s | 18 MiB | 16.8 ms | 97 ms |
| 10,000 plain turns | 0.80 s | 0.65 s | 18 MiB | 16.8 ms | 110 ms |
| 20,000 plain turns | 0.76 s | 0.64 s | 18 MiB | 16.7 ms | 106 ms |

These probes also preserved simultaneous typing, all deltas, and cached drafts. A separate rich-content run streamed while reading earlier history and measured **0 px** anchor movement. Together these make 22 passing browser samples in the performance matrix. Four additional samples on the final combined build (short, 5,000-turn, rich, and oversized) also passed streaming, cached reload, and reading-anchor checks, each with zero anchor movement. The lower freshness value under CPU throttling is within this small synthetic probe's timing variability, not evidence that throttling improves delivery.

At 20,000 turns, the API's median 500-turn page took **120.5 ms** and returned **1.10 MB** of uncompressed JSON. The previous full-history request took 5,181.8 ms and returned 44.1 MB. The optimized compatible full-history request still returns the whole body but now takes 484.3 ms. Isolated branch metadata fell from 3,922.2 to **35.0 ms**, and full DTO construction from 4,723.9 to **142.5 ms**. Pagination and indexing therefore address separate costs: bounded payload/materialization and repeated topology work.

## Correctness and visual checks

- Repeated cold-open regression: **20/20 passed**, each with the initial page and warm page present and a zero-pixel bottom gap. Requests are paced to stay below the isolated API’s bootstrap rate limit.
- Production-browser layout checks cover short/plain/rich/huge-answer chats at 1440 px and 390 px, no horizontal overflow, bottom alignment, composer typing, and retaining a visible message during width changes.
- The 5,000-turn reader traverses all ten history pages. With an injected 1.2-second request delay, prefetch begins with roughly 49,000 px still available above the reader. The delayed prepend and seven subsequent prepends each moved the visible anchor **0 px**, including the final page where the loading indicator disappears.
- Direct comparison against unchanged `dev` measures the final user/assistant content, header, and composer at both widths. Plain geometry is identical; rich content has at most 2.25 px of vertical rounding, with identical widths/heights. Screenshots were also inspected visually.
- Real API/UI branch switching returns bounded 500-turn activation payloads, replaces the selected lineage, preserves the composer draft, and keeps the newest message aligned. Opening/closing the code-preview panel is covered. An unsaved inline assistant edit survives scrolling far enough to unmount its row, then remounting, without stealing focus.
- Full web suite: **838 tests passed** after rebasing. Server suite: **1,235 passed, 215 skipped** (environment-dependent integration cases). Production web/server builds and repository lint passed. Additional browser checks validate the rebased build; GitHub CI runs the broader workspace/integration matrix.

The browser checks caught and led to fixes for initial-scroll/prefetch ordering, measurement-induced loss of bottom following, estimated-height initialization for huge answers, pending scroll retries overriding wheel input, width-change anchoring, and the 32-pixel jump caused by removing the history-loading indicator. The store regression tests also cover newly sent messages in paginated chats and preservation of pagination metadata when a later sidebar summary omits transcript details. History-hook tests cover concurrent request deduplication, retention of newer cached content, retry after failure, immediate warming, and rejection of late results after a branch/account change.

Cache tests verify that changing the last response in a 1,000-response chat writes only that response record, that ordering survives restoration, that incomplete manifests do not hydrate, that byte accounting reuses unchanged measurements, and that legacy inactive branches do not inflate the trimmed window's offset.

## Remaining boundaries

This makes opening and rendering depend primarily on the recent window rather than total transcript length. It does not make every operation constant-time. Topology discovery remains linear in total responses, and state transformations/manifest work grow with the number of history pages the reader has loaded. Browsing all history keeps those loaded response bodies in memory even though the DOM stays virtualized. The 500-turn limit is a count limit, so exceptionally large individual answers can still produce large payloads and expensive Markdown work.

Virtualization means native browser Find and DOM selection cover mounted content, not every unloaded/offscreen message. Existing server search and unpaginated export/client paths are unchanged. The large prefetch buffer substantially reduces encounters with an unloaded edge, but cannot guarantee instant history on a failed or arbitrarily slow connection; a retry control is available at that edge.

Synthetic repetitive prose compresses unusually well. These results do not measure model context limits, provider latency, generation quality, or the cost of historical context compaction. Raw traces, screenshots, fixtures, tokens, and response IDs remain outside Git; only drivers and sanitized summaries are committed.
