# Web performance implementation validation

Implements the first four recommendations from the September 6, 2026 audit: isolate message rendering, coalesce incremental persistence, defer authenticated UI, and coordinate bootstrap/reconnect work.

## Measured results

| Production login JavaScript | Audited baseline (`e5bbccbc`) | Implementation |
| --- | ---: | ---: |
| Decoded bytes | 1,562,943 | 752,421 |
| Sum of per-file gzip bytes | 491,832 | 244,439 |
| JavaScript files | 87 | 35 |

Computed from the entry and login route's static Vite import graph, deduplicating shared files. The implementation is based on `dev` at `9a495127`; intervening upstream changes are included. Gzip totals describe compressible asset size, not measured network transfer. Browser resource inspection independently confirmed that login does not download Markdown, settings, or the authenticated layout. Settings and search chunks load when opened.

Message rendering regression tests mount the real row component with Markdown replaced by a simple text renderer to isolate row work. For both 200- and 1,000-message transcripts, a background chat update renders zero message rows; updating one foreground message renders exactly that row. Unchanged messages retain their object identities after server hydration.

## Validation performed

- Full repository `npm test`, `npm run build`, and `npm run lint` passed using Node 24.11.1. After the final web-only durability changes, reran web tests (112 files, 465 tests), the web production build, and repository lint.
- New tests cover bootstrap request sharing/concurrency and logout races; reconnect coalescing, scoped invalidation, and cursor resubscription; persistence coalescing, transaction ordering/failure, unchanged record reuse, legacy restoration, and temporary-chat exclusion.
- Chromium production preview with local synthetic API fixtures: 200 chat summaries and 100 response turns. Verified streaming text updates preserve existing message DOM and the composer draft. Completed response text and the draft survive reload while the chat detail API is unavailable.
- IndexedDB instrumentation confirmed that streaming/completion writes only the changed transcript body plus the cache envelope. An unsuccessful background refetch no longer discards successful offline data; forbidden responses remain excluded.
- Opened and searched the lazy search dialog, opened/closed/reopened settings, and signed out through the account menu. Sign-out removed all query-cache envelope and transcript records.

The browser uses synthetic API responses and intentionally aborts the socket transport and offline detail requests. Socket coordination is covered separately by mocked integration tests. These checks do not measure production server latency, Core Web Vitals, or behavior on low-end physical devices. IndexedDB lifecycle flushing remains best effort when the browser forcibly terminates a page; terminal response snapshots flush immediately during normal operation.

## Storage compatibility

The v2 cache stores transcript bodies separately from query metadata. It reads legacy v1 envelopes and removes the legacy key after the first successful atomic v2 write. A rollback to an older bundle will rebuild its optional query cache. Composer drafts and queued mutations retain their existing storage formats. Retention remains bounded by the existing chat-count and byte limits.
