# Files on mobile: validation, October 17, 2026

The app browses Files and edits documents natively on iOS and Android (see [docs/files.md](../../docs/files.md#mobile)). This page records how it was checked: the automated suites, runs on simulators and an emulator against a disposable local backend, and the independent audits made along the way.

## Local setup

Everything runs on this machine against throwaway containers and the disposable `pulpo_mobile_files` database. Nothing reaches a hosted service or a real model.

```sh
docker run -d --name pulpo-mobilefiles-postgres -e POSTGRES_USER=pulpo -e POSTGRES_PASSWORD=pulpo \
  -e POSTGRES_DB=pulpo_mobile_files -p 127.0.0.1:55433:5432 pgvector/pgvector:0.8.6-pg17
docker run -d --name pulpo-mobilefiles-redis -p 127.0.0.1:6392:6379 redis:7.4-alpine
```

Each backend terminal, from the repository root, uses:

```sh
export NODE_ENV=development HOST=127.0.0.1 PORT=8194 PUBLIC_URL=http://localhost:8191
export POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=55433 POSTGRES_USER=pulpo POSTGRES_PASSWORD=pulpo POSTGRES_DATABASE=pulpo_mobile_files
export REDIS_URL=redis://127.0.0.1:6392 STORAGE_DRIVER=local STORAGE_LOCAL_PATH=/tmp/pulpo-mobile-files/objects
export ALLOW_ANY_LOCALHOST_PORT=true ALLOW_PRIVATE_PROVIDER_URLS=true
```

Then:

1. Build `@pulpo/contracts`, `@pulpo/client-core`, `@pulpo/server`, and `@pulpo/web`, and run `npm run db:migrate -w @pulpo/server`.
2. Keep these running:
   - `node apps/server/dist/api.js` and `node apps/server/dist/worker.js`
   - `node apps/mobile/e2e/files-gateway.mjs`: the app's server on port 8191. It serves the web build, forwards to the API, and can drop the connection: `POST {"online": false}` to port 8195.
   - `node apps/mobile/e2e/queue-provider.mjs`: a deterministic model on port 8092 that answers `Completed: <prompt>`.
3. Run once:
   - `node apps/mobile/e2e/files-seed.mjs` creates `files@example.test` (password `Files-test-only-2026`) with a nested tree, rich documents, and uploads.
   - `node apps/mobile/e2e/files-model.mjs` registers the deterministic model.
   - `node apps/mobile/e2e/files-agent.mjs` creates a chat whose agent reply really changed Files through the `pulpo files` relay, for undo, redo, and review.
4. `node apps/mobile/e2e/files-peer.mjs read|write|append|suggest|presence "<document>"` acts as a second device on a document. It joins through the same provider the apps use.
5. Start Metro with `EXPO_PUBLIC_DEFAULT_INSTANCE_URL=http://localhost:8191 npx expo start` and build the app:
   - iOS: `npx expo run:ios --no-bundler`.
   - Android: `./gradlew :app:installDebug` from `apps/mobile/android`, then `adb reverse` ports 8081 and 8191.

**Android build note:** the release workflow installs `platforms;android-37.0`, but the Android Gradle plugin 8.12 that React Native 0.86 uses looks for `android-37`. These local debug builds therefore passed `-Pandroid.compileSdkVersion=36 -Pandroid.targetSdkVersion=36 -Pandroid.buildToolsVersion=36.0.0`. Nothing in the repository was changed for this.

## Automated validation

- **Mobile:** 113 test files and 987 tests. Among them:
  - The document store and sessions run on a real SQLite database (`node:sqlite`) with the app's schema. They cover:
    - offline edits across relaunches;
    - a slow database;
    - copies loaded after the first handshake;
    - documents trashed elsewhere;
    - session restarts and merges;
    - compaction;
    - eviction.
  - The editor bridge runs two pages on one document against the real editor bundle.
  - Other areas:
    - the upload queue: account changes, lost confirmations, placeholders, Files turned off, retry races, staged copies, and failed transfers;
    - offline chat starts and scope changes whose Files items went away;
    - the remembered instance configuration;
    - Files links, pinned items, and account cleanup.
  - The bundled editor page is rebuilt in the test and compared with the committed one, and another test fails when TipTap reaches the app's Hermes bundle.
- **Shared code and other packages:**
  - client-core: 318 tests, including doc-sync's provider and session controller against a fake server.
  - contracts: 122 tests.
  - Web: 1,337 tests (`NODE_OPTIONS=--no-experimental-webstorage` under Node 26), plus the suggestion-card browser test in Chromium and WebKit.
  - Server: 1,750 tests (database-backed suites skipped), including the mobile config's `capabilities.files`.
- **Types and lint:** `tsc` passes for mobile, web, server, and client-core, and `npm run lint` passes.
- **Regression tests:** each one written for an audit finding was checked to fail without its fix.

## iPhone (iOS 27.0 simulator, iPhone 18 Pro)

**Browsing**
- Folders and built-in folders, sorting, and search.
- The native item menus: open, rename, move, duplicate, pin, share, select, and trash with undo.
- Multi-select with the selection bar: Move, Duplicate, and Trash. While selecting, the iOS 26 bottom search field gives way to the selection bar.
- **Move Here** is disabled where the items already are.
- Quick Look for uploaded files.
- **Edit** for uploaded Markdown: the line diff, then conversion.
- New documents open ready to type.
- `pulpo://files` links, while signed in and after sign-in.

**Uploads**
- Uploading two photos from the library.
- An upload started offline shows "Waiting for a connection". It survived killing the app, uploaded once after reconnecting, and its staged copy was removed.

**Documents**
- Typing reaches the server, and a peer's edits appear live.
- Remote carets show the device label.
- Suggestion review: step through, accept, reject, and accept or reject all.
- The editor survives its web content process being killed.
- Leaving right after typing keeps the last keystrokes (the page's final state is merged).

**Offline and trash**
- An edit made offline survived the app being killed, then reached the server.
- A document trashed elsewhere while open shows **Restore**. Restoring it starts a fresh session that syncs.
- An edit made offline to a document that was trashed elsewhere was kept on the device through a relaunch. It reached the server once the document was restored from the app.

**Chats**
- File scope chips with access modes, and **Add from Files**.
- Starting a chat with the scope chosen as a draft.
- An agent reply's changes card: review, accept, reject, undo, and redo. When undo was refused, the conflict sheet showed the expected and current Markdown.
- Opening a chat from the Sidebar folder in Files.
- A Files link in a reply opens the document in the app.

**Drawer**
- Pinned folders, files, and shortcuts share the Pinned list with pinned chats, in the web's order, and a chat pinned on the phone goes after them (the server agreed).
- Opening and unpinning from the drawer.
- An item pinned elsewhere appears without a refresh.

**Files turned off**
- The drawer hides its Files row and Files items; folders and shortcuts to folders or chats stay, as on the web (since the drawer became the sidebar, below).
- Files links show "Files are turned off" instead of stale copies.
- Everything returns, live, once Files is turned on again.

## iPad (iOS 27.0 simulator, iPad Pro 13-inch)

- Files opens from the persistent sidebar, and pinned items open from it too.
- Documents keep the web's document width (64rem) in landscape.
- Typing syncs.
- The keyboard's shortcuts bar keeps undo, redo, and paste but no longer repeats the formatting bar's bold, italic, and underline. Underline isn't in the document schema.

## Android (API 34 ATD emulator, software rendering)

Hardware acceleration (HVF) isn't available to the Android emulator on this macOS 27 host, so the emulator ran under software emulation (`ANDROID_I_WANT_MY_TCG=yes`). The API 37 image kept losing its system server to watchdog timeouts, so the runs used Google's lighter `google_atd` API 34 image. Screenshots come out blank in that headless mode, so each step was checked through the view hierarchy (`uiautomator dump`) and the server's copy of the document.

- **Sign-in and drawer:** sign-in works, and the drawer shows Files plus pinned Files items in the shared order.
- **Files list:**
  - Labels, pinned marks, and the long-press action sheet.
  - Duplicate and Trash (confirmed in `/api/trash`).
  - Search.
  - **Select** from the More menu, and leaving selection with **Done**.
  - A `pulpo://files` deep link.
- **The Android editor host** (`WebView`, Chromium 113):
  - The document loads.
  - Typing reaches the server, and a peer's edit appears live.
  - The open iPad's caret appears with its label.
- **Renderer crash:** killing the renderer process brings the editor back with its content. The first run found a bug: the replacement `WebView` was never laid out. It was fixed and checked again, and editing after the crash still syncs.
- **Offline:** an edit made offline survived a force-stop. The background upload sent it on the next launch, without the document being opened.

## After updating to dev

The branch was brought up to date with `dev` (one file overlapped and merged cleanly) and audited again, in three areas at once and then twice more on the fixes. Everything below was checked again on the iPhone simulator against the same local backend:

- Opening a chat from Files returns to the one chat screen (Back has nothing behind it).
- `/files/d/` links open what the item is:
  - an uploaded image in Quick Look;
  - uploaded Markdown in its screen;
  - a document in the editor.
- A link to an item never seen on the device, tapped offline, says so at once and opens nothing later.
- A Files link inside a read-only document opens in the app.
- Trash opened from Files shows "My files" as its back button.
- With no trash retention, deleting a chat from Files asks first, with the drawer's wording.
- Signing out with an offline edit pending says so. Once the edit uploaded, the warning was gone.
- After a revoked session was found at launch, signing in again shows Files without leaving the app.
- After an offline launch, Files is in the drawer, and an upload queued before the launch went through on reconnecting, without leaving the app.
- An upload that reached the server while Files was turned off waited without an error, then finished once Files was back on.
- A document renamed to `.txt` lost its stored copy on the device. Renamed back and turned into a document with **Edit**, its content appeared once on the server, not twice.
- An uploaded Markdown file converted on another device while open switched to the editor on its own.
- The Chats folder's menu has no **Pin**.
- **Change server** from the Add Account screen asks before signing every account out. Entering the same server changes nothing, and the account stayed signed in.

Changes to native code: none, so Android was not run again; the changed screens use the same code on both platforms.

## The drawer as the web sidebar

The follow-up that made the drawer the web's sidebar (#846) was checked against the same local backend. Its account had folders, chats filed in them, a document, and a pinned folder in the Sidebar folder, created through `/api/sidebar` and `/api/chats/start`.

**iPhone simulator.** The drawer listed the same rows in the same order as the web sidebar for the same account. Each of these was checked:
- Opening folders in place, nested. Open folders stayed open after a relaunch.
- **New folder** and **New Folder Inside**.
- **Move to Folder**: the sheet greyed out the folder itself and its subfolders. **Other folder…** moved a folder out of the sidebar into a Files folder.
- Moving a chat into a folder opened it.
- A chat at the top of My files, found by search, came back into the sidebar with **No folder**.
- Chats:
  - **Move to archive** in the native menu, and **Undo**.
  - Archiving offline said it would happen once online, offered no Undo, and was archived after reconnecting.
- Pinning a document put it at the end of Pinned.
- **New Document** opened the editor, and the document appeared at the top.
- Recent order grouped the top level by day.
- Trashing a folder put its chat at the top, and **Undo** restored the folder.
- Shortcuts:
  - a shortcut to a folder opened in place;
  - a shortcut to a chat opened the chat.
  - The open chat was highlighted inside nested folders.
- Search found a chat filed two folders deep.
- A restore made elsewhere appeared live.
- A folder created offline:
  - showed at once;
  - survived a relaunch while offline;
  - stayed in place through the reconnect;
  - was created once after reconnecting.
- A folder created offline inside another folder created offline showed nested, and both reached the server once, nested.
- A folder name containing "/" was refused with a message before anything changed.
- With Files turned off:
  - the Files row and the documents left the drawer, while folders and shortcuts to folders or chats stayed;
  - menus lost Open in Files and Move to Archive, and trashing became **Delete**;
  - renaming a folder still worked.

**Android (API 34 ATD emulator).** Checked through the view hierarchy:
- the same rows in the same order;
- folders opening in place, indented;
- the folder action menu, and moving a folder through the move dialog (confirmed on the server);
- the heading menu: New document, Upload, Sort by, and Open in Files. Switching to Recent and back worked;
- **New folder** (confirmed on the server);
- **Move to archive** in the chat menu.

**Audits.** Six rounds of independent review found 36 issues, fewer and smaller each round:
- Round 1: 10. One claim, that **Other folder…** never opens on iOS, was disproved on the simulator.
- Round 2: 9.
- Round 3: 6.
- Round 4: 3.
- Round 5: 5.
- Round 6: 3, all minor.

Every other finding confirmed by reading the code was fixed, with a test that fails without the fix, apart from two that were left:
- One is noted under "Not covered".
- The other: the position kept for a folder created offline stays on the device after it is sent. That is a few bytes, and it is never read again.

Among the fixes:
- Older servers are told where a moved or unpinned chat goes.
- Undo is offered only once an archive has reached the server.
- Chats and items at the top of My files are handled where they are.
- Names are checked before anything is shown or queued.
- Folders created offline are listed from the outbox until the server has them: nested, opened, across relaunches and refetches, and above the chats.
- Folders and the top level say when their contents can't load.
- Shortcuts that would open into themselves open in Files.
- Toasts and sheets don't outlive an account switch.
- Chats moved on the device before a trash or an Undo that was refused go back where they were.
- Restoring from Settings › Trash brings folders back into the drawer.

## Audits

Independent reviewers audited each phase as it landed, then the whole branch twice. Each of their findings was fixed, and the fixes that could be tested got regression tests:

- **Phase 0 (the shared refactor):**
  - The web briefly showed Offline while a document opened.
  - Formatting buttons were announced as toggles.
  - The suggestion card's browser fixture had broken imports.
- **Documents:**
  - Never compact a copy that hadn't finished loading.
  - Merge on compaction instead of replacing what is stored.
  - Keep a trashed document's unsynced copy.
  - Hold the "in sync" mark until the stored copy is loaded.
  - Queue that mark right behind pending writes, so a later edit is never marked as uploaded.
  - Merge a replaced session's edits into its successor.
  - Merge the page's final state into every live view.
- **Uploads:**
  - Upload only for the account that queued the file.
  - Before retrying, check what became of an earlier attempt's placeholder: one the server confirmed after all finishes the upload, so a lost confirmation never deletes or duplicates a file.
  - Allow longer confirmations.
  - Forget finished uploads before caching their bytes.
- **Android:**
  - Lay out and stop replacement web views.
  - The folder header now shows in every state.
  - A way out of selection.
  - Search.
- **Chats:**
  - The draft scope carries into new chats.
  - Changes now show for stopped and failed replies.
  - Unpinned chats are placed by the server, as on the web.
- **Other:**
  - The Markdown screen's "turned off" state.
  - Replaced cached files and exports are removed.
  - Files links in replies open in the app.
- **After updating to dev:**
  - The bundled editor page is checked against a fresh build, not only its recorded hash.
  - Opening a chat from Files no longer stacks a second chat screen.
  - File links open uploads, not only documents. Links inside documents open in the app.
  - Uploads:
    - a transfer interrupted by the connection waits instead of failing;
    - uploads wait while Files is off;
    - Try Again can't start a second copy;
    - cached bytes go to the right account;
    - staged copies are swept.
  - Documents:
    - failed local writes are retried, and open documents write as the app leaves;
    - a newer version's unsynced copy is kept;
    - documents that closed unsynced are retried, unless the server refuses them for good;
    - signing out closes replaced sessions and warns about unsynced edits.
  - Chats started offline, and scope changes made offline, keep the Files items that remain.
  - The instance configuration is read again on signing in and on switching accounts, and remembered per instance address for offline launches.
  - A document that became an ordinary file has its copy removed and is never merged into a document made from it later.
  - Changing servers, and signing this device out from Devices, warn about unsynced edits.
  - Downloaded files finished after signing out are removed, and item ids are checked before they name a directory.

## Not covered

- Physical devices. The camera wasn't exercised beyond its permission path.
- On Android:
  - The formatting bar's look, since the ATD image has no on-screen keyboard and screenshots are blank.
  - Uploading from the photo picker.
  - The hardware back button. On this emulator, Back leaves the app from every screen, Settings included. That is not specific to Files; it is related to `predictiveBackGestureEnabled` in `app.config.ts`, which predates this work. The Files folder screen still handles Back to leave selection.
- iPad drag and drop, and a side-by-side Files pane: Files opens full screen over the chat, as Settings does.
- A hardware keyboard. TipTap's own shortcuts run inside the web view, but no keyboard was attached in these runs.
- A document turned into an ordinary file and back on another device, while this device never saw it as a file, can still meet this device's old copy when opened, as the web's stored copies can. Closing that fully needs the server to give each document an identity that changes when it is made afresh; neither app has one yet.
- The drawer on a server without `/api/sidebar` (before 0.156) was covered by unit tests only.
- A folder created offline looks like any other folder until the outbox sends it. If the outbox is held up after reconnecting (an earlier change keeps failing), renaming, moving, or trashing that folder, or moving a chat into it, fails with an error until then. Offline those actions already say they need a connection, and creating folders inside it is queued too.
- Two audit suggestions were left as they are:
  - **The editor page's error reports:** the app does not reload the page when it reports an error. Most such reports are harmless page errors, which reloading would interrupt, and the updates the page applies all come from the app's own document.
  - **Android WebViews without the origin-checked message listener:** those (older than version 83) fall back to a plain JavaScript interface. The page loads nothing from anywhere and cannot navigate, so only the editor's own page can reach it.

## Follow-up to the simulator audit of #846

- Downloaded blobs use an optional `contentChecksum` from the server as their content identity.
  Renaming or moving an item keeps its downloaded bytes available offline, including changes
  received from another device. Actual content replacements still invalidate the copy, even
  when their byte count is unchanged. Renaming also updates the local filename used by Quick
  Look and sharing. Older servers without a checksum retain conservative invalidation; copies
  cached under the old metadata-based identity need one fresh download.
- Native drawer rows use a minimum height and grow with their text, rather than clipping names
  at 44 points. Their native hosts remeasure on live text-size changes. Checked on the iPhone
  at the largest accessibility text size, and on iPad switching large → XXXL → maximum
  accessibility → large while the app stayed running.
- Visual indentation stops at 64 points, without limiting the real folder depth. Folder, chat,
  document, empty-state, and move-picker rows use the same limit. Checked the 23-level tree and
  opened its deepest document on the iPhone; a regression test covers the contract's maximum depth.
- Regression tests exercise Files and sidebar rename paths with the real SQLite cache, offline
  moves, replacements, conversion back to a blob, older servers, and account separation.
  The PostgreSQL tree-service suite checks that rename/move preserve the checksum and replacing
  contents changes it.
- Follow-up simulator checks passed: Android opened the deepest document and selected the deepest
  move destination; iPad reopened a renamed download offline in Quick Look under its current name,
  with no extra download request. The gateway was restored online and system text sizes restored.
