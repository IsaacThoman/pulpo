# Live formats

A live format is a file type that opens as a collaborative document. Its content lives in a Y.Doc synced over the document socket, and a codec converts it to and from the file's bytes. Downloads and agent pull/push still deal in real files. Markdown, text/code, Word documents, spreadsheets (including CSV/TSV), presentations, and Jupyter notebooks are live on web, desktop, and mobile.

This page covers the model and the integration steps. [Files](./files.md) describes the user-facing behavior.

## The pieces

| Piece | Where | What it is |
| --- | --- | --- |
| Contract | `packages/client-core/src/office/live-format.ts` | `LiveFormatCodec`, `LiveAssetStore`, and `LiveFormatError`. This branch adds one optional codec method, `referencedAssets(doc)`, used for asset collection. |
| Catalog | `packages/client-core/src/office/formats.ts` (`@pulpo/client-core/office`) | One `LiveFormatInfo` per format: id, schema version, extensions and whole file names, `lossless`, `maxFileBytes`, MIME types, and `hasContent`. It imports no codec, so clients and the mobile app's Hermes bundle can load it. |
| Codec registry | `packages/client-core/src/office/codecs.ts` (`@pulpo/client-core/office/codecs`) | The codec of each catalog entry. It checks that the two agree. It loads every codec (Markdown pulls in TipTap), so servers import it and clients don't. |
| Assets | `office/assets.ts`; server `files/live-docs.ts` (`DocAssetStore`); web `features/files/live/assets.ts` | Binary parts addressed by SHA-256, plus `MemoryLiveAssetStore` for scratch documents and tests, and `transactChanges` for codecs' `applyFile`. |
| Server | `apps/server/src/files/live-docs.ts`, `live-routes.ts`, `agent/live.ts` | Creating, converting, exporting, applying, and agent changes, all through the codec. |
| Web | `apps/web/src/features/files/live/registry.tsx` | Per format: its editor (lazy), its review diff, its creation menu item, and a local export. |
| Mobile | `apps/mobile/src/features/files/editor/bundles.ts`, `apps/mobile/editor/<format>/` | Per format: a web view page built into its own generated module, and its native toolbar. |

### Formats and their extensions

| Format | Extensions | Schema | Converts on Edit | Notes |
| --- | --- | --- | --- | --- |
| `markdown` | `md`, `markdown` | `DOC_SCHEMA_VERSION` | after a preview | TipTap schema in `doc-schema`, unchanged. The codec is an adapter (`office/markdown`). |
| `text` | most text and code extensions (`office/text/layout.ts`), plus names such as `Dockerfile` and `.gitignore` | 1 | at once | `csv`/`tsv` (sheets), `ipynb` (notebooks), and `svg` (previews as an image) are excluded. |
| `notebook` | `ipynb` | 1 | at once | nbformat 4 (any minor version); nbformat 3 is upgraded to 4.5. See [The notebook format](#the-notebook-format). |
| `presentation` | `pptx`, `potx`, `ppsx`, `pptm`, `potm`, `ppsm` | 1 | at once | Lossless: untouched parts are written back byte for byte. Pictures and media are assets. See [Presentations](./presentations.md). |
| `sheet` | `xlsx`, `xlsm`, `xltx`, `xltm`, `csv`, `tsv` | `SHEETS_SCHEMA_VERSION` (1) | at once | Workbooks keep every part they don't edit; CSV and TSV come back byte for byte. See [Spreadsheets](./sheets.md). |
| `document` | `docx`, `dotx`, `docm`, `dotm` | `DOCX_SCHEMA_VERSION` (3) | at once | Word documents with preserved unedited parts and assets; macro-enabled Word imports drop macros. See [Word documents](./office-documents.md). |

`liveFormatOfName(name)` decides a name's format, and nothing else does: the server, web, and mobile all call it. Uploaded-file preview families and text detection come from the shared file-type table (`files/file-types.ts`), used by server `agent/versions.ts`, client-core `files/display.ts`, web `lib/attachment-previews.ts`, and mobile `attachmentExperience.ts`. The preview family does not change a live document's editor: the document format chooses that.

## Data model

- `file_nodes.format`: the live format of a `doc` node. A check constraint requires it for documents and forbids it for anything else. Migration 0111 set every existing document to `markdown`. A document's name always has its format's extension.
- `file_docs.schema_version` is the format's schema version. `file_docs.markdown` holds the derived plain text (`codec.toText`): Markdown for Markdown documents, the content for text files. Compaction refreshes it. Storage is charged for state growth when updates are accepted, under the account storage lock; shrinking releases space when compaction discards the earlier snapshot. It feeds previews, `/api/files/:id/markdown`, and agents' `cat` and `grep`.
- `file_docs.generation`: a UUID stamped into the document's state when it is made (the `pulpoDoc` Y.Map, `DOC_META_MAP`). A file made a document again under the same id gets a new one. Join acknowledgements carry the generation read from the document's state (so it is always the one clients compare against), and the provider refuses (`stale_copy`) to merge a device's cached or previously joined copy that holds another generation's content. Proposals keep their document's generation too: one whose fork is of another generation is never merged, and a document that becomes an ordinary file rejects its pending proposals. The web then deletes its IndexedDB copy and mobile discards its SQLite copy before joining afresh. Documents from before generations have none and are never refused.
- `file_doc_assets`: a document's binary parts, one row per `(node_id, hash)`, with the object key, MIME type, and size. Each row's object has its own key (`users/<id>/doc-assets/<node>/<hash>-<id>`), so deleting an unused one after commit never removes bytes stored again meanwhile. Objects are stored per document, so copying a document copies its objects and deleting it deletes them. Assets count toward storage, cascade from `file_docs`, and are included in backups (blobs remapped on restore). Account deletion removes them. A document that becomes an ordinary file drops its assets after commit.

## Sync and schema versions

`doc.join` carries `schemaVersions` (format id → version) beside the old `schemaVersion`. The server compares the document's format against it (`joinsFormat` in `doc-socket.ts`) and answers with the document's `format`. A client that sends only `schemaVersion` is taken to edit Markdown alone, so older web and mobile clients keep working for Markdown and get `schema_outdated` for other formats. `GET /api/mobile/config` reports `capabilities.files.liveFormats`. `FileNode.format` tells clients which editor to open.

- Web: `useDocSession(userId, docId, format)` passes the format's version and its `hasContent`.
- Mobile: the session registry announces every bundled editor's version (`MOBILE_SCHEMA_VERSIONS`). Stored copies still record the Markdown version.

## What happens to files

- **Create.** `POST /api/files/docs` takes any name of a live format and makes an empty document (`codec.createEmpty`). Without a name it makes `Untitled.md`. Creation menus on the web and mobile list every registered format.
- **Edit an upload.** `POST /api/files/:id/convert` imports the uploaded bytes through the codec, then deletes the object after commit. For formats other than Markdown it first checks the storage allowance has room for the upload's size again, since the document (and any original bytes it keeps) exists beside the upload until then. Formats whose codec is lossless (text) convert as soon as the user picks **Edit**. Markdown keeps its preview dialog (`GET /api/files/:id/conversion`).
- **Rename.** Renaming within a format keeps the document and updates its MIME type (`a.py` → `a.ts`). Renaming to another format, or to no format, exports the document through its codec and makes it an ordinary file (`a.py` → `a.md` or `a.bin`). Open editors get `doc.closed` with reason `converted`. The maintenance job `convertMisnamedDocs` repairs any document whose name left its format. If the export cannot fit the storage allowance, it preserves the document and restores a recognized extension (uniquified as usual), instead of retrying the same unaffordable conversion forever.
- **Download.** `GET /api/files/:id/export` returns the real file with an attachment disposition, `nosniff`, and a sandbox CSP. Open editors export locally instead, so offline edits are included.
- **Copy, trash, purge, quota, and backup** carry the format and assets along.

## Assets

- `GET /api/files/:id/assets/:hash` returns the bytes as `application/octet-stream`, with the stored type in `x-pulpo-asset-type`. It is always a download, never sniffed, and sandboxed, and since a hash always names the same bytes it is cached for good. Editors make object URLs from the bytes; untrusted content is never served inline from the app origin.
- `PUT /api/files/:id/assets?type=<mime>` (body `application/octet-stream`) stores one. It is checked against the per-file cap (at most 25 MB) and the storage allowance.
- **Unused assets.** Compaction deletes a document's assets that neither the document nor a pending proposal's fork refers to (`codec.referencedAssets`), once they are an hour old. The grace period lets editors upload an asset before they refer to it. Uploads and compaction schedule another collection after the grace period, so idle documents release unused assets too. Codecs that don't implement `referencedAssets` keep every asset.
- On the server, codecs get a `DocAssetStore`. It reads the document's assets, buffers new ones, and writes them with the document's transaction (`flush`). On the web, `ApiLiveAssetStore` fetches and uploads through these routes.

## Agents

What agents see and do is in [Files](./files.md#the-pulpo-files-command). Markdown keeps its inline-suggestion path. Every other live format goes through `agent/live.ts`:

- `pull` writes the codec's export, or this chat's pending proposal in Suggest mode. Its version is the checksum of those bytes. `cat` and `grep` read `toText`.
- **Write mode.** `push` applies the file through `codec.applyFile` as a minimal diff with origin `agent`, so users editing at the same time keep their edits. The change row keeps the document's export before and after as kept versions (`file_versions`), and undo and redo apply them back through the codec. Undo refuses when the document no longer exports as the reply left it, and the conflict carries both texts.
- **Suggest mode.** `push` stores a whole-file proposal: the pushed bytes, the export it was proposed against (`before`), and the proposal's fork (`forkKey`). The fork is the Y.Doc state of a copy of the document as it was, with the file applied as a minimal diff. Accepting applies the file as is when the document still exports as `before`. Otherwise it merges the fork into the document, which keeps what users wrote since. Rejecting drops the stored versions.
- **Revising a proposal.** A later push from the same chat builds on its pending proposal: it is diffed against that proposal's fork (the version the agent pulled), keeps the chain's `before`, and replaces the earlier proposal. Users' edits made in between are never taken back.
- **New files.** A new file with a live format's extension becomes a live document, unless it is larger than the format edits or the codec refuses its content (a binary `.plist`, a video `.ts`). Then it is an uploaded file, as before.

Review UIs read `FileChangeSummary.contentDiff` and fetch both versions:

- `GET /api/file-changes/:id/content/before|after` returns the bytes, for format diffs.
- `GET /api/file-changes/:id/text` returns both versions as `toText`. This is the diff any client can show for any format; mobile uses it.

## Adding a format

1. **Codec.** Implement `LiveFormatCodec` in `packages/client-core/src/office/<format>/`, with no DOM, and export it as `@pulpo/client-core/office/<format>`.
   - `applyFile` must report `changed` truthfully. Use `transactChanges`: state vectors miss deletions.
   - Binary parts go through `context.assets`.
2. **Catalog and registry.** Add a `LiveFormatInfo` to `LIVE_FORMATS` in `office/formats.ts`, with its extensions, schema version, `lossless`, `maxFileBytes`, MIME types, and `hasContent`, and add the codec to `CODECS` in `office/codecs.ts`. The server then creates, converts, renames, exports, copies, purges, and agent-edits the format. The registry test checks that the two agree.
3. **Web.** Add an entry to `LIVE_WEB_FORMATS` in `apps/web/src/features/files/live/registry.tsx`:
   - `Editor`: a lazy component taking `LiveEditorProps`, a thin React wrapper around your view core with the app's toolbar.
   - `Diff`: `LiveDiffProps`, two file versions as bytes.
   - `newLabel` and `newName`, and `exportFile`.

   Routes, the `FileHeader`, the side panel, downloads, creation menus, and the review dialog then pick it up.
4. **Mobile.**
   - Add `apps/mobile/editor/<format>/` (an `index.html` with `%CSP%` and a `main.ts` speaking `src/features/files/editor/protocol.ts`; send `format` in `ready`).
   - Add its entry to `EDITOR_BUNDLES` in `scripts/doc-editor-inputs.mjs` and to `editor/bundles.ts`.
   - Give `DocEditorView` its native toolbar items (`textToolbar.ts` shows how; the iOS host draws whatever `items` it gets, and Android's `FormattingBar` takes the same list). An item with `options` is a menu of them (`sheetToolbar.ts`).
   - Run `npm run build:editor -w @pulpo/mobile`. `editorBundle.test.ts` checks every bundle is fresh and keeps editors out of the Hermes bundle.
5. **Agents.** Mention the format and how to edit it in `files/agent/prompt.ts` and `packages/workspace-daemon/src/cli-help.ts`.

The OOXML package helper preserves original XML part bytes after read-only inspection (including UTF-16, content types, and relationships); it serializes a cached DOM only when its content changes.

All Office engines use the same package checks. The reader walks classic ZIP and ZIP64 central directories, validates ZIP64 end records and extra fields, and cross-checks local headers and data descriptors. It refuses encryption, methods other than store/deflate, duplicate names (including case and normalized-path collisions), renamed Unicode Path fields, overlapping entries, and inconsistent names, flags, methods, sizes, or CRC-32 checksums. Deflate is streamed in bounded input chunks; actual output is counted against the declared entry size and package expansion budget before it is retained, so false size declarations cannot cause silent truncation or bypass expansion limits. Existing entry-count limits still apply. The writer fixes every entry's timestamp to local midnight on 1980-01-01 so export checksums stay stable over time. It keeps `[Content_Types].xml` first, compresses XML at level 6, and stores already-compressed media without recompressing it. These checks do not change the codec or package APIs. The writer builds local headers, the central directory and the end record directly from an ordered entry list, preserving names such as `__proto__`. It uses one-shot `deflateSync` at level 6 for ordinary parts and stores already-compressed media. All local CRCs and sizes are populated; no data descriptors are written. This avoids a streaming-deflate corruption bug in binary printer-settings parts and LibreOffice's rejection of stored entries with descriptors. The fixed local timestamp is constructed on each write so timezone changes cannot invalidate it. For normal part names in the same order, output is byte-identical to the original `zipSync` writer with the same options (checked across Office, LibreOffice, Python and POI samples). Checksums change when upgrading from the intervening streaming writer. Exports over the default 10,000-entry/512 MiB expansion limits or classic ZIP field widths are refused with `too_large`; imports still support ZIP64.

## The text format

- **Layout** (`office/text/layout.ts`). `text` is one Y.Text holding the content, with every line break as `\n`. `textFile` is a Y.Map holding `encoding`, `lineEnding`, and, for files with mixed line breaks, `original`.
- **Encodings.** UTF-8 with or without a BOM, UTF-16 LE or BE with a BOM, and Windows-1252 for bytes that are not UTF-8 but read as Western text. Windows-1252 files keep their original bytes as an asset until edited. One that gains a character the encoding lacks is written as UTF-8.
- **Refusals.** These are refused with `LiveFormatError`:
  - NUL bytes, or a steady share of control characters;
  - 8-bit text with more than a tenth high bytes (likely Shift-JIS, GBK, or another encoding Windows-1252 would garble);
  - UTF-16 with a broken surrogate pair (documents store UTF-8, which cannot hold one);
  - external imports and agent pushes over 4 MB. Previously valid snapshots grown in the collaborative editor may be restored and compared past that cap: restore accepts up to 32 MB of encoded file bytes (UTF-16 with CRLF can expand the supported 8 MB state fourfold), and the server still checks the resulting Yjs state limit.
- **Byte faithful.** Export is byte for byte when nothing changed, BOM, line breaks, and trailing newline included. For a file with mixed line breaks, the original bytes are kept as an asset and returned while the text still hashes the same. Once edited, every line break takes the dominant style, as most editors do.
- **`applyFile`** diffs line by line, then narrows each changed run to the characters that differ, and applies the result as Y.Text inserts and deletes. The line diff is Myers for up to 4,000 differing lines. Beyond that, lines that occur once on each side anchor the match (patience diff), so even a file changed all over keeps every line it did not change. Concurrent edits elsewhere in the file merge.
- **Editor** (`office/text/view`). CodeMirror 6 bound with `y-codemirror.next`:
  - highlighting by extension, each language a lazy import;
  - other sessions' labeled cursors;
  - line numbers, folding, bracket matching, and find and replace (Ctrl/Cmd+F; Ctrl+H, or Cmd+Option+F and Cmd+Shift+H on a Mac, for replace, which starts in the find field until there is something to find, as in VS Code);
  - go to line with Ctrl+G (literal Control, so Cmd+G stays Find next on a Mac) or Ctrl/Cmd+Alt+G: `12`, `12:4` (columns counted from 1, as the status bar shows them), `+5`, or `50%`;
  - word and character counts on request (`counts('document' | 'selection')`, by the Word editor's rules), kept out of the state the mobile page posts on every change;
  - wrapping, line numbers, the browser's spell checking (off unless asked), indentation (detected from the file, changeable), commenting lines out (`canToggleComment`, `toggleComment`), and undo/redo of this session's own edits;
  - `selectAll`, `selectionText`, and `replaceSelection(text)` for menus' clipboard commands (a replacement is one undo step of its own);
  - read-only mode, and colors from the host's CSS variables in light and dark.
- **On the web**, `TextDocEditor` adds a menu bar laid out like VS Code's and Docs' (`text-menus.ts`), a toolbar, and a status bar (cursor, language, encoding, line breaks). HTML files get a live preview in the opaque-origin sandbox. Cmd/Ctrl+P prints the text, monospaced, from a hidden frame; Cmd/Ctrl+/ comments lines out as in VS Code (in plain text, where there is no comment syntax, it opens the shortcuts list). See [Editor chrome](./files.md#editor-chrome).
  - An opened file takes the keyboard (unless something else has it, and never in the side panel), so Ctrl/Cmd+F finds in it at once. The find, replace, and go-to-line keys also work while the toolbar or status bar has focus, and the toolbar's Find leaves the caret in the find field.
  - The status bar's `Ln, Col` opens go to line. It counts lines, the number of cursors when there are several, and words in prose files (`.txt`, `.log`, `.rst`, `README`, and the like) and for any selection (`12 of 345 words`, as in Word). Clicking the counts opens a Word count dialog (words, characters with and without spaces, lines; document and selection). Document counts wait 300 ms after the last change.
  - Menus (indentation) and dialogs give the keyboard back to the text when they close.
  - **Edit**: undo and redo; cut, copy, and paste (through the browser's clipboard; where it refuses the menu, a toast names the key to press instead) and select all; find, find and replace, and go to line; toggle line comment (only where the language has comments), indent, outdent, and indentation (spaces or tabs, and their width).
  - **View**: wrap lines (also Alt+Z, as in VS Code; AltGr+Z still types. On a Mac, Option+Z wraps only where it types Ω, as on US, ABC, and German layouts: where it types a letter, such as ż on Polish Pro, the letter is typed, and wrapping stays in the menu and the toolbar), line numbers, spell check (on for prose files and Markdown, off for code; it lasts while the file is open), the HTML preview, and zoom (80% to 200% of the editor's font). Line numbers and zoom are this browser's preferences; a zoom other than 100% shows in the status bar, which resets it on click. **Tools**: Word count.
- **On mobile**, the same core runs in `editor/text/` (about 1.4 MB with every grammar inlined), with undo, redo, indent, outdent, find, and wrap on the keyboard bar.

## The notebook format

Jupyter notebooks (`.ipynb`) are edited cell by cell, by several people at once, and by agents that run them in their sandbox. The code is in `office/notebook` (codec, layout, edits, diff) and `office/notebook/view` (the editor core).

### Layout

`office/notebook/layout.ts` documents it in full. In short:

- `notebook` (Y.Map) holds `nbformat` and `nbformat_minor`, plus what the codec keeps to write the file back as it was: its JSON `style`, the order of its top-level `keys` and `metadataKeys`, unknown top-level keys (`extra`), and `original` (see below).
- `metadata` (Y.Map) holds the notebook's metadata, one entry per key (`kernelspec`, `language_info`, …). Each value is compact JSON in the file's own spelling, so concurrent changes to different keys merge.
- `cells` (Y.Map of Y.Maps, keyed by a random cell key) holds the cells. Each has:
  - `order`: a fractional key; cells sort by it, then by key.
  - `cell_type`, the nbformat `id`, and `source` (a Y.Text). The editor binds CodeMirror to it.
  - `metadata` (like the notebook's), and the cell's key order.
  - `execution_count` and `outputs` for code cells, `attachments` for Markdown and raw cells.

Why it is shaped this way:

- **Moves keep concurrent edits.** Moving a cell rewrites only its `order`. Moving it in a Y.Array would delete it and insert a copy, and a collaborator's typing in the old copy would be lost. Keys end in random digits, so two people inserting at the same place get distinct, deterministic positions.
- **Outputs are one value per cell.** Outputs are replaced, never edited in place: an agent runs the notebook, or someone clears them. So `outputs` is one JSON value, last writer wins.
- **Large parts are assets.** Images (base64 under an `image/*` type) and any value of 16 KB or more go to the document's assets. The JSON keeps a `\u0000pulpo-asset:<n>` placeholder in their place, so a notebook full of plots syncs as text. `referencedAssets` lists the assets, so unused ones are collected.

### Writing the file back

- **Unedited notebooks are byte-faithful.** `office/notebook/json.ts` parses JSON into nodes that keep key order, number spellings (`1e-05`, `1.0`), and string escapes. Export writes them back in the file's detected layout: indent (Jupyter's one space, two, none, or `indent=0`), separators (including Python 2's `, `), `ensure_ascii`, sorted or file-order keys, CRLF, a byte order mark, and the trailing newline.
- **What the serializer can't rebuild is kept.** At import the codec writes the document back and compares. When the bytes differ (a hand-edited layout, an upgraded nbformat 3 file, a source split oddly), it keeps the file as an asset. It returns that file until the export changes.
- **Edits stay small in git.** Once edited, every cell is written in the file's layout, and sources are split into lines the way nbformat does (Python's `splitlines`). A one-line edit is a one-line diff.
- **Ids are made valid on export.** Missing ids in 4.5+ notebooks are filled in, and repeated ids get a suffix. New cells get 8-hex ids in 4.5+ notebooks and none in older ones.

### applyFile and the agent flow

`applyFile` pairs each cell of the new file with an existing cell (`match.ts`):

1. by nbformat id,
2. then cells with identical type and source, in order,
3. then, between two paired cells, cells whose lines are at least 40% alike.

Paired cells are updated field by field, and sources by the text format's minimal text diff, so someone typing in the same cell keeps their edit. Unpaired cells are added or deleted. Paired cells outside the longest run that kept its order get new `order` keys, which is a move.

A notebook written by `nbformat.write` or run by `nbconvert --execute` then exports to exactly the pushed bytes, as the Python-backed tests check. `toText` (what `cat` and `grep` read) shows each cell under a `# %% [type] cell N · In [n] · id …` line, with outputs summarized as comments.

### Validation

These are refused with `LiveFormatError`:

- text that isn't JSON or isn't UTF-8;
- JSON nested more than 256 levels;
- nbformat other than 3 or 4, or a missing `nbformat_minor`;
- `cells` that isn't a list, an unknown `cell_type`, or a source that isn't text;
- an output with an unknown `output_type` or missing required fields;
- more than 10,000 cells, or files over 25 MB.

Fields the editor doesn't model are kept: unknown keys anywhere, metadata, and widget state.

### Editors

- **The core** (`office/notebook/view`). `NotebookController` holds:
  - the active cell, the selection, and Jupyter's command and edit modes, with their keys (A, B, D D, X/C/V, Y/M/R, Shift+M, O, Z and Shift+Z (redo), 1 to 6 (Markdown heading of that level), arrows and J/K, Shift+Enter), VS Code's (Alt+↑/↓ move cells, Shift+Alt+↑/↓ duplicate them, Ctrl/Cmd+Shift+↑/↓ move them), and Colab's Ctrl+M chords in both modes (then A/B insert, D delete, Y/M type, O outputs, - split, K/J move, N/P select, Z undo, L line numbers, H help; literal Control, as Cmd+M minimizes on a Mac);
  - view commands it hands to the view (`setViewCommandHandler`): find and replace (Ctrl/Cmd+F, Ctrl+H, Cmd+Option+F), line numbers (Shift+L), the shortcuts (H), and output scrolling (Shift+O). Without a handler (the mobile page) their keys are left alone;
  - duplicate, collapse or expand every code cell's source or outputs (one undo step; collapsing outputs skips cells without any, so their metadata is untouched), and pasting the system clipboard's text: text this page copied as cells pastes the cells whole, anything else becomes a new code cell;
  - a page-wide clipboard (cells pasted into another notebook bring their images);
  - one undo manager for this session's structural changes and every cell's typing;
  - which cell each collaborator is on, from awareness.

  `createCellEditor` binds CodeMirror to one cell's Y.Text, with the text editor's theme and the kernel's language. Cells don't run in the browser, so Shift+Enter moves to the next cell. Options add a line-number gutter, wrapping for code cells, the host's find (`onFind`, in place of the cell's own search panel), keys the host sees first (`onKeyDown`, for chords, so Ctrl+M no longer switches CodeMirror's Tab to moving focus), and find-match marks. `setType` changes an open editor along with its cell (Ctrl+M M while typing): highlighting, wrapping, the Markdown keys, spell checking (off in code), and the accessible name and placeholder the host passes. `focus('keep')` puts the caret back where it was, even after the cells moved while a menu had the keyboard, which leaves the page's selection outside the editor. (React's strict mode, in development, rebuilds a moved cell's editor; the web host carries its caret over, but the browser can still put it at the start: WebKit always does, and Chromium sometimes does, when the rebuilt editor's highlighting redraws its line just after. The live-editors harness takes `strict=0` to run as production does, where the editor is never rebuilt.)

  `NotebookSearch` (`view/search.ts`) finds across every cell's source in notebook order: match case, whole words, and JavaScript regular expressions (replacements may use `$1`, `$<name>`, `$&`). The current match steps from the active cell's cursor and stays put while the query is typed. Replacing one match or all of them is one undo step each, in the controller's undo manager, so it takes back only this session's replacements. Matches are recounted 150 ms after anyone's edit and listed up to 10,000 (replace all replaces every one).

  Markdown cells format with Ctrl/Cmd+B (`**bold**`), I (`*italic*`), and K (`[text](url)`, with `url` selected), as VS Code and GitHub do; bold and italic come off again on a second press. These keys are taken (default prevented) only in an editable Markdown cell, so in code cells Ctrl/Cmd+B still toggles the app's sidebar.

  `notebookOutline` (`outline.ts`) lists Markdown cells' headings by Markdown's rules (marked's lexer): not `#` in fences, setext and `<h2>` headings yes, inline markup reduced to text. `notebookToScript` and `notebookToHtml` (`export.ts`) back File ▸ Download: a Jupytext percent-format script (`# %%` cells, Markdown and raw cells as comments; the extension from `language_info`). In Python, IPython's magics and shell escapes are commented out after their indentation, as Jupytext does (`%time`, `!pip`, `files = !ls`, a cell magic's whole cell, and the lines a trailing backslash carries a magic on to), but only where a statement starts: lines inside a string (`%s` in a `"""` template), inside brackets (a `!=` continuing a condition), or after a backslash stay as they are. Unlike Jupytext, `!!ls` is commented out too, so the script still runs. The other download is a static page from `renderNotebookHtml`'s `static` option (HTML outputs and Markdown made inert, JavaScript outputs as their plain text, and a content security policy that allows only inline styles and images).
- **On the web** (`features/files/live/notebook`):
  - Code cells are CodeMirror editors, mounted as they scroll near the screen.
  - Markdown cells render with the app's Markdown component until edited.
  - Outputs use the notebook viewer's renderers; HTML and JavaScript run only in the sandbox.
  - The toolbar has undo and redo, insert, cut, copy, paste, move, delete, cell type, split, merge, hide outputs, clear outputs, and the keyboard shortcuts.
  - A menu bar laid out like JupyterLab's and Colab's (`notebook-menus.ts`), with the shared keys of [Editor chrome](./files.md#editor-chrome): Cmd/Ctrl+P prints the notebook as the viewer renders it (`renderNotebookHtml`, in a frame without scripts), and Cmd/Ctrl+/ lists command and edit mode keys (in a cell it comments lines out instead).
    - **File ▸ Download** adds Python (`.py`, or the kernel language's script) and a static web page (`.html`, formulas as MathML) to the host's formats.
    - **Edit**: undo and redo; cut, copy, paste below and above, and delete cells; select every cell; find, and find and replace; clear the selected cells' outputs, or all.
    - **View**: table of contents, line numbers, wrap long lines, scroll long outputs, collapse and expand all code or outputs, and hide or show the selected cells' code and outputs.
    - **Insert**: code or Markdown cells above or below, a heading (1 to 6) as a new Markdown cell with the caret after its `#`s, and duplicate cell.
    - **Cell**: cell type, move up or down, split at the cursor, merge the selected cells or with the cell below, hide code and outputs, and delete. **Runtime ▸ Run all with agent** shows where an agent can run the notebook.
    - Every menu reads the controller's state as it opens, and disables what a viewer can't do.
  - Right-clicking a cell's prompt, frame, rendered Markdown, or outputs (or Shift+F10 and the menu key in command mode) opens its context menu: the clipboard, insert above or below, duplicate, move, cell type, split and merge, hide code or outputs, clear outputs, copy the output text, and delete. It acts on the selection the cell is part of, and gives the keyboard back to the cells. In a cell's code, on links and pictures, over selected text, or with Shift held, the browser's own menu shows.
  - Cells can be dragged to move them, and collaborators' cursors and cells show.
  - The active cell's toolbar has duplicate, move, insert above and below, delete, and a menu (hide code or outputs, clear outputs, cut, copy, paste, split, merge). Its menus and the toolbar's give the keyboard back to the notebook when they close.
  - Find and replace (Ctrl/Cmd+F, Ctrl+H; also from a cell, seeded with its selected text) opens a bar above the cells with the match count, previous and next (Enter and Shift+Enter in the bar; F3 and Ctrl/Cmd+G, with Shift for previous, in the bar, a cell, or the cell list), match case, whole words, and regular expressions. Matches are marked in the cells; a match in rendered Markdown shows that cell's source. Escape closes it and leaves the match selected in its cell.
  - The table of contents lists the Markdown headings, marks the active cell's section, and goes to a heading on click. It stays open from one notebook to the next, except in the side panel, where it floats over the cells and opens only when asked.
  - View options: line numbers (Shift+L) and wrapping long lines in code cells, which are this browser's preferences, and collapse or expand all code or outputs, which the notebook records. Viewers who can't edit can still open hidden code or outputs for themselves; the notebook keeps them hidden.
  - Outputs taller than 28rem scroll inside their cell, with a toggle (or Shift+O) to show them in full.
  - Ctrl/Cmd+C, X, and V work on selected cells in command mode; pasting text copied elsewhere adds a code cell. Text selected in an output or rendered Markdown copies as text instead. Copying cells (keys, menus, toolbars) puts their text on the system clipboard as the browser copies (`clipboard.ts`), even an empty cell's, so Ctrl/Cmd+V recognizes them; where the browser sends no copy event, the text is written afterwards, and until that succeeds (or if it is refused) Ctrl/Cmd+V pastes the copied cells rather than the older text the clipboard still has. Another copy on the page, or leaving the window, ends that. A paste in command mode is taken before a cell's editor, so text left selected in it is not pasted over.
  - The status bar shows `Ln, Col` while editing and `Cell n of m` otherwise.
  - **Run with agent** opens a new chat with the notebook attached for direct edits and asks the agent to run it.
- **On mobile** (`editor/notebook`). The same core is drawn for phones:
  - Cells are cards; the active one has a type picker and move and delete buttons.
  - Markdown is rendered with marked and sanitized to a short allowlist.
  - Outputs are drawn in the page, or in iframes sandboxed without scripts. Images come from the app, which fetches assets over the bridge (`asset` messages).
  - The keyboard bar has undo, redo, indent, insert, code/Markdown, move, and hide outputs; the screen menu clears all outputs.
- **Review**. `diffNotebookFiles` compares two files cell by cell: added, removed, moved, and edited cells (with a line diff), output changes summarized, and changed notebook and cell metadata keys. Output comparison covers the complete data even when the displayed summary is capped at 1,000 outputs. The web's review dialog and the mobile change sheet show it.

Serialization is checked before indentation is allocated: generated JSON is capped at 25 million characters and four times its compact representation (with a 1 MB floor). Expansive layouts are refused with `LiveFormatError('too_large')` before import changes the document; collaborative states are checked again on export. Files that exceed these limits remain uploads.

### Known limitations

- Cells can't be run in Pulpo; agents run notebooks in their sandbox.
- Widget state is kept, but widgets don't render.
- Mobile shows LaTeX in Markdown cells as written.
- Attachments can't be added to Markdown cells from the editor; existing ones are kept and shown.
- Cell metadata other than collapsed outputs and sources (tags, slideshow) is kept but can't be edited.
- Hiding code and hiding outputs write the same `jupyter` metadata value, so two people changing one cell's two flags at the same moment keep only the last change.
- Find searches sources, not outputs. Copied cells paste with their outputs only within the browser tab that copied them; elsewhere they paste as text.

