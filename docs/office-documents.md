# Word documents

Pulpo opens Word documents (`.docx`, plus `.dotx`, `.docm`, and `.dotm`) as collaborative live documents: a Y.Doc holds the document, everyone editing it sees the others' cursors and changes, and downloads and agents still get real Word files. The engine lives in `@pulpo/client-core/office/docx` (codec, model, diff) and `@pulpo/client-core/office/docx/view` (the editor); the web editor is `apps/web/src/features/files/live/docx`. It is not yet reachable from the Files pages: that integration builds on the live-formats foundation.

## Codec

`docxCodec` implements `LiveFormatCodec`. It runs without a DOM, so the server can use it.

- **Import** reads the package with `OoxmlPackage`, stores every part's bytes in the `LiveAssetStore` (the Y.Doc keeps only hashes), and converts the main document, headers, footers, footnotes, endnotes, comments, styles, numbering, and a few settings into the model below.
- **Export** rebuilds the package from the original parts and regenerates only the parts the model owns. Each regenerated part has a fingerprint taken at import; when the regenerated XML still matches it, the original bytes are written instead, so a file opened and saved without edits comes back byte for byte, and an edit to the body leaves headers, styles, and every other part untouched. Saving under another extension switches the main content type (`.docx` drops macros, as Word does; `.docm` keeps `vbaProject.bin` as bytes, never running it).
- **`applyFile`** imports the new bytes and writes them into the Y.Doc as a minimal diff: paragraphs that did not change keep their Yjs items, so edits other replicas have not synced yet merge instead of being overwritten. Keyed maps (styles, lists, comments) change only the entries that differ. A file that reads the same as the current document is not a change, even if its bytes differ from the last export.
- **`toText`** is what agents read (`pulpo files cat`) and search indexes: the text with tracked changes accepted, list labels as Word draws them, headings marked `#` by outline level, tables as `|` rows, footnotes as `[^n]` with their text at the end, and comments with their author and the text they cover.

Hostile files fail with `LiveFormatError`: encrypted and legacy binary files (`encrypted`), zip bombs and absurd sizes (`too_large`), strict Open XML (`unsupported`), and malformed XML, DTDs, deep nesting, and deeply nested tables (`corrupt`). Zips whose central directory, local headers, or Unicode Path fields name parts differently are refused, because different readers would see different documents in them.

## Model

ProseMirror via TipTap's packages (`@tiptap/pm`, `@tiptap/y-tiptap`), with a schema of its own (`schema.ts`), separate from Markdown documents'. The principle: **everything is kept, and only what is edited is rewritten.** Anything the editor does not model rides along as JsonML (`[name, attrs, ...children]`, stored as a JSON string) and is written back exactly.

- **Paragraphs** carry their style and one attribute per paragraph property (alignment, indents, spacing, keep options, widow control, numbering, borders, shading, tab stops, outline level, bidi), plus the rest of `w:pPr`, the paragraph mark's run properties (and its revision marks), the section it ends (`w:sectPr`), `w:pPrChange`, and the element's own attributes (`w14:paraId`).
- **Runs** are text with one mark per run property (character style, fonts, bold, italic, caps, small caps, strike, double strike, hidden, color, spacing, scale, position, size, highlight, underline, shading, vertical alignment), a mark for the remaining `w:rPr` children, and `w:rPrChange`. Separate marks mean two people changing different properties of the same text both win.
- **Wrappers** around runs are marks too: hyperlinks, content controls, simple fields, smart tags and custom XML, and the revisions `w:ins`, `w:del`, `w:moveFrom`, `w:moveTo`.
- **Inline objects** are atoms: tabs, breaks (line, page, column), drawings (pictures, charts, shapes, text boxes, VML, alternate content; the picture's bytes are an asset hash), note references, comment markers, bookmarks, field characters and field codes, symbols, Office Math, and anything else (`inlineXml`). Yjs keeps marks only on text, so atoms store theirs in a `marks` attribute.
- **Tables** use prosemirror-tables roles. Horizontal merges are `colspan`, vertical merges become `rowspan` (the hidden cells are kept and written back), and rows that skip grid columns (`w:gridBefore`/`w:gridAfter`) get invisible placeholder cells so every table is a rectangle. Content controls around rows and cells, and bookmarks between them, are kept.
- **Block content controls and custom XML** wrap blocks; unknown blocks (`w:altChunk`, …) are opaque blocks. Bookmarks and comment ranges between blocks ride on the neighbouring block.

### Y.Doc layout

| Key | Type | Holds |
| --- | --- | --- |
| `body` | XmlFragment | The main story. |
| `story:<id>` | XmlFragment | Each header and footer (`header:<part>`), footnote, endnote, and comment. Root-level, so two replicas creating one merge. |
| `stories` | Map | Story id → kind, part, and root attributes. |
| `styles` | Map | `style:<id>`, `docDefaults`, `latentStyles` → JsonML. |
| `numbering` | Map | `abstract:<id>`, `num:<id>`, `picBullet:<id>` → JsonML. New lists get random ids, so two people making lists at once do not collide. |
| `comments` | Map | Comment id → author, initials, date, parent (replies), resolved. |
| `settings` | Map | Settings the editor reads or writes (track changes, even/odd headers, default tab stop). |
| `rels` | Map | The main part's relationships (headers and footers resolve through them). |
| `parts` | Map | Every original part → asset hash and size. |
| `docx` | Map | Document root and body attributes, the final section, the theme's colors and fonts, part fingerprints. |

Hyperlinks and pictures keep their target (URL, asset hash) rather than a relationship id, so they survive being copied between stories or documents; the exporter reuses or creates relationships and media parts as needed. New comments and notes get string ids that the exporter numbers.

`DOCX_SCHEMA_VERSION` must be bumped when the schema or layout changes in a way older clients would misread.

## Editor

`DocxEditor` (`view/editor.ts`) is framework-agnostic: it takes `{ container, doc, awareness, readOnly, assets, user, labels }`, renders into the container, and exposes commands (`toggleBold`, `setStyle`, `toggleList`, `insertTable`, `addComment`, `acceptAll`, …), `state()` for toolbars, and `update`/`layout`/`request` events. All visible text comes from `labels`.

- **Rendering** turns styles into a scoped style sheet (document defaults, paragraph and character styles with `basedOn` resolved, table-style conditions) and direct formatting into inline CSS, in Word's order of precedence. Lists are numbered like Word (abstract definitions shared between instances, overrides, restarts, legal numbering, bullets in symbol fonts). Table styles' borders, banding, and first/last row and column formatting are computed per cell. Theme colors and fonts resolve through the document's theme. Tab stops (left, center, right, decimal, with leaders) are laid out after rendering.
- **Print layout** paginates for real: the column is measured into lines, table rows, and blocks, and a pure layout pass (`view/layout.ts`) breaks pages with widow and orphan control, keep with next, keep lines together, page breaks and page-break-before, section breaks (next page, continuous, odd, even) with each section's page size and margins, room for the footnotes each page references, and repeated table header rows. Headers and footers (default, first page, even pages, inherited between sections) are drawn per page with PAGE, NUMPAGES, and SECTIONPAGES filled in; a header taller than its margin pushes the text down. **Web layout** shows one continuous column with notes at the end. Zoom scales the canvas.
- **Headers, footers, and notes** are edited in place by double-clicking them (a second editor on that story).
- **Tracked changes**: Suggesting mode turns typing, deleting, Enter, formatting, and paragraph changes into Word revision markup with the author and date; deleting your own suggestion removes it. Changes can be accepted or rejected one at a time or all at once, and the review panel lists them. The document's own Track Changes setting picks the starting mode.
- **Comments** have ranges, replies, resolution, and deletion; they are written to `comments.xml` and `commentsExtended.xml` so Word shows the threads.
- **Clipboard**: copying between Pulpo editors keeps everything; pasting from Word, Google Docs, or web pages keeps paragraphs, headings, lists (Word's `mso-list` too), tables, links, and run formatting, after removing scripts, styles, frames, event handlers, images, and non-web URLs.
- **Tools**: find and replace (match case, whole words), word count, a headings outline, format painter, table of contents (inserted as a real TOC field linked to bookmarks, and updatable), insert table, picture, link, page and section break, footnote, endnote, symbol. Keyboard shortcuts follow Word and Google Docs (Ctrl/Cmd+B/I/U, +E/L/R/J, +Alt+1–3, +Shift+7/8, +]/[, +Enter, +K, +F, +H, Tab and Shift+Tab in lists and tables). Commands are undo steps of their own. Pointer events drive resizing, so touch works.

## Review diff

`diffDocxFiles`, `diffDocxDocs`, and `diffDocxModels` compare two versions into a structured redline: paragraphs and table rows aligned, changed ones diffed word by word, added and removed ones listed, formatting changes on unchanged text noted by property, and changes to headers, footers, notes, comments, and styles. `DocxDiffView` renders it, collapsing unchanged runs.

## Testing

| Suite | Runs | Covers |
| --- | --- | --- |
| `codec.test.ts`, `engine.test.ts`, `view/layout.test.ts`, `omml.test.ts` | `npm run test -w @pulpo/client-core` | Edits written as WordprocessingML in schema order, macros, unmodeled parts, `applyFile` merging with a concurrent edit, hostile files and fuzzed bytes, numbering, styles, diff, commands, tracked changes, pagination rules, math. |
| `concurrency.test.ts` | same | Three editors bound through y-tiptap editing at random with shuffled, delayed sync must converge and export a file that reads back the same. |
| `corpus.test.ts` | `PULPO_DOCX_CORPUS=<dir>` (fetch with `node packages/client-core/scripts/fetch-docx-corpus.mjs`) | Apache POI's 138 Word files: no-edit round trips byte for byte, forced regeneration equal after canonicalizing, and models read back identically. |
| `fidelity.test.ts` | `PULPO_DOCX_FIDELITY=1` (Python venv, LibreOffice; see `scripts/docx-fidelity/README.md`) | python-docx reads what Pulpo writes as it reads the original, LibreOffice opens it, editor commands produce what Word expects, and an agent's python-docx edit merges with a user's edit. |
| `docx-editor.browser.mjs` | `npm run test:docx-editor -w @pulpo/web` | Real editing in the harness: typing, shortcuts, undo, styles, lists, tables, pasting, find and replace, comments, suggesting and accepting, layouts and zoom, two collaborators, read-only, and a 100+ page performance budget. |
| `docx-fidelity.browser.mjs` | `npm run test:docx-fidelity -w @pulpo/web` | Each fixture page against LibreOffice's rendering. |

The harness (`apps/web/tests/docx-editor/index.html`, dev server only) loads a fixture into a Y.Doc synced with a second collaborator: `?file=<fixture>`, `&view=split`, `&view=diff`, `&layout=web`, `&dark=1`, `&readonly=1`, `&generate=<paragraphs>`.

## Not supported yet

In rough order of importance:

- Multi-column sections render as one column (the setting is kept). Floating pictures wrap with CSS floats and page-relative positions are approximated against the paragraph. Text boxes, shapes, SmartArt, and charts show their fallback picture or a sized placeholder with their text; they cannot be edited.
- Table rows taller than a page are not split across pages. Column widths cannot be dragged. Inserting columns spreads the grid evenly.
- Content controls show and edit their content but their properties (date pickers, drop-downs, checkboxes) cannot be changed in the editor. Fields other than PAGE/NUMPAGES/SECTIONPAGES and the TOC show their cached result and are not recalculated.
- No ruler, line numbers, page borders, watermarks, or drop caps (all kept). Endnotes are drawn after the text without pagination of their own. Move revisions are shown and can be accepted or rejected per side, but moving text in Suggesting mode records a deletion and an insertion. Comments' text is plain when edited in Pulpo.
- Fonts render with the browser's fonts: Calibri, Cambria, and others fall back to metric-compatible open fonts when installed (Carlito, Caladea, Liberation), else to similar system fonts, which can move line and page breaks.
- Strict Open XML documents are refused.
