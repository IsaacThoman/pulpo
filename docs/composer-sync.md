# Composer synchronization

Signed-in web, desktop, and mobile clients share an unsent draft per chat, plus one `new` draft per account. Text is sent at most every 150 ms while typing; uploaded attachments and composer controls are sent immediately. Uploading files, microphone state, cursor position, and message editing sessions remain local.

The server stores independent field patches under a monotonically increasing revision. Model and preset choices form one field. Online conflicts retry the changed fields against the latest revision. Reconnecting clients fetch the server snapshot before replaying: a changed server revision discards conflicting pending local changes and adopts the server draft.

Successful submissions clear matching text and attachment IDs, preserving changes to model, presets, and other composer controls. The submitting composer keeps that content hidden from sync notifications while awaiting acceptance; new local or remote content remains editable. Cleared revisions remain as tombstones. Pending edits and outstanding conditional clears use the existing account-scoped local databases. Draft writes do not change chat ordering or account revision.

On mobile, submission owns the optimistic clear for its original draft scope, text, and attachment selection. Preparation, queue acceptance, or failure cannot clear or restore over a newer draft or a different chat. Empty runtime drafts remain cached so a quick chat switch cannot hydrate stale disk content before the asynchronous save finishes. Acceptance does not delete the current local draft.

## Account opt-out

Interface settings include **Sync composer drafts**, enabled by default. This is an account preference, propagated through the same settings synchronization as other preferences. Web, desktop, and mobile honor it. Turning it off stops draft reads, writes, and realtime delivery; normal messages and local draft saving continue. Existing server drafts remain.

Turning sync back on resumes the shared server draft. Pending updates from before opting out are retired. Offline clients receive the account setting when they reconnect. The server also checks the account preference before accepting draft operations or broadcasting drafts, including requests from older clients.

## Rollout

1. Run `npm run db:migrate` before starting the updated server. Migration 0059 preserves the earlier composer tables and migrates their content and attachment references.
2. Deploy the server, then updated clients. Existing clients can continue using their local drafts; updated clients tolerate servers without composer socket handlers by retaining local pending state.
3. Check two signed-in clients on the same account: type in an existing chat and the new-chat composer, change controls, upload a file, send, and background/resume mobile. Confirm an offline conflict adopts the server draft without a recovery prompt.

The socket protocol adds `composer.read`, `composer.write`, and `composer.changed`. It uses normal authenticated account rooms and rejects administrative chat-access sessions. Attachment IDs must refer to accessible, ready uploads owned by the account; metadata is loaded from the server. Chat deletion/expiration clears draft content and references; temporary new-chat drafts use the existing 48-hour lifetime and maintenance cleanup.
