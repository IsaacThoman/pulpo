# Files

The Files tab is an account-owned tree of folders, uploaded files, and collaborative documents (`file_nodes`). It is separate from chat folders and chat attachments. Admins can hide it with **Enable Files** in general settings; stored files are kept.

## Tree

Names are unique among live siblings, case-insensitively. Creating or renaming into a taken name fails; uploads, new documents, and restores pick the next free `Name (2)` instead. Folders nest at most 32 levels, and a folder cannot move into its own subtree. Tree mutations take a per-account advisory lock, bump the account revision, and publish the `files` invalidation scope so other sessions refetch.

Trashing marks the whole subtree with the trashed node as its `trash_root_id`; restore returns that batch. An item whose original folder is still trashed returns to the top level. Trash is purged after 30 days, and uploads never confirmed are purged after 24 hours.

Selections act through `POST /api/files/batch/{move,copy,trash,restore,delete}`. Each batch runs in one transaction, so every item changes or none does. A folder listed together with its own contents is treated as the folder alone. Batch moves keep both items on a name clash and return the final names, which lets clients undo a move by moving each item back to its original folder and name.

Copying writes folders and documents in the same transaction that reserves storage for the whole selection. Uploaded files are inserted as pending, duplicated inside the object store (`BlobStore.copy`), then marked ready; a failed object copy removes its placeholder instead of leaving a visible file without bytes.

## Side panel

A file or chat can open beside the current view (**Open to the side**, or Alt/Option-click in Files) while the main view keeps navigating between chats and folders. The panel is window state mirrored into `?side=file:<id>`, `?side=chat:<id>`, or `?side=chat:new`, so reloads and shared links reopen it and navigation carries it along. It docks and resizes on wide windows, becomes a drawer below 1100px, and a full-screen sheet on phones.

The header's **Open in new tab** button opens the file or chat in its own browser tab; the desktop app, which has no tabs, shows **Open as page** there instead, moving the content into the main view. The same file or chat is never shown in both. **Maximize** (Cmd/Ctrl+Shift+Enter) fills the content area while the main view stays mounted, and navigating the main view restores the split. Cmd/Ctrl+\ hides or reopens the panel. Alt/Option-click opens a file in Files or a chat in the sidebar beside the current view.

**Ask agent** (Cmd/Ctrl+J) in a file's or folder's header opens an agent chat beside it, scoped to that item. Pages publish what they show as the agent context (`usePublishAgentContext`); when an agent chat is already in the panel, the button adds the item to that chat's scope instead (unless a folder above it is already there), and Cmd/Ctrl+J hides the open agent chat. A chat in the panel loads and subscribes like the routed chat; its composer keeps its own new-chat draft, takes only files dropped on the panel, and replaces the panel's content instead of navigating when the first message creates the chat.

## Agent files

A chat can be scoped to Files items (`chats.file_scope_ids`): file or folder ids, or `root` for the whole tree, which replaces anything beside it. A folder includes every subfolder. **Open with agent** on selected items, or on the empty space of a folder or My files, opens a new chat in the side panel with that scope (`?side=chat:new:<id>,<id>`); on desktop, **Open as page** carries the scope to the main view's new chat. The composer shows the scope as removable chips, and **Add from Files…** in its **+** menu picks files and folders (checked items stay selected while browsing; with none checked, the folder being viewed is added). Adding items turns on agent mode, because Files are reached only through agent tools. Scopes are validated when set (live items the user owns, at most twenty); an item trashed later stays listed but stops resolving.

## Uploads

Uploads use the attachment flow (reserve, PUT, confirm) with `users/<id>/files/<node>` object keys and the same per-file cap. Files blobs, including trashed ones, and document state count toward the account storage allowance together with chat attachments. They do not reuse the `attachments` table, because chat purges delete attachments claimed by a chat.

## Markdown files

A file's name decides what it is: names ending in `.md` or `.markdown` are Markdown files, and everything else is an ordinary file. New files start as empty editable Markdown documents. Uploaded Markdown keeps its original bytes and opens read-only until someone chooses **Edit**. `GET /api/files/:id/conversion` then does a dry run: it converts the text and reports whether anything would change beyond line endings and trailing whitespace, so the client can show a line diff before `POST /api/files/:id/convert` makes the document. The uploaded object is deleted only after the document commits.

Renaming an editable document to a name without a Markdown extension turns it back into an ordinary file holding its Markdown, and open editors receive `doc.closed` with reason `converted`. Renaming a file to `.md` never converts it; it waits for **Edit**.

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
