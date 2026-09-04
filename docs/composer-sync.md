# Composer synchronization

Signed-in web, desktop, and mobile clients share an unsent draft per chat, plus one `new` draft per account. Text is sent at most every 150 ms while typing; uploaded attachments and composer controls are sent immediately. Uploading files, microphone state, cursor position, and message editing sessions remain local.

The server stores independent field patches under a monotonically increasing revision. Model and preset choices form one field. Online conflicts retry the changed fields against the latest revision. Reconnecting clients fetch the server snapshot before replaying: a changed server revision discards conflicting pending local changes and adopts the server draft.

Successful submissions clear only the matching draft. Cleared revisions remain as tombstones. Pending edits and outstanding conditional clears use the existing account-scoped local databases. Draft writes do not change chat ordering or account revision.

## Browser opt-out

Web Interface settings include **Sync composer drafts**, enabled by default. Turning it off stops this browser's draft reads, writes, and realtime subscriptions immediately. Normal chat messages and local draft saving continue. The preference stays on this browser, applies to its open tabs, and does not change mobile settings or delete existing server drafts.

Turning sync back on resumes the shared server draft. Queued updates from before opting out are retired so they cannot be uploaded later. Deploy the matching server update to stop delivery of composer events to opted-out sockets; clients also ignore those events defensively.

## Rollout

1. Run `npm run db:migrate` before starting the updated server. Migration 0059 preserves the earlier composer tables and migrates their content and attachment references.
2. Deploy the server, then updated clients. Existing clients can continue using their local drafts; updated clients tolerate servers without composer socket handlers by retaining local pending state.
3. Check two signed-in clients on the same account: type in an existing chat and the new-chat composer, change controls, upload a file, send, and background/resume mobile. Confirm an offline conflict adopts the server draft without a recovery prompt.

The socket protocol adds `composer.read`, `composer.write`, and `composer.changed`. It uses normal authenticated account rooms and rejects administrative chat-access sessions. Attachment IDs must refer to accessible, ready uploads owned by the account; metadata is loaded from the server. Chat deletion/expiration clears draft content and references; temporary new-chat drafts use the existing 48-hour lifetime and maintenance cleanup.
