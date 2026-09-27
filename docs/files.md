# Files

The Files tab is an account-owned tree of folders, uploaded files, and collaborative documents (`file_nodes`). It is separate from chat folders and chat attachments. Admins can hide it with **Enable Files** in general settings; stored files are kept.

## Tree

Names are unique among live siblings, case-insensitively. Creating or renaming into a taken name fails; uploads, new documents, and restores pick the next free `Name (2)` instead. Folders nest at most 32 levels, and a folder cannot move into its own subtree. Tree mutations take a per-account advisory lock, bump the account revision, and publish the `files` invalidation scope so other sessions refetch.

Trashing marks the whole subtree with the trashed node as its `trash_root_id`; restore returns that batch. An item whose original folder is still trashed returns to the top level. Trash is purged after 30 days, and uploads never confirmed are purged after 24 hours.

## Uploads

Uploads use the attachment flow (reserve, PUT, confirm) with `users/<id>/files/<node>` object keys and the same per-file cap. Files blobs, including trashed ones, and document state count toward the account storage allowance together with chat attachments. They do not reuse the `attachments` table, because chat purges delete attachments claimed by a chat.

## Documents

Documents are edited as rich text (TipTap/ProseMirror) and stored as Yjs state. The editor schema lives in `@pulpo/client-core/doc-schema` so web, server, and future clients agree on it; changing its nodes or marks requires bumping `DOC_SCHEMA_VERSION`, and the server rejects joins from other versions.

Clients sync over the account Socket.IO connection in `doc:<id>` rooms:

- `doc.join` sends the client's state vector. The server joins the room, then answers with the update the client lacks and the server's state vector. The client pushes whatever the server lacks. This handshake runs on every connect, so it also uploads edits made offline and updates whose acknowledgement was lost.
- `doc.update` is appended to `file_doc_updates` before it is broadcast to the room. Clients coalesce keystrokes for 50 ms and keep one update in flight.
- `doc.awareness` relays cursors and selections without persisting them. A join asks peers to resend their state, and leaving or disconnecting removes the session's cursor.
- Trashing or deleting a document sends `doc.closed`, and the editor becomes read-only.

API instances hold no documents in memory. Loading merges `file_docs.state` with every remaining log row in one repeatable-read transaction. The worker's `file-docs` queue compacts the log: it locks the document row, folds the rows it read into a garbage-collected snapshot, deletes exactly those rows, and refreshes the derived `markdown` column. A sequence watermark is not used because identity values can commit out of order. Maintenance reschedules compaction for any document left with pending updates.

Markdown is derived, not authoritative. Export and previews use it; imports and future server-side edits convert Markdown to the schema and apply it with a minimal `updateYFragment` diff, never by replacing state, because other replicas would merge old content back.

Web keeps each opened document in IndexedDB (`pulpo-doc:<account>:<doc>`) for instant loads and offline editing; these databases are removed on sign-out.
