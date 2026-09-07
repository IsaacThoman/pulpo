# Mobile performance fixes

Implemented and profiled on `fix-mobile-performance`, originally based on
`675eb02274d9e2f66212e55c1a7662acdfacb9f1`. Before opening the PR, rebased cleanly
onto `dev` at `8bb8c2fc0830ad328b1e520209f9156980f52355` and reran mobile type
checking and all 431 mobile tests successfully. Native measurements and builds
below precede that rebase, which incorporates the shelf/queue disclosure animations.

## Changes

1. SQLite schema v4 separates summary rows from transcript documents. Migration
   uses a transaction and native JSON/UTF-8 byte operations; the version marker is
   committed with the migration. No database reset is performed. Targeted readers
   overlay authoritative summaries onto one document. Startup reads summaries.
   Maintenance reads sizes/access metadata only. Summary and queue updates retain
   unchanged bodies and full-text search content; native byte sizes are calculated
   on changed document persistence. Disk limits remain 5 MiB/document, 25 MiB total,
   and the configured document count. Database work remains ordered; only redundant
   trimming requests coalesce.
2. A per-chat projector reuses its response index, lineage, and unchanged message
   objects, with response/snapshot/attachment/branch dependencies. Lineage uses
   append/reverse. Realtime collections merge with one record copy and one
   notification; reconnect cursor and pending-event processing remains ordered.
3. A namespace-scoped residency coordinator retains five inactive documents within
   a 10 MiB serialized-data budget. Selection, previews, running work, mutations,
   optimistic responses, and pending/failed writes protect entries. Eviction waits
   for persistence and rechecks ownership. It removes detail queries, projected
   messages, projectors, and terminal snapshots together, retaining summaries,
   drafts, queues, and offline documents. Chat-detail query GC is five minutes;
   other query lifetimes are unchanged. Replayed terminal snapshots from evicted
   documents are cleaned up after detail fetches settle.

The residency budget uses a conservative serialization upper bound until SQLite's
stored byte size is available. Server-backed documents excluded from disk caching
can still be evicted. The budget measures retained serialized data, not heap size.

## Automated validation

- Mobile TypeScript checking: passed.
- Mobile tests: 431 passed across 70 files.
- Shared client-core tests: 74 passed across five files.
- Shared contracts tests: 74 passed across four files.
- Changed cache/projection/residency/harness files: oxlint passed.
- Production iOS and Android exports: passed.

Added coverage includes populated v3 migration and rollback, Unicode byte counts,
summary authority and search preservation, metadata-only maintenance, one-document
reads, exact 5/25 MiB boundaries, zero retention, temporary exclusion, namespace
isolation, local-before-network publication, stale/cancelled query ownership,
branch/attachment invalidation, historical/user-message identity, batch sequence
merging and notification counts, coordinated GC/eviction, late byte metadata,
reconnect terminal snapshot cleanup, and pending/failed persistence protection.
The existing suite also exercises outbox replay, optimistic responses, composer
synchronization, realtime ordering, and branch/queue reconciliation.

## Native evidence

Both native Release builds passed with current modules, including ExpoImage.
The iOS build took approximately 19 minutes. Android API 37 emulator boot attempts
failed; a clean API 36 emulator booted after restarting on an unused port. Its
results are reported separately; no Android baseline was recorded by the audit.

### Same-configuration iOS synthetic results

| Operation | Before median | After median | Target |
| --- | ---: | ---: | ---: |
| Open/trim, 45 documents / 22,092,625 bytes | 3,039.92 ms | 13.56 ms | <50 ms |
| Product single-chat lookup | 84.91 ms (read all) | 6.44 ms | <15 ms |
| Warm projection update, 1,000 turns | 379.62 ms | 5.15 ms | <16 ms |
| Hydrate 1,000 snapshots | 28 ms / 1,000 notifications | 1.22 ms / 1 notification | One notification |
| Tiny read queued behind maintenance | 3,069 ms | 5 ms | No multi-second blockage |

The audit's direct SQL single-row comparison was 5.89 ms. The 6.44 ms after result
uses the product reader, which joins authoritative summary metadata and parses
one transcript. These are small synthetic samples, not end-to-end frame timings.
All three median acceptance targets passed. See raw sample/p95 data in
`ios-simulator-after.json` and the preserved baseline JSON.

### Android synthetic results

API 36 / arm64 emulator: 8.35 ms maintenance, 4.41 ms targeted reads, 2.45 ms warm
1,000-turn projection, and 0.50 ms batch hydration with one notification. See
`android-simulator-after.json`. Builds were stopped during both measured runs.

### Retained memory

Both runtimes settled at six detail queries and 600 snapshots after each of three
20-chat cycles: one selected document plus five inactive documents. Previously,
the audit retained 2,000 snapshots after one such feed. The harness exercises the
actual QueryClient/residency/realtime integration; these are synthetic loads, not
60 manual navigation interactions.

Hermes heap capacity after the three cycles was 40/40/40 MiB on iOS and 28/28/32 MiB
on Android. Allocated bytes varied with GC: approximately 29.7/37.1/29.4 MiB on iOS
and 19.5/21.1/16.8 MiB on Android. These readings include harness overhead and do
not represent native image/Markdown memory or a forced-GC leak certification.
The 10 MiB serialized inactive budget is explicitly not a heap estimate.


### Native UI checks and limitations

- Fresh normal Release apps reached the sign-in screen on iOS and Android. No live
  account or model calls were used.
- iOS: native gallery rendering/dismissal and long-chat scrolling were checked.
  Three focused XCTest cases passed: history preview open/dismiss plus foreground
  restoration; typing while the production projection receives 100 ms snapshots;
  and two cycles of eight chat selections. The streaming test deliberately leaves
  the reader scrolled away from the tail, so it checks a fixture marker driven by
  the production projected state rather than requiring an offscreen virtualized
  row to appear in the accessibility tree. Earlier immediate foreground/visible
  row assertions were corrected in the test driver; no app behavior was changed
  to make those assertions pass.
- Android API 36: startup, long-chat rendering and scrolling, gallery open/dismiss,
  visible streaming output with typed text and the software keyboard, foreground
  return, and two cycles of eight chat selections were exercised. The native
  history preview is iOS-specific. Android's accessibility dump could not obtain
  idle state during active streaming; the live screenshot and a subsequent settled
  dump verified both the streamed content and typed draft.
- **Native process memory remains a limitation.** Android total PSS rose from
  507,526 KiB after the first UI switching cycle to 616,295 KiB after the second.
  PSS settled at 600,697 KiB after additional waiting. This growth is separate
  from the bounded six-document synthetic residency check and must not be described
  as a proven native leak fix. The UI fixture also retains synthetic API source
  documents, and these captures do not isolate native renderer caches, allocator
  behavior, or identify a leak's cause. Further native allocation profiling is
  needed before asserting a total process-memory plateau.
- These checks do not certify physical-device FPS, battery usage, live-server
  reconnect behavior, or production network latency. Reconnect/outbox/branch and
  cancellation correctness is covered by the automated suite, not a live account
  in the native UI fixture. Android API 37 emulator validation remains unavailable
  on this host; API 36 was used instead.

No deployment, server API changes, settings, or UI redesign were made.

## Large-account drawer follow-up

The closed drawer previously used `display: none`, so beginning a swipe restored
layout for its virtualized list. It now stays measured behind the chat view with
zero opacity while closed; pointer events and accessibility remain gated by drawer
visibility. History projection caches summary metadata without retaining transcript
objects, reuses date formatters, and preserves unchanged row/list references.
Section and folder grouping use one pass. Preview lookup uses a shared chat index,
and row preview callbacks retain identity.

Desktop Node microbenchmarks on the same host (five measured samples after three
warmups, 5,000 chats): summary generation fell from 139.44 ms to 2.73 ms; a warm
transcript-only update took 0.66 ms. Section grouping fell from 9.48 ms to 0.08 ms.
These measure JavaScript preparation, not native swipe latency or physical-device
frame rates. The iOS Release simulator fixture supports 5,000 summaries for the
`testLargeHistorySwipe` interaction check. That native test passed five swipe-open
and selection cycles plus search for the 5,000th chat on iPhone 17 Pro / iOS 26.5,
using the existing Release native shell with a freshly exported production-mode
fixture bundle. Raw screenshots/logs remain outside Git.

Regression coverage includes 5,000-chat projection, unchanged transcript updates,
ordering, removal/reinsertion, visibility, folders, expiry, and date boundaries.
Mobile type checking, repository lint, and all 441 mobile tests passed.

## Chat-selection slide follow-up

Historical implementation; the cached fast path below supersedes unconditional
selection after the slide.

Selecting a history row changed the active chat before starting the closing
spring. That started transcript hydration/projection and remounted the keyed
message list during the slide, including native Markdown and composer layout.
Selection now commits from the spring's successful completion callback. The
drawer retains keyboard/layout ownership until it closes; reduced motion and
persistent sidebars commit immediately.

A completion owner rejects callbacks from interrupted springs, superseded
selections, scope changes, and unmounts. New gestures and other navigation cancel
pending selection. The selected chat and account are rechecked at completion,
and temporary-chat cleanup is deferred until the selection actually commits.
This removes a known overlap of layout work and animation; physical-device frame
timing has not been quantified. Lint, mobile type checking, and 446 mobile tests
passed, including completion and cancellation regression coverage.

The 5,000-chat UI check also reproduced dropped search characters: a delayed
React filter update was written back over newer native text (the field contained
`Perfance chat 5000` after typing `Performance chat 5000`). The native search
binding now owns edits; only the explicit clear action writes it from JavaScript.
The UI test checks both the exact typed value and the resulting chat.

Both final XCTest cases passed on iPhone 17 Pro / iOS 26.5 using the Release
simulator shell and a fresh production-mode fixture bundle: five large-history
swipe/selection cycles with search, and two alternations between the 1,000-turn
and short transcripts with the keyboard dismissed. No raw run artifacts were
added to Git.

## Message-area placeholder during chat selection

Selection hides only the message area before starting the closing spring. The
existing header, model picker, chat controls, and composer stay mounted and
visible. A small skeleton in the message area replaces the old transcript while
the destination loads; there is no replacement header or full-screen cover.
For uncached selections, the hidden transcript remains mounted until the spring
completes. Cached selections prepare the destination viewport before movement,
as described below.

After selection commits, the placeholder remains until the destination's native
transcript layout is ready (or its loaded empty state has committed), then reveals
it on the next frame. Reveal callbacks belong to a specific selection; replacement
selections and scope changes invalidate them. The measured transcript identity
prevents a previous chat's viewport measurement from revealing new content early.
Reopening the drawer or navigating elsewhere cancels pending presentation.

Mobile type checking, lint, and all 446 mobile tests passed. The iPhone 17 Pro /
iOS 26.5 Release simulator shell with a fresh fixture bundle passed repeated
long/cached selections and the five-second uncached-load test, including same-chat
reselection and an empty-chat round trip. The latter now asserts that the model
picker and composer remain visible and hittable and that the skeleton sits
between them. Native visual inspection confirmed the normal chat controls and
composer during loading. Raw recordings, screenshots, and test logs remain
outside Git. Physical-device frame timing was not measured in this check.

## Overlap I/O with drawer closure

The initial overlap implementation described here deferred cached selection too;
the following cached fast path removes that latency regression.

Chat selection now starts its targeted SQLite read and network request on the
press. A per-selection gate delays JSON decoding, query publication, snapshot
hydration, projection, persistence, and native transcript mounting until the
closing spring completes. Response bodies can download as text while the gate is
closed. SQLite releases its operation queue before waiting, so outbox and required
writes continue. Resident detail skips the disk read and remains immediately
available to the existing selection path.

Preparing a chat pins it in the residency coordinator. Interruption releases the
pin and cancels an unobserved owned request; requests already serving another
consumer are reused. A newly attached observer can adopt preparation. Replacement
selections invalidate the previous completion immediately, and scope changes or
unmounts cancel outstanding preparation. Cancellation remains connected during
response-body transfer and prevents stale parsing/publication or auth handling.

This overlaps I/O waiting, not unbounded JavaScript or native layout work. It does
not eliminate the selected list's mount time or establish a physical-device
frame-rate guarantee.

Validation: 457 mobile tests, mobile type checking, lint, and both production
exports passed. Regression tests cover transfer before decode, queued writes
proceeding while decode is paused, resident reuse, cancellation during body
transfer, namespace isolation, observer adoption, optimistic edits surviving
cancellation, and replacement requests retaining ownership. All three iOS
Release-shell UI cases passed: 5,000-chat drawer/search, slow uncached/empty/same
chat selection with visible header/composer, and repeated long/cached selection.
Fixture request records confirmed that destination transfers began while the
previous chat was still selected. The final cancellation guards were validated
by automated tests; native frame timing and tap-to-content latency were not
quantified. No raw run artifacts were added to Git.

## Restore cached selection latency

The unconditional completion gate added a full closing spring before selecting
even an already projected chat. Resident chats now activate in the tap's React
commit. The destination viewport mounts while the drawer is open; the existing
message placeholder clears after native layout and one frame, then the slide
starts. Network decoding/publication remains gated until the slide completes.

Disk-backed selections allow local decode/publication during a 50 ms lookup
window before movement. A quick result follows the cached path. A missing,
failed, or slower result starts the content-placeholder slide and pauses further
local decode until completion. This is a JavaScript timer window, not a hard
deadline when JavaScript is busy. Reduced-motion and persistent-sidebar paths
do not wait for that window. Cancellation preserves request/namespace ownership,
observer adoption, and newer optimistic state.

Large-account refreshes also performed two native SQLite metadata reads per chat,
even for unchanged summaries. Batch refreshes now read existing summary payloads
and search titles in two queries, preserving single-chat targeted reads and
avoiding transcript/search-body work. A regression test verifies two metadata
queries and no writes for 100 unchanged summaries, including duplicate-ID update
ordering in a subsequent batch.

Validation: all 465 mobile tests, mobile type checking, repository lint, and both
iOS/Android production exports passed. The iPhone 17 Pro / iOS 26.5 Release shell
passed all three focused XCTest cases: 5,000-summary drawer/search, repeated
long/cached selection, and delayed uncached/empty/same-chat selection. Native
visual inspection confirmed that the placeholder remains confined to messages.

Selection measurements use a disposable simulator, the same Release native
shell and installed dependencies, 5,000 summaries, and alternating 1,000-turn and
one-turn transcripts. Comparison application sources are `dev` at `2dd9344e` and
the prior branch at `5f60522d`. Dev eagerly hydrates disk details at startup; its
first selections are already resident, so only warmed selections are comparable.
These are small samples, not production latency guarantees. Content-ready is a
native viewport-layout plus one-frame marker, not full Markdown settlement or
photon-level visibility.

| Warmed selection, tap to content-ready | Prior branch | Dev | Cached fast path |
| --- | ---: | ---: | ---: |
| 1,000-turn transcript | 537.8 ms | 81.6 ms | 116.0 ms |
| One-turn transcript | 619.3 ms | 78.1 ms | 111.5 ms |

Each cell is one warmed selection in the same alternating-chat test, with frame
sampling disabled. Resident activation itself took 0.2–0.3 ms after the tap on
the new path, instead of waiting 366–499 ms for spring completion. The first
disk-backed opens in the final run reached content-ready in 326.2/630.1 ms; they
still include decode, projection, and native mount work. Dev's eager startup
hydration makes its first-open numbers unsuitable for that comparison.

An additional instrumented run sampled UI callback gaps between JavaScript slide
notifications. Both dev and this change showed large gaps, including 100+ ms
outliers. JavaScript completion notifications can lag the actual native spring,
and simulator/XCTest overhead is included. This does not establish that device
animation is stutter-free; physical iPhone/Android validation remains necessary.
Raw timelines, frame samples, screenshots, and result bundles remain outside Git.
