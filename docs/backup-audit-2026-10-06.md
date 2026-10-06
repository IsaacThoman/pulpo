# Backup and restore audit — 6 October 2026

The original full backup was incomplete: it archived 50 of the 95 application tables, while restore's cascading truncation removed durable data that was absent from the archive. This audit corrected the coverage to 81 durable tables with 14 explicit exclusions, fixed additional restore and streaming failures, and verified recovery locally with PostgreSQL, filesystem blobs, Redis, a running API/worker, and a real browser.

The tested local recovery paths pass. This is not a certification of unattended recovery under concurrent production traffic or of a live Backblaze bucket. Those limits and the remaining defects are recorded below.

## Scope and environment

Reviewed database coverage and dependencies, temporary-chat privacy, archive creation and extraction, checksums, encryption, local and B2 storage, retention, scheduling, chunked restore uploads, database replacement, session invalidation, interrupted executions, and the administrator UI. Reviewed how durable data from authentication, chat, Files, collaborative documents, pools, billing, drafts, usage, analytics, speech, memory, and catalog features participates in recovery.

All destructive tests used migrated disposable databases: `pulpo_restore_test`, `pulpo_lossless_backup_test`, `pulpo_speech_backup_test`, `pulpo_backup_audit`, and `pulpo_backup_browser`. PostgreSQL ran on port 54439, Redis on 6399, the audit API on 3049, and the web UI on 5189. Existing application services and databases were not used. The browser used Chromium through Playwright because the T3 preview host explicitly reported that preview was unavailable.

## Findings corrected

| Severity | Original failure | Correction and evidence |
| --- | --- | --- |
| Critical | 31 durable tables were omitted; restore could erase Files, documents, passkeys, provider credentials, pools, billing, drafts, queues, usage windows, and request analytics. | Added all 31 in dependency order. A schema coverage test now requires every table to be backed up or explicitly excluded. PostgreSQL round trips compare durable rows across two restores. |
| High | Files blobs were absent, and restored Files keys were routed to the attachment API. | Archive ready Files blobs, remap their references, clean replaced blobs, and route restored Files keys through the Files API. Actual browser downloads return the exact original bytes. |
| High | Restored storage keys exceeded Fastify's default parameter limit and returned HTTP 414. | Raised the router parameter allowance to 4096. The running application successfully served restored Files and attachment URLs. |
| High | Collaborative document `bytea` values, generated update sequence values, and child-before-parent Files trees did not have a safe import path. | Encode binary columns as PostgreSQL hex, explicitly import identity values and reset their sequence, and stage the entire Files tree before inserting it. A reversed 105-folder chain, Yjs snapshot plus pending update, and subsequent update insertion pass. |
| High | Newly required columns absent from old v1 archives became explicit nulls rather than receiving database defaults. | Insert only properties present in each archive row. Legacy archives without newer tables and user columns restore successfully; malformed required values still roll back. |
| High | Adding draft and queue tables without projection rules would retain temporary chat content or dangling attachment references. | Exclude temporary queues and unsent drafts, remove their blobs, filter affected durable references, and redact temporary response links from analytics. Projection tests cover these cases without mutating the source snapshot. |
| High | B2 cleanup used an unversioned delete, which hides an object rather than permanently removing its versions. | Enumerate exact-key versions and hide markers, delete by version ID, handle pagination, and preserve retryable failures for locked versions. Mocked SDK tests exercise these cases; a local HTTP S3 fixture validates connection-probe requests. Backblaze documents the versioned deletion behavior in its [Delete Object API](https://www.backblaze.com/apidocs/s3-delete-object). |
| High | Backup creation buffered whole blobs, and local archive download buffered the full archive on the server. | Stream each source blob to private disk while validating its checksum, then stream it into tar. Stream archive downloads from storage. Large-payload smoke tests run with a 96 MiB JavaScript heap. |
| High | Encryption source errors did not reliably reach the ciphertext consumer or checksum promise. | Use a pipeline that propagates failure to both consumers. Source failure, empty input, chunk boundaries, tampering, wrong private identity, and classic/hybrid recipient round trips pass. |
| High | Restored active responses and tool/agent runs could remain stuck; a dispatching queue entry could send twice. | Cancel interrupted execution state while retaining prompts and partial output. Remove dispatches whose response exists; return other interrupted dispatches to pending. PostgreSQL tests verify both branches. |
| Medium | Local backup requests could leave uncaught UI errors, allow repeated clicks, and download without an archive filename. | Disable the button while working, display request/poll/download errors and polling timeout, and supply `.tar.gz` / `.tar.gz.age` filenames. The browser verifies request failure recovery and successful local download. |

Older archives remain readable, but the omitted data never entered those archives. Compatibility cannot reconstruct it. Restoring an older archive still replaces the current contents of the newly included tables. Create and verify a new backup after applying these changes.

## Validation results

| Check | Result |
| --- | --- |
| Full server suite | 215 files, 1299 passing tests; 26 integration files / 272 tests skipped by their opt-in guards. |
| Full web suite | 190 files, 1063 passing tests. |
| Full mobile suite | 99 files, 827 passing tests. |
| Shared client-core suite | 13 files, 164 passing tests. |
| Contracts suite | 11 files, 118 passing tests. |
| Desktop suite | 9 files, 53 passing tests, plus 3 vendor checks. |
| Real PostgreSQL restore-upload suite | 14 passing tests. |
| New PostgreSQL application round trips | 6 passing tests. |
| PostgreSQL lossless conversation/tool/OCR round trip | 1 passing test. |
| PostgreSQL speech assets and legacy archive round trip | 1 passing test. |
| Final encryption and schema coverage checks | 9 encryption tests and 2 coverage tests passed, including the subsequently added wrong-identity case. |
| Final focused web restore/settings checks | 23 passing tests. |
| Server and web production builds | Passed. Web build emitted its large-chunk advisory. |
| Repository lint and patch whitespace | Passed. |

The first broad server/web runs were launched alongside other suites and produced five timeouts. Rerunning both complete suites with two workers passed every test. These were timeout failures, not assertion failures. The guarded PostgreSQL suites listed separately were explicitly enabled and run; the remaining optional integration suites were not enabled.

The restore-upload integration suite exercises concurrent and out-of-order parts, idempotent retries, wrong owners, invalid sizes/indices, checksum mismatch, conflicting retries, explicit confirmation, enqueue failure recovery, expiry cleanup, stalled-worker handling, encrypted-input refusal, archive corruption, transactional rollback, staged-blob cleanup, cache invalidation failure after commit, repeated restores, long object keys, and rebuilt search indexes.

The new application fixture exercises passkeys and provider credentials, pool membership and invitations, invite codes, billing records, all four usage-window tables, analytics and tool counts, composer and shelved drafts with attachments, pending messages, Files layouts and agent changes, binary Yjs state and pending updates, identity sequence continuity, and excluded sessions. A separate test verifies interrupted response/tool/agent recovery. Missing and corrupted source blobs fail backup creation without publishing an archive. The scheduler test uses real PostgreSQL and encryption with an in-memory remote store to exercise enqueue reconciliation, overlapping schedule calls, recipient metadata, retention eligibility, decrypting the created archive, and restoring it.

The live browser test used the actual API and maintenance worker. It created a Unicode document, a 17 MiB random binary file, and a Unicode chat attachment; injected a backup-request failure and verified the UI recovered; downloaded a backup with the correct filename; removed the document and created a newer one; required uppercase `RESTORE`; paused and resumed a multi-part upload; restored the instance; signed in after session invalidation; verified the original document returned and the newer document disappeared; and compared both restored downloads byte for byte. No uncaught page errors were recorded.

The backup memory smoke test serialized 574,884,912 bytes of database JSON and staged/restored a 402,653,184-byte blob with 56,000 rows. Peak RSS was 228 MiB under a 96 MiB JavaScript heap. The standalone restore smoke test recovered approximately 99 MiB of JSON and a 384 MiB blob with 10,000 rows at 192 MiB peak RSS. These measure serialization, blob staging, archive handling, and streaming parsing; they do not measure the full database-query/projection memory footprint.

## Remaining defects and operational limits

| Priority | Limit | Consequence / follow-up |
| --- | --- | --- |
| High | No global mutation barrier during full restore. | In-flight API requests, generation, billing, and document work can race with database replacement. Use a maintenance window, block new mutations, and drain or pause other queues while leaving restore processing available. Add a shared maintenance barrier before promising recovery under active traffic. |
| High | B2 and general S3 stream uploads use single `PutObject` requests. | Large archives or individual restored blobs can exceed the provider's single-upload limit. Backblaze's [official upload example](https://github.com/backblaze-b2-samples/b2-browser-upload/blob/main/README.md) documents a 5 GB limit and multipart requirements. Implement multipart uploads; the 20 GiB restore input limit does not establish 20 GiB cloud-storage support. |
| Medium | Local backup creation and the legacy whole-file restore endpoint lack the durable enqueue reconciliation used by offsite backups and chunked restores. | A PostgreSQL insert followed by a Redis failure can leave a queued job with no worker job. Extend reconciliation to these paths. The legacy restore endpoint also does not share the chunked restore concurrency gate. Prefer the current chunked UI. |
| Medium | Restore replaces operational backup/export history. | Existing remote archives may remain but lose application retention tracking and UI discoverability. Preserve a recovery inventory or implement post-restore remote reconciliation. An independent bucket lifecycle policy must respect Object Lock. |
| Medium | Database snapshot and projection still load all selected rows into memory. | The streaming archive improvements do not make total backup memory independent of database size. Stress-test actual production-size queries and move projection/reading to bounded processing if required. Manifest/reference indexes also grow with object count. |
| Medium | The browser download helper buffers the response as a Blob. | Server streaming alone does not guarantee a large backup can be downloaded on a memory-constrained browser or native webview. Validate target devices or add a streaming/native download path. |
| Required validation | No live Backblaze credentials or production-size dataset were supplied. | Bucket permissions, Object Lock expiry, version cleanup, and real multi-GB upload/download were not tested against Backblaze. Local HTTP fixtures and SDK mocks cannot establish live bucket behavior. |
| Required validation | No live iOS/Android/Electron recovery session or external-provider recovery was performed. | Mobile/desktop automated suites passed, but physical-device behavior, Stripe reconciliation, provider-managed voice resources, workspace containers, and upstream credential validity remain external checks. |

Backups cover server-side durable state. Unsynced client-only drafts, environment variables, the deployment `ENCRYPTION_KEY`, the offline age identity, and provider-managed resources are not reconstructed by the archive. Retain deployment recovery material. A restored database represents the backup's point in time; external billing/provider systems need reconciliation before normal work resumes. Local `.tar.gz` backups contain readable application content and should be protected; offsite `.tar.gz.age` files provide archive encryption.

## Repeat the focused audit

Create and migrate each named disposable database first. These tests intentionally replace its contents; use neither production URLs nor a development instance holding useful data.

```sh
NODE_ENV=test DATABASE_URL=postgres://USER:PASSWORD@HOST/pulpo_backup_audit \
  PULPO_BACKUP_AUDIT_TESTS=true npm run test -w @pulpo/server -- \
  src/admin/backup-roundtrip.postgres.test.ts \
  src/admin/backup-coverage.test.ts src/admin/backup-encryption.test.ts

NODE_ENV=test DATABASE_URL=postgres://USER:PASSWORD@HOST/pulpo_restore_test \
  PULPO_RESTORE_TESTS=true npm run test -w @pulpo/server -- \
  src/admin/restore-uploads.integration.test.ts

NODE_ENV=test DATABASE_URL=postgres://USER:PASSWORD@HOST/pulpo_lossless_backup_test \
  PULPO_LOSSLESS_BACKUP_POSTGRES_TEST=1 npm run test -w @pulpo/server -- \
  src/admin/lossless-backup.postgres.test.ts

NODE_ENV=test DATABASE_URL=postgres://USER:PASSWORD@HOST/pulpo_speech_backup_test \
  PULPO_SPEECH_BACKUP_POSTGRES_TEST=1 npm run test -w @pulpo/server -- \
  src/speech/backup.postgres.test.ts

npm run test:backup-memory -w @pulpo/server
npm run test:restore-memory -w @pulpo/server
```

Local run logs, the browser harness, downloaded fixture archive, result JSON, and screenshots are in `/tmp/pulpo-backup-audit`. They are disposable local evidence, not required application files. The live browser result is recorded in `browser-results.json`; the successful UI run is in `browser-final.log`.
