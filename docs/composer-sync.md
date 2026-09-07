# Composer synchronization

Signed-in web, desktop, and mobile clients share an unsent draft per chat, plus one `new` draft per account. Text is sent at most every 150 ms while typing; uploaded attachments and composer controls are sent immediately. Uploading files, microphone state, cursor position, and message editing sessions remain local.

The server stores independent field patches under a monotonically increasing revision. Model and preset choices form one field. Online conflicts retry the changed fields against the latest revision. Reconnecting clients fetch the server snapshot before replaying: a changed server revision discards conflicting pending local changes and adopts the server draft.

Successful submissions clear matching text and attachment IDs, preserving changes to model, presets, and other composer controls. The submitting composer keeps that content hidden from sync notifications while awaiting acceptance; new local or remote content remains editable. Cleared revisions remain as tombstones. Pending edits and outstanding conditional clears use the existing account-scoped local databases. Draft writes do not change chat ordering or account revision.

On mobile, submission owns the optimistic clear for its original draft scope, text, and attachment selection. Preparation, queue acceptance, or failure cannot clear or restore over a newer draft or a different chat. Empty runtime drafts remain cached so a quick chat switch cannot hydrate stale disk content before the asynchronous save finishes. Acceptance does not delete the current local draft.

## Temporary mode

Temporary mode is local to each client. Temporary composers neither publish drafts nor apply incoming shared drafts, and the temporary toggle is excluded from shared field patches. Toggling temporary mode in an unstarted new chat moves the current composer into a separate in-memory slot, including text, attachment order and upload ownership, model, presets, Agent mode, and expiration controls. The shared draft's text and attachments are conditionally cleared; other devices retain their controls. Pending typing is retired, and an in-flight write is identified by its mutation receipt so a late acknowledgement cannot resurrect the moved draft. Upload completions follow their new owner and do not update the shared draft while temporary.

Offline entry keeps the composer local immediately and records only revision/mutation metadata for the shared clear. Other devices retain the old shared content until reconnect. A newer shared revision is preserved. Leaving temporary mode before the chat starts explicitly publishes the current composer again, including its controls. If another device created a divergent shared draft, its text and attachments are saved to the existing shelf before replacement. Returns remain pending across connection failures and reconciliation cannot replace them with stale hydration. Ordinary navigation still uses independent draft slots; saving an existing temporary conversation is unchanged. With composer sync disabled, the toggle moves only the local draft.

The server rejects reads and writes for temporary chats and rejects entire writes that enable temporary mode, including older clients. A legacy temporary `new` draft is cleared before it can be returned, and temporary realtime snapshots and pending client checkpoints are not replayed. Normal composer synchronization resumes when the client returns to a normal draft.

## Account opt-out

Interface settings include **Sync composer drafts**, enabled by default. This is an account preference, propagated through the same settings synchronization as other preferences. Web, desktop, and mobile honor it. Turning it off stops draft reads, writes, and realtime delivery; normal messages and local draft saving continue. Existing server drafts remain.

Turning sync back on resumes the shared server draft. Pending updates from before opting out are retired. Offline clients receive the account setting when they reconnect. The server also checks the account preference before accepting draft operations or broadcasting drafts, including requests from older clients.

[Shelved drafts](./shelved-drafts.md) are explicit account-wide saves and synchronize independently of this preference. Shelf restores change only text and attachments; a divergent restored draft displaced during composer reconciliation is preserved as a recoverable shelf copy.

## Rollout

1. Run `npm run db:migrate` before starting the updated server. Migration 0059 preserves the earlier composer tables and migrates their content and attachment references.
2. Deploy the server, then updated clients. Existing clients can continue using their local drafts; updated clients tolerate servers without composer socket handlers by retaining local pending state.
3. Check two signed-in clients on the same account: type in an existing chat and the new-chat composer, change controls, upload a file, send, and background/resume mobile. Confirm an offline conflict adopts the server draft without a recovery prompt.

The socket protocol adds `composer.read`, `composer.write`, and `composer.changed`. It uses normal authenticated account rooms and rejects administrative chat-access sessions. Attachment IDs must refer to accessible, ready uploads owned by the account; metadata is loaded from the server. Chat deletion/expiration clears draft content and references.
