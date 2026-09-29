# Files

The Files tab is an account-owned tree of folders, uploaded files, and collaborative documents (`file_nodes`). It is separate from chat folders and chat attachments. Admins can hide it with **Enable Files** in general settings; stored files are kept.

## Tree

Names are unique among live siblings, case-insensitively. Creating or renaming into a taken name fails; uploads, new documents, and restores pick the next free `Name (2)` instead. Folders nest at most 32 levels, and a folder cannot move into its own subtree. Tree mutations take a per-account advisory lock, bump the account revision, and publish the `files` invalidation scope so other sessions refetch.

Trashing marks the whole subtree with the trashed node as its `trash_root_id`; restore returns that batch. An item whose original folder is still trashed returns to the top level. Trash is purged after 30 days, and uploads never confirmed are purged after 24 hours.

Selections act through `POST /api/files/batch/{move,copy,trash,restore,delete}`. Each batch runs in one transaction, so every item changes or none does. A folder listed together with its own contents is treated as the folder alone. Batch moves keep both items on a name clash and return the final names, which lets clients undo a move by moving each item back to its original folder and name.

Copying writes folders and documents in the same transaction that reserves storage for the whole selection. Uploaded files are inserted as pending, duplicated inside the object store (`BlobStore.copy`), then marked ready; a failed object copy removes its placeholder instead of leaving a visible file without bytes.

## Side panel

Chats always live in the main view; the side panel holds Files beside them: a folder (a compact Files browser) or a file. Folders and files opened in the panel stay there, and the path above a panel file walks back up its folders. Alt/Option-click, or **Open to the side**, opens a Files item beside the current view. The panel is window state mirrored into `?side=file:<id>` or `?side=folder:<id>` (`folder:root` for My files), so reloads and shared links reopen it and navigation carries it along. It docks and resizes on wide windows, becomes a drawer below 1100px, and a full-screen sheet on phones.

The header's **Open in main view** button (maximize icon, Cmd/Ctrl+Shift+Enter) makes the panel's folder or file the main view: the panel closes and the main view navigates to it, replacing the chat (browser back returns to it). On the web, **Open in new tab** opens the item in its own tab. Cmd/Ctrl+\ hides or reopens the panel. Keys go to the Files view last clicked; before any click only the page listens.

## Agent files

A chat can be scoped to Files items (`chats.file_scope_ids`): file or folder ids, or `root` for the whole tree. A folder includes every subfolder, and items inside an attached folder (or with the whole tree attached) can be attached as well: they tell the agent what the user pointed out. The composer shows the scope as removable chips (clicking one shows it in the panel), and **Add from Files…** in its **+** menu picks files and folders. Adding items turns on agent mode, because Files are reached only through agent tools. Scopes are validated when set (live items the user owns, at most twenty); an item trashed later stays listed but stops resolving.

Files views offer their items to the chat in the main view, which `ChatPage` publishes as the chat target (the unsent new chat, a saved chat, or none for temporary chats and other pages):

- On the Files page or a file page, **Split view** moves that view into the panel and opens the new-chat page, and **Ask agent** (Cmd/Ctrl+J) does the same with the item attached to a new chat.
- In the panel beside the new-chat page, **Add to chat** attaches the item to the unsent chat. Beside a saved chat it adds to that chat, with **Open in new chat** in its menu. The button shows **In chat** when the item itself is attached.
- Right-click menus follow the same rule: **Open in new chat** when no chat is open, **Add to chat** beside the new-chat page, and **Add to current chat** or **Open in new chat** beside a saved chat. On empty space they act on the folder being viewed, or My files.

### Agent tools

In agent mode, a chat with a scope gets `files_list`, `files_read`, `files_write`, `files_edit`, and `files_create_folder` (`apps/server/src/files/agent-tools.ts`), and its system prompt lists every attached item by the path the tools use: an item inside an attached folder by its path from that folder (`Projects/Drafts/Idea.md`), and a top-level attachment by its name plus where it sits in the user's Files. The tools are left out when Files is disabled or nothing in the scope is still live.

- Paths start with an attached item's name (or at the top of My files for a `root` scope) and are walked one child at a time from there, so nothing outside the scope can be named; `.` and `..` segments are refused. New items must go inside an attached folder.
- Documents are read and edited as Markdown. `files_edit` replaces exact text that must occur once. Writes use `writeDocMarkdown`, which applies the new Markdown to the Yjs document as a minimal diff, appends the update with origin `agent`, and publishes it on `pulpo:file-doc-updates`; every API instance relays it to its `doc:<id>` room, so open editors show the edit live. Uploaded text files are readable but not writable, and only `.md` documents can be created.
- Each response's changes are recorded in `file_agent_changes`: the Markdown a document had before the response first edited it, or an item it created. The reply shows what changed, with **Undo** (`POST /api/responses/:id/file-changes/revert`), which writes the earlier Markdown back as a minimal diff (origin `restore`, so edits made elsewhere since survive) and moves created items to the trash.

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
