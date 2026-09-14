# Diagnostic logging and retention

Admin → Settings → Logging controls diagnostic copies, not chat history.

Every observed provider HTTP attempt has a durable `provider_diagnostics` record
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
state, while `tool_executions` retains execution and billing metadata.

Capture is limited to 128 KiB per direction. Credentials, signed URL query
strings, and binary media are omitted. Multipart requests describe file type
and byte size; they do not duplicate uploaded files. Captures declare `exact`
(for a complete unmodified JSON value), `redacted`, `reconstructed` (including
parsed SSE events), or `truncated`. These are JSON diagnostics, not a byte-for-byte
network archive. Error messages are bounded and credential-redacted but may still
quote short provider explanations; do not treat operational metadata as a place
for arbitrary request bodies.

Expiry applies at read time and is checked by the database on late writes.
A dedicated worker clears expired request, OCR, provider, and legacy tool copies
every minute and at startup. Disabling capture clears diagnostic copies in the
settings transaction. Shortening retention applies from original collection time;
extending it cannot revive expired bodies. Calls associated with a chat request
inherit that request's deadline. Standalone speech/dictation use their own
collection time. Billing and sanitized operational metadata survive expiry.

The cleanup panel reports last success, records cleared last run, overdue records,
and consecutive failures. It alerts on three consecutive failures, a growing
backlog, or no successful run within five minutes. Worker failures and backlog
alerts are also structured server log events. These are admin/server alerts;
no email or external notification destination is configured by this feature.

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

Apply migration `0076_provider_diagnostics.sql` before replacing the worker/API.
It only adds a table and indexes and is compatible with the previous release.
