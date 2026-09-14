# Diagnostic logging and retention

Admin → Settings → Logging controls diagnostic copies, not chat history.

Observed provider HTTP attempts are recorded on a best-effort basis in `provider_diagnostics`
with provider/model identity, purpose, operation/model-call linkage, endpoint
(without credentials or query strings), HTTP status, provider request ID,
Retry-After, elapsed time, first token time when observed, and bounded sanitized
error details. A model retry or SDK retry creates another record. Image edits
also record reference format, byte size, and dimensions. User charges continue
using the existing accounting records; diagnostics never determine billing.

With detailed logging enabled, each attempt can retain a request and response.
Image generation/editing, chat, speech, dictation, and internal title, memory,
OCR, and compaction calls share this mechanism. Transports without an HTTP hook
retain reconstructed model-call data. Agent tools retain reconstructed diagnostic
copies of arguments and output; conversation copies remain in response/agent
state, while new `tool_executions` rows retain execution and billing metadata.
Historical tool arguments/output are preserved, including on backup/restore.
There is no automatic retroactive purge of these historical fields.

Capture is limited to 128 KiB per direction. Credentials, signed URL query
strings, and binary media are omitted. Multipart requests describe file type
and byte size; they do not duplicate uploaded files. Captures declare `exact`
(for a complete unmodified JSON value), `redacted`, `reconstructed` (including
parsed SSE events), or `truncated`. These are JSON diagnostics, not a byte-for-byte
network archive. Error messages are bounded and credential-redacted but may still
quote short provider explanations; do not treat operational metadata as a place
for arbitrary request bodies.

Provider calls and stream completion never wait for diagnostic database writes.
A process-local writer coalesces start/header updates and completion, with at most
128 pending records / 16 MiB and batches of 16 (plus one in-flight batch). It uses
one separate PostgreSQL connection, a one-second statement timeout, a 100 ms lock
timeout, and a two-second connection timeout. Queue overflow, serialization errors,
and failed batches are dropped and reported in rate-limited `diagnostics.dropped`
server events. There are no automatic retries. Shutdown allows a two-second flush.
Process crashes can lose pending diagnostics; billing stays on its existing durable
accounting path. Failed or stalled diagnostics cannot fail a user request.

Capture policy is warmed at API/worker startup and refreshed in the background when
older than five seconds. Unknown policy or a cache older than 30 seconds disables
body capture. Enabling logging can therefore take up to a refresh to affect a
process. Disabling is enforced immediately by the database and inspection API,
even if a process still has an older cached policy. A logging-only policy row and
epoch guard queued writes; provider calls never acquire the global settings lock.
The writer locks that policy row only for its bounded insert statement. An expiry
cutoff prevents extending retention from reviving copies that expired under an
earlier, shorter policy, even when physical cleanup has a backlog.

Payload expiry applies at read time and on late writes. Calls associated with a
chat request inherit its collection time and deadline. Standalone calls use their
own collection time. All provider/tool diagnostic rows, including standalone speech
and dictation, have a **90-day maximum lifetime**. Payloads cannot outlive their row,
even when detailed payload retention is set to indefinite. Authoritative billing,
conversation, and historical tool records retain their existing lifetimes.

A worker runs at startup and every minute, clearing up to 500 request bodies,
500 OCR bodies, and 500 provider bodies and deleting up to 500 old diagnostic rows
per run. It uses partial indexes and bounded statements without the global advisory
lock. Disabling capture makes provider bodies inaccessible immediately; physical
removal happens in these batches. Existing legacy request/OCR settings reconciliation
continues to enforce their established policy. Large backlogs may take multiple runs.

The worker stores a cleanup snapshot with its timestamp, last success, cleared and
deleted records, bounded overdue counts, and failures. Admin polling reads that one
settings row; it does not scan diagnostic tables. A capped count is displayed as a
lower bound. Alerts cover three consecutive failures, a growing observed backlog,
or no successful run within five minutes. These are admin/server alerts; no external
notification destination is configured.

Chat history, attachments, saved agent context, and backups have their own
lifetimes. New backups scrub expired diagnostic copies; restoring a backup
cannot extend the saved deadline. Existing archives are not rewritten.
Temporary-chat diagnostics are excluded from full backups. No migration can
recover error bodies or request IDs that were previously discarded.

CLI inspection (requires admin `usage:read`):

```sh
pulpo usage diagnostics
pulpo usage diagnostics MODEL_CALL_OR_REQUEST_LOG_ID
pulpo usage diagnostic-payloads DIAGNOSTIC_ID
pulpo usage retention-status
```

The equivalent management endpoints are below `/api/management/v1/usage`:
`GET /diagnostics`, `GET /requests/:id/diagnostics`,
`GET /diagnostics/:id/payloads`, and `GET /diagnostics/retention`.
The list endpoint accepts `requestLogId`, `modelCallId`, `limit` (1–100),
and `before` (ISO timestamp). Existing `usage payloads` still reads legacy
request-level and OCR payloads.

Apply migrations `0076_provider_diagnostics.sql` and `0077_diagnostic_writer_policy.sql`
before replacing the worker/API. They add diagnostic storage, a logging-only policy
row, an epoch column, and cleanup indexes. They do not delete historical tool data.
Backup restores preserve valid diagnostic deadlines and assign a fresh policy epoch;
queued writes from before a restore cannot revive imported bodies.
