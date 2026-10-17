# Files UX and realtime audit

Audited on 16 October 2026, starting from `08d06bf4` on `t3/audit-new-files-ux`, against the behavior described in [Files](files.md). The audit covers the file browser, page and side-panel transitions, the collaborative editor, offline persistence, agent access and edits, suggestion review, history, conversion, and export.

The most serious defects occurred between otherwise working components: an editor joining a room, a room outliving its editor, two editors sharing a socket, an offline document exceeding the message limit, and an editor review reaching the server after the chat had already recounted suggestions. This branch fixes the confirmed defects below and adds regression coverage. It preserves the existing rich-text schema and agent access model.

## Scope and evidence

### Environment

- A fresh local app and disposable account, using this checkout's web and API code.
- Independent PostgreSQL databases for the app and integration tests, with repository migrations and pgvector installed. The integration database is named `pulpo_files_test`, as required by the test guards.
- Local Redis and the local filesystem blob store. Existing user accounts, cloud objects, and production data were not used.
- Node 26.12.0. Tests use `NODE_OPTIONS=--no-webstorage` because Node's own incomplete `localStorage` global otherwise shadows jsdom's implementation. Those initial environment failures were not application defects.
- The collaborative browser at desktop sizes and a 375 × 667 phone viewport. Independent review used separate browser tabs and independently reproduced several failures.

### Levels of verification

Browser checks exercise real React components, HTTP routes, Socket.IO, IndexedDB, PostgreSQL, Redis document broadcasts, and local object storage. Some checks use editor commands or authenticated browser requests to create exact conditions, alongside ordinary buttons, keyboard shortcuts, menus, and file uploads.

Agent checks exercise the real server relay, path resolution, permission guards, document merges, stored changes, and review/history operations. The live browser received Suggest-mode and Write-mode edits from the actual relay using an in-memory workspace adapter. The CLI and daemon have a separate complete test suite. No external model or workspace controller was configured, so the audit does not claim a full model-generated bash turn in a remote sandbox.

Fault tests deliberately delay, reorder, suppress, or reject acknowledgements. Database concurrency tests control the point at which conversion and compaction overlap. This makes failures reproducible without depending on a lucky network or scheduler race.

## Confirmed defects and fixes

P1 means work could remain unsaved, disappear from another view, or be exported incorrectly with misleading feedback. P2 means a lifecycle, review, or operation failure with a narrower trigger. These are audit priorities, not claims of cross-account access.

### F01 Peer edits missed while opening a document

**Priority:** P1. **Status:** fixed.

Reproduction: hold editor A's join acknowledgement after the server has read its snapshot. Make an edit in editor B and deliver its broadcast to A. Then release A's older join snapshot. Previously A displayed the older document and could say Synced while B and the server held newer content.

The server deliberately joins the socket to the room before reading the snapshot. The provider nevertheless discarded room updates until the join acknowledgement set `joined = true`. Updates between the snapshot and acknowledgement therefore fell into a gap.

The provider now accepts document broadcasts while joining as well as after joining. Yjs combines the broadcast and snapshot idempotently. The delayed-acknowledgement suite proves the previously missed text remains present.

### F02 Late replies reopened closed documents or replaced newer connection state

**Priority:** P1. **Status:** fixed.

A pending successful join could arrive after `doc.closed` and replace the closed status with Synced. Reconnecting also attempted a new join after a terminal close. Other stale callbacks could mark a disconnected editor Synced or treat an old send's error as the result of a newer send.

Checking socket object identity is insufficient: reconnects and resyncs reuse the same Socket.IO object. The provider now uses a generation counter invalidated by joins, disconnects, socket changes, closure, and destruction. Join and update callbacks must belong to the current generation. Terminal states prevent new joins.

Regression cases cover closure before a join acknowledgement, disconnect before an older acknowledgement, superseded joins, and an old failed update while a newer update is in flight.

### F03 A lost acknowledgement stalled subsequent editing indefinitely

**Priority:** P1. **Status:** fixed.

Reproduction: allow the server to save the first edit but suppress its acknowledgement. Type another edit without disconnecting. Previously `inflight` stayed true indefinitely, so the second edit never reached the server.

Join and send requests now have a ten-second acknowledgement timeout. The provider restarts the state-vector handshake. This recovers both a lost request and a saved request whose reply was lost; the server receives only the Yjs content it lacks. Generation checks ignore a subsequently arriving old reply.

Tests cover recovery without another keystroke or reconnect, unanswered joins, rate-limited retries, and updates queued behind the unanswered send. This is a recovery deadline, not a claim that every network request finishes within ten seconds.

### F04 Synced appeared before edits were acknowledged

**Priority:** P1. **Status:** fixed.

The old status represented having joined, rather than having saved the current local document. It remained Synced while edits waited in the 50 ms batch, while an update was in flight, and while a rate-limited update awaited retry.

The provider now has a `syncing` state. Local edits enter it immediately, and the editor displays Syncing until the last queued update has been acknowledged. Offline remains distinct. Unchanged status notifications are suppressed.

The status test holds the server acknowledgement and checks both before the batch sends and while the request is in flight. Browser verification also observed Syncing while typing and Synced after persistence.

### F05 Joins outlived their editors and failed joins retained room membership

**Priority:** P2. **Status:** fixed.

There were corresponding client and server defects:

- Destroying or replacing a provider during a pending join did not send `doc.leave`, because it only left when already joined.
- Leaving or disconnecting during an asynchronous access check/document load did not invalidate that join.
- A failed snapshot read could leave the socket in the document room.

The client now leaves while joining as well as while joined. The server tracks the latest join intent per document and checks it after asynchronous work. Leaving and disconnecting cancel pending work; failed and denied current joins clear membership. Stale work cannot remove a newer valid join's membership.

Tests pin leave-during-load, disconnect-during-access-check, failed load, denied rejoin, and provider destruction before acknowledgement. The independent review specifically caught the missing client-side leave after the first server fix.

### F06 An established editor could keep writing after Files was disabled

**Priority:** P2. **Status:** fixed.

Room membership was the only authorization check on `doc.update`. Disabling Files prevented new joins but did not prevent an existing member from submitting more edits. A delayed close notification could similarly leave a stale writer able to update a trashed document.

Every socket write now checks the feature setting. Owner, live state, ready state, and document kind are revalidated in the persistence transaction under the account's tree lock. A concurrent trash or conversion therefore cannot slip between the live-state check and write. Actor identity remains separate from the account owner.

Socket tests verify disabled-feature rejection. PostgreSQL tests verify rejection for another owner and after trash, with unchanged stored content. Existing agent guards continue to recheck chat scope and access modes inside their own mutation transactions.

### F07 Supported large pastes and offline documents could never sync

**Priority:** P1. **Status:** fixed.

A 1.1 MB paste reproduced a terminal sync error in the running editor. Reloading loaded the same unsendable cached update and failed again. The document format allows two million Markdown characters and an eight-million-byte Yjs state, but client updates were limited to one million bytes. A reconnect can legitimately need to upload the whole offline document.

Two additional limits would still have prevented a simple increase: Socket.IO's 4.1 MB transport buffer, and a token bucket with a maximum four-million-byte burst. An update larger than that burst could remain rate limited forever regardless of elapsed time.

The update ceiling now matches the existing eight-million-byte state ceiling. Socket.IO allows base64 expansion for polling plus the event envelope. The token bucket permits one document-sized byte burst while retaining the two-million-byte-per-second sustained refill and the existing message burst limit.

The database regression saves 1.5 million CJK characters, producing more than 4.1 MB of update data. Live browser verification saved both the original 1.1 MB stranded paste and a 4.5 MB Unicode document, then read back the exact character/byte lengths from the server. Ordinary size limits remain in force; this change does not make document size unlimited.

### F08 Opening the same document in main and side views broke saving

**Priority:** P1. **Status:** fixed.

The independent browser reproduction opened a document in the main view, then reopened the same document as the panel's last content. Both editors displayed Synced, but typing in one did not update the other. Closing the panel caused the remaining editor's next write to fail with unauthorized.

Each view created a separate Y.Doc/provider on the same account socket. Socket.IO room membership belongs to the socket, so either provider's leave removed the shared membership. Broadcasting to other sockets also excluded the other local provider. A refcount on room membership alone would not solve the divergent documents.

The UI now prevents the duplicate session from mounting synchronously when the panel file is already the main file. The page also subscribes to panel changes so reopening the last document closes that duplicate request. The close effect respects `locationIsCurrent`: a Split view action changes panel state before its router transition commits, so the old route must not cancel the requested split.

Component tests cover direct duplicate URLs, toggling the last panel, a navigation in progress, and distinct documents. Independent live verification covers duplicate reopening, the actual Split view button, maximizing back to main, subsequent edits, and persistence to a peer tab.

### F09 UUID casing silently split one document into separate realtime rooms

**Priority:** P2. **Status:** fixed.

PostgreSQL and UUID validation accept case variants, but room names and provider event comparisons used the original string. The independent reviewer opened lowercase and uppercase URL variants for the same document. Both showed Synced; subsequent edits diverged.

Document IDs are now normalized in socket input schemas, the provider, and file route/panel comparisons. Mixed-case joins, updates, and leaves use the same room and node ID. The independent reviewer confirmed bidirectional live updates after the fix.

### F10 Compaction could deadlock conversion or deletion

**Priority:** P2. **Status:** fixed.

Compaction locked `file_docs`, then updated `file_nodes`. Renaming away from Markdown updated `file_nodes`, then deleted/converted `file_docs`. Purging descendants and repairing legacy non-Markdown documents had the same opposing lock topology.

Compaction now resolves the immutable owner and acquires the account's tree lock before its document row lock. The shared order is tree, document, then node. This covers all of those tree mutations without changing every individual deletion/conversion caller.

The deterministic regression pauses conversion at its object write, starts compaction, observes that the transactions overlap using PostgreSQL's blocking information, then releases conversion. Running that test with the original compaction lock order produced `40P01: deadlock detected`. With the fix, both operations complete and the converted file includes the latest edit.

The tradeoff is brief serialization of compaction with other tree operations for the same account. Compaction remains bounded by the existing document-size policy.

### F11 Suggestion cards recounted before reviews reached the server

**Priority:** P2. **Status:** fixed.

The page invalidated chat file-change queries exactly 1.5 seconds after an editor review. Offline review, slow acknowledgements, or rate limiting could make that query read the old pending suggestions. A later successful upload did not trigger another recount.

The page now records that a recount is needed and waits until the provider reports Synced. Multiple pending review actions coalesce. A synchronous acknowledgement is handled too. Hunk-identity changes also trigger recounting for editor undo/redo and typing that resolves a suggestion without pressing a review button.

Hook tests cover offline review, an unacknowledged upload, eventual acknowledgement, and a synchronous acknowledgement. Existing editor tests cover accept/reject, navigating hunks, hover cards, read-only review, nested suggestions, and undo.

### F12 Undo restored inline suggestions without restoring their review state

**Priority:** P2. **Status:** fixed.

After the owner accepted a suggestion locally, listing changes settled the change row as accepted. Editor Undo could restore the suggestion's Yjs marks, but the row stayed accepted and could no longer be reviewed through the change API.

Document suggestion summaries now reconcile in both directions. If the document again contains hunks for a reviewed change, its status becomes pending. Removing all hunks still settles the change using the existing base-Markdown comparison. Status updates compare against the previously read row status.

The PostgreSQL regression suggests an edit, accepts it through a document update, settles the row, restores the suggested document as an editor undo would, and successfully rejects the now-pending change through the review API.

### F13 Download omitted unsynced edits

**Priority:** P1. **Status:** fixed.

The open editor's Download action fetched only server Markdown, even while its displayed content contained newer offline edits. This could export an older document or fail to provide an offline copy of the user's work.

An open, usable document now downloads its current local Yjs snapshot using the same base-view Markdown serializer. Pending agent suggestions therefore retain the existing export policy: only accepted content is exported. Downloads initiated from the browser still fetch server content.

The local snapshot must be usable. During a first load with no cached copy, Download retains the server fallback. A default paragraph initialized by the editor is not evidence of cached content. The session records initial cache availability, starts networking after the bounded cache wait, and exposes an editor only once the cache or initial remote sync has loaded. Slow empty-cache tests prevent inventing a usable copy from an editor's default state.

Browser verification disconnected document sync, added an offline paragraph, clicked Download, and inspected the generated Blob. It contained the offline paragraph while a simultaneous server Markdown read still lacked it. Component and session tests cover offline content, first-load fallback, editor initialization, and late populated/empty caches.

## Detailed UX coverage

### Browsing and file operations

The browser supports a consistent path/header model in page and panel views. Folder creation and inline naming, creating a document and opening it, keyboard duplication, trashing a duplicate, and undo toasts were exercised in the running app. Uploaded text files render their content, including Unicode. Multiple uploads use the same reservation, byte upload, and confirmation flow and appear in the correct folder.

The existing browser and database suites additionally cover selection, range navigation, sorting, typeahead, grid cell placement, layout persistence, moves and copies, conflicting names, atomic batches, subtree handling, trash/restore, storage limits, pending-upload cleanup, built-in folders, shortcuts, pinned items, and chats filed into Files. Those are automated checks; arbitrary freeform drag paths were not all manually exercised.

### Editing and collaboration

Two real browser tabs exchanged text and presence. One tab disconnected document sync, edited locally, and later reconnected after the other tab had edited online; both converged and the server held both additions. Closing and reopening page/panel views retained saved content.

The provider stress test checks three replicas through 120 distinct edits with repeated offline windows and delayed replies, then verifies every edit occurs exactly once in the converged document. Separate timing cases test the join gap, stale successes and failures, terminal closure, lost acknowledgements, rate limiting, socket replacement, and destruction.

Existing mounted-editor tests exercise rich structure and marks through the actual collaboration extension and shared schema. The merge corpus adds every pair of 24 document shapes: empty content, paragraphs, headings, lists, nested lists, checklists, quotes, code, links, tables with different widths, hard breaks, combining characters, emoji, CJK, Korean, and Arabic. Every Suggest-mode merge is checked in base and proposed views; every Write-mode merge is checked against the target serialization. A further 100 sequential agent revisions preserve the owner's original base view.

### Agent access and edits

The database and CLI suites cover read/suggest/write modes, nearest attached access overrides, root and folder scopes, read-only descendants, changing access during a mutation, malformed relay requests, outside-scope paths, shortcut exclusion, Unicode/case name resolution, pull versions, stale pushes, forced pushes, new items, uploaded-file proposals, quota checks, suggested moves/deletions, and undo conflicts.

Live relay checks proposed a word replacement and a new paragraph. The editor displayed both inline, with the review toolbar and a description card. Rejecting restored the owner's text. A direct Write-mode push appeared in the open editor; the real undo and redo endpoints removed and restored it through realtime broadcasts.

The model's proposed document view and the owner's base view remain intentionally different. Agent merges preserve earlier suggestions, and later edits to items created as suggestions fold into that creation. The audit did not replace those established semantics.

### Conversion and export

Supported uploaded Markdown opens read-only and converts to an editable document without a warning when serialization is equivalent. An uploaded document containing raw HTML and a noncanonical bullet marker produced the conversion diff, allowed cancellation, and converted after confirmation. The original read-only file remained usable when conversion was refused for unsupported image/inline-HTML input; the UI showed an error rather than silently changing its contents.

Tests cover UTF-8 validation, unsupported names, Markdown renames, conversion away from Markdown, and legacy repair. Export uses the shared serializer and omits unresolved insertions according to the existing base-view policy. Local offline export now includes the owner's current edits.

### Responsive layout and accessibility

At desktop size, the panel remains beside the main view and exposes close, new-tab, and maximize actions. At 375 px, the panel becomes the sole visible content view. The tested editor and suggestion card had no document-level horizontal overflow. Formatting controls wrap and suggestion navigation remains operable.

Named buttons, document and name labels, suggestion toolbars, and visible alerts were inspected through the accessibility tree. Existing layout tests cover available split width, sidebar collapse rules, URL synchronization, and keyboard ownership. This audit is not a complete screen-reader or touch-device accessibility certification.

## Remaining UX decisions and limits

1. **Typing inside a proposed insertion edits that proposal.** Rejecting it also removes those typed characters. Typing alongside a suggestion is separate; typing inside a deletion is protected by the existing plugin. A new test documents insertion behavior. Changing it requires choosing whether user edits adopt the entire suggestion, create an independent fragment, or remain a revision; this branch does not silently choose a different review model.
2. **Narrow document headers prioritize actions over the full name.** At 375 px the title can truncate aggressively, and the formatting/review controls occupy several rows. The tested controls remain available without global horizontal overflow. A separate compact-header design could improve reading room.
3. **Unsupported Markdown errors are broad.** The image/inline-HTML fixture remains read-only with “This Markdown could not be read; simplify it and try again.” Original bytes remain available, but identifying the specific unsupported construct would make recovery easier.
4. **Document metadata is eventually compacted.** File size and modified-time metadata can lag current Yjs updates until compaction. Tests verify latest content before and after compaction; the browser's unsaved indicator now follows acknowledgements rather than that metadata.
5. **Offline scope is explicit.** Document-socket disconnects, persisted document reload, and reconnection were tested. A cold application launch with all HTTP/network access unavailable, browser termination during an IndexedDB write, and storage eviction were not exhaustively tested.
6. **Deployment boundaries remain.** Live testing used one API process and local blobs. Redis-backed agent update delivery was exercised, but a multi-API failover soak and presigned S3/browser CORS checks require their deployment environments. Native iOS/Android deployment and remote model/workspace execution were outside the available Files browser setup.

## Reproducing validation

Final local validation passed 3,582 tests: 1,300 web, 1,833 server, 269 client-core, 119 contracts, and 61 workspace-daemon. The server run enabled the Files PostgreSQL suites. The production web build (including landing prerender), server TypeScript build, and repository lint all passed.

The independent reviewer reported no remaining concrete findings after the final changes. Their separate tests and live browser checks verified mixed-case UUID synchronization, duplicate-panel prevention, split/maximize transitions with saving to a peer, initial document loading, and the delayed-cache/download corrections. Review findings were reproduced and addressed before opening the PR.

Install dependencies and build the shared packages before testing. Use a disposable PostgreSQL database with pgvector and the repository migrations; never point integration tests at a real account database.

```sh
npm ci --no-audit --no-fund
npm run build -w @pulpo/contracts
npm run build -w @pulpo/client-core
npm run build -w @isaacthoman/pulpo

DATABASE_URL=postgres://USER@HOST:PORT/pulpo_files_test npm run db:migrate

NODE_OPTIONS=--no-webstorage npm run test -w @pulpo/web
NODE_OPTIONS=--no-webstorage npm run test -w @pulpo/client-core
NODE_OPTIONS=--no-webstorage npm run test -w @pulpo/contracts
NODE_OPTIONS=--no-webstorage npm run test -w @pulpo/workspace-daemon
DATABASE_URL=postgres://USER@HOST:PORT/pulpo_files_test \
  PULPO_FILES_TESTS=true NODE_OPTIONS=--no-webstorage npm run test -w @pulpo/server

npm run build -w @pulpo/server
npm run build:web
npm run lint
```

The final validation record and independent-review result are recorded in the pull request. The server's unrelated gated PostgreSQL suites remain skipped unless their own test databases/flags are configured; the Files PostgreSQL suites were enabled and passed.
