# Bulk attachment local validation

Validated September 10–11, 2026 on macOS with an isolated PostgreSQL 17 + pgvector database, Redis, the real API and Socket.IO server, local object storage, and development clients. No production data or external model calls were used.

## Live checks

- Two authenticated users each uploaded 500 files (300 PNG images at 1600×1200 and 200 text files). Both drafts retained all 500 files in order. Each client's upload concurrency peaked at three.
- The batches produced 500 and 506 attachment-reference inserts, with zero and six position-repair deletes. Twenty subsequent typing/flush operations per user produced **zero** attachment-reference writes.
- Each user loaded 300 real generated thumbnails successfully, then repeated the requests from the server cache. Cold passes took about 13.2 seconds; warm passes took 7.3–7.9 seconds. Uploads took about 259 seconds per user while a native build and browser batch shared the host. These are development smoke measurements, not production throughput targets.
- A separate **1,000 MiB** file went through real HTTP reservation, streamed PUT, and checksum/MIME confirmation successfully in 46.7 seconds during concurrent bulk work. The API ran with a 256 MiB JavaScript heap limit; sampled process RSS peaked at **294 MiB**. RSS includes native buffers and exceeds the JavaScript heap limit. Sampling is not a proof of an absolute memory ceiling.
- The real workspace daemon integration test staged 500 files, opened no object streams on the second pass, and restaged only two files after one modification and one deletion. A checksum mismatch preserved the previous file. Older daemon fallback was exercised.

- Real browser file-picker upload: 500 files completed without failures. Paging reached file 499; only 20 cards were mounted. The completed batch survived a reload with exactly 500 ready files and 500 unique server IDs. A sampled image page showed 16 preview images with no broken images. The stale-checkpoint regression also has a focused recovery test.

## Automated checks

- Web: 636 tests across 135 files.
- Mobile: 620 tests across 91 files.
- Contracts: 98 tests; shared client core: 121 tests.
- Server attachment/composer/prompt/staging checks: 45 tests; workspace controller: 18 tests.
- Web production build, server/controller/daemon TypeScript builds, mobile typecheck, and repository lint passed.
- A fresh Debug iOS simulator build succeeded for the iPhone 17 Pro / iOS 26.5 target. Simulator interaction was not verified: the Mac locked during the run and the UI tool could not unlock it.
- The host runs Node 26. Web tests used `NODE_OPTIONS=--no-experimental-webstorage` so jsdom supplies browser storage; Node's experimental global otherwise shadows it. Tests initially timed out while an unrestricted native build saturated the host; they passed after limiting build and test parallelism.

## Reproduction and limits

The API/Socket.IO/database runner is `apps/server/scripts/bulk-attachments-smoke.ts`; its local database and fixture prerequisites are described in [File uploads](../attachments.md). It uses real endpoints and counts reference-table mutations through a temporary trigger. Unit tests additionally cover concurrency, retries, image thresholds, bounded thumbnail caches, pagination, ordering, and sync coalescing.

The large-file check covered local storage, not a live S3 bucket or a production reverse proxy. No external model generation or production multi-instance capacity test was run. Workspace images must include the new daemon to skip unchanged staged files; old images still accept uploads. Transfers remain single PUTs and restart after interruption.
