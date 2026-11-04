# Presentations

Pulpo opens PowerPoint decks (`.pptx`, `.potx`, `.ppsx`, `.pptm`, and their macro-enabled siblings) as live, collaborative documents. People and agents view, edit, and present them in Pulpo itself; downloads and agent `pull` still produce real `.pptx` files. This page describes the engine in `@pulpo/client-core/office/presentation`: the model, what is editable, what is kept but not edited, and how it is tested.

The engine is not yet reachable from Files routes. It plugs into the live-formats foundation (format registry, document socket, assets, agent push and pull) in a follow-up. Until then it runs in the test harness described under [Testing](#testing).

## Design

A deck is a Y.Doc. The codec (`presentationCodec`, a `LiveFormatCodec`) converts between the Y.Doc and file bytes:

- `importFile` reads the package into a **snapshot** (plain data, `model.ts`) and writes it into the Y.Doc.
- `exportFile` reads the snapshot back out of the Y.Doc and writes a package.
- `applyFile` reads a pushed file, matches its slides and shapes to the document's (by the slide and shape ids an export would write), and reconciles the Y.Doc to it with minimal edits, so concurrent edits survive.
- `toText` lists each slide's text, tables (tab-separated), chart data, alt text, and speaker notes.

### Lossless by construction

The engine models what people edit and keeps everything else verbatim:

- **Parts nobody edits stay raw.** Masters, layouts, themes, charts, SmartArt, comments, tags, custom XML, embedded workbooks, fonts, and `vbaProject.bin` are kept as their exact bytes (XML) or as assets (binary parts, in the `LiveAssetStore`, addressed by SHA-256) and written back unchanged. The renderer reads them; nothing writes them.
- **Slides keep templates.** Each slide keeps its XML without its shapes (transitions, timing, `extLst`, `mc:AlternateContent`, and anything unknown stay there), and each shape keeps its own element as XML. Modeled properties are written into that template on export, and only those whose value changed: a property whose model value still equals what its template says is left exactly as it was.
- **Untouched slides are byte-identical.** Each slide also keeps its original bytes. On export, the engine re-reads them and compares; if nothing the model covers has changed, the original bytes are written. The same holds for notes slides, relationships parts, `presentation.xml`, and `[Content_Types].xml`.
- **Relationships are resolved, not copied by id.** Shapes record what each `r:` attribute points at (a part path or URL). On export the slide's relationships are rebuilt, reusing the original ids where the target is the same, so shapes can be copied between slides and decks.
- **Identifiers are assigned on export.** New slides get the next free `p:sldId` and part name; new shapes the next free `cNvPr/@id` on their slide. Duplicates that concurrent edits can create are repaired the same way. Assignment is deterministic, so `applyFile` can predict which file ids belong to which document keys.
- **Garbage collection is conservative.** Parts that only a deleted slide used (its chart, its notes) are dropped; parts that were already unreachable in the imported file are kept.
- **No dangling references.** Links to deleted slides keep their action with an empty relationship id (as PowerPoint leaves them), custom shows drop deleted slides, and animations and connector glue that name deleted shapes are removed. Duplicated slides keep their shape ids, so their animations still apply; comments are not duplicated.
- **Text is valid XML.** Vertical tabs (PowerPoint's soft line breaks) are written as `a:br`; characters XML cannot hold are dropped.

Saving a `.pptm` as `.pptx` drops the VBA project and its content type, because macro-free formats cannot hold it. Macros are never run.

### Collaborative layout

Everything lives under the root map `presentation` (`ydoc.ts`):

| Key | Type | Holds |
| --- | --- | --- |
| `version`, `mainPart`, `slideWidth`, `slideHeight`, `notesWidth`, `notesHeight` | scalars | Deck settings (EMU) |
| `parts` | `Y.Map<path, {bytes \| asset, contentType, orphan}>` | Raw parts |
| `slideOrder` / `slides` | `Y.Array<key>` / `Y.Map<key, Y.Map>` | Slide order and slides |
| `sectionOrder` / `sections` | `Y.Array<key>` / `Y.Map<key, {name, id}>` | Sections; slides name their section |

A slide map holds scalars (`layout`, `hidden`, `section`, `background`, `rels`, the template `xml`, the original `source`), `shapeOrder`/`shapes` (z-order and shapes, flat, groups list their members' keys in `children`), and `notes` (a map with the notes text). A shape map holds each modeled property under its own key: `xfrm` (a nested map: `x`, `y`, `cx`, `cy`, `rot`, `flipH`, `flipV`, child extents), `geom`, `fill`, `line`, `effects`, `blipFill`, `bodyPr` (XML strings), `name`, `descr`, `hidden`, `text` (a `Y.XmlFragment`), and `table`. A table map holds `columnOrder`/`columns` and `rowOrder`/`rows`; rows hold cells keyed by column key, each with its text fragment.

Why this shape:

- **Order arrays of keys beside maps of content.** Moving a slide, reordering shapes, or inserting a table row is a small edit to an array of keys; the content's map is untouched, so someone else's edits to the moved item are never lost. Concurrent moves can list a key twice; readers keep the first.
- **One key per property.** Two people moving and recoloring the same shape, or one resizing while another rotates, merge. Same-property conflicts resolve last-writer-wins, as in Google Slides.
- **Text is a ProseMirror document per text body**, bound with y-prosemirror, so typing in the same shape merges character by character. Paragraph properties are one raw `a:pPr` per paragraph (rarely contended). Run properties are split into one mark per property (`b`, `i`, `u`, `strike`, `sz`, `font`, `fill`, `highlight`, `baseline`, `cap`, `spc`, `link`) plus a mark holding the rest of `a:rPr`, so one person bolding a range while another colors it keeps both. Fields (slide number, date), line breaks, and unknown inline content (equations) are inline nodes; unknown ones are kept verbatim.
- **Cells keyed by column key**, so inserting a column while someone types in a cell keeps both.
- **New identifiers are random keys**; file ids are assigned only on export (see above), so two people adding slides or shapes at once cannot collide.

`PRESENTATION_SCHEMA_VERSION` (1) must be bumped when this layout changes in a way older clients would misread.

### Rendering

`render/` turns a slide into HTML and SVG, in pixels at 100% (9525 EMU per px), which views scale with CSS. It is DOM-free (Node can render too) and escapes everything it writes; the only URLs it emits are the object URLs its caller provides for images.

- **Inheritance**: slide placeholders inherit transform, geometry, fill, line, effects, body properties, and list styles from the matching layout placeholder (by `idx`, then type) and master placeholder (by type). Text styles cascade presentation defaults → master text styles (title, body, other) → master and layout placeholder list styles → the shape style's font reference → the shape's own list style → paragraph and run properties.
- **Themes**: color schemes through the color map (`clrMap`, `clrMapOvr`), every color model and transform (lumMod/lumOff, tint and shade in linear light, alpha, satMod, hue, …), theme fonts (`+mj-lt`, `+mn-ea`, …), and format-scheme fills, lines, and effects through `p:style` references. Backgrounds come from `p:bg` (`bgPr` or `bgRef`) on the slide, layout, or master.
- **Geometry**: all 187 preset shapes from `presetShapeDefinitions.xml` (guide formulas evaluated, text rectangles, adjust handles, connection sites) and custom geometry.
- **Fills and lines**: solid, linear and path gradients, pattern, picture (crop, stretch, tile, alpha, grayscale), group fill; width, preset and custom dashes, caps, joins, compound lines (approximated), and arrowheads. Outer shadows are drawn; other effects are kept.
- **Text**: insets, anchoring, wrapping, columns, vertical text, autofit (`normAutofit` font scale and line spacing reduction, applied through one CSS variable), alignment, indents, line and paragraph spacing, bullets (characters with symbol-font mapping, auto-numbering schemes, pictures), and run formatting including hyperlinks, highlight, caps, spacing, and baseline. Fonts fall back to metric-compatible families (Carlito for Calibri, Liberation for Arial and Times New Roman, …).
- **Tables** with table styles (PowerPoint's built-in styles by GUID, or definitions in `tableStyles.xml`), banding flags, cell fills, borders, margins, anchoring, and merges.
- **Charts** from the chart part's cached data: bar and column, line, area, pie, doughnut, scatter, bubble, radar, and combinations with secondary axes; surface, stock, and `cx:` charts show a placeholder.
- **SmartArt** from the cached drawing PowerPoint saves (`dsp:drawing`).
- **Media**: video and audio show their poster frame with a play button; playing uses the asset's bytes, only in formats the browser plays natively.
- **OLE objects** show their fallback picture.

### Editing

The view core (`@pulpo/client-core/office/presentation/view`) is imperative DOM, so the web app and the mobile webview can both host it:

- `PresentationController` owns per-slide caches, selection, presence (awareness field `presentation`: slide, selected shapes, shape being edited), per-user undo (`Y.UndoManager` tracking only this user's origins; a drag is one step), image URLs, and the command API toolbars call (insert, arrange, align, distribute, group, format text, slides, layouts, background, clipboard).
- `SlideCanvas`: select, shift-click and marquee multi-select, move with smart guides to the slide's edges and center and other shapes, resize (Shift keeps the aspect ratio; pictures keep it from corners), rotate (Shift snaps to 15°), arrow-key nudge, Delete, Cmd/Ctrl+D, G, Shift+G, A, Z, Y, copy, cut, paste (shapes and images), collaborators' selections with names, pinch and Ctrl-wheel zoom, double-click or double-tap to edit text, typing to replace a selected shape's text, and clicking links (http, https, mailto only) and media.
- `InlineTextEditor`: ProseMirror over the shape's text fragment, styled by the renderer's own functions so editing looks like the slide. Enter, Shift+Enter (line break), Tab and Shift+Tab (list level), Cmd/Ctrl+B/I/U, collaborators' carets. Autofit runs while typing: "shrink text on overflow" lowers the font scale in 10% steps and "resize shape to fit text" grows the shape, both written to the model.
- `SlideList`: the thumbnail strip and the slide sorter (lazy thumbnails, sections, hidden slides, collaborators' positions, multi-select, drag to reorder, keyboard).
- `NotesEditor`: speaker notes. Every slide (and every shape that can hold text) has its text fragment from the start, so two people who start typing notes at once both keep their text; a notes page is written only when there are notes.
- `Presenter`: full screen, keyboard (arrows, space, Page Up/Down, Home, End, number + Enter, Esc), click, tap, and swipe; hidden slides are skipped; slides with a transition fade in. The presenter view adds the next slide, notes, a timer, and the count. `.ppsx` decks open in the show.
- `printSlides`: one slide per page at the slide's size, for Save as PDF.

The web wrapper (`apps/web/src/features/files/live/presentation`) arranges these with the app's toolbar buttons, menus, popovers, and `ui()` strings: insert (slide from a layout, text box, shape gallery, image, table), text formatting (font, size, bold, italic, underline, strike, color, alignment, bullets, numbering, list level, line spacing), shape fill, arrange, slide (layout, duplicate, hide, delete), sorter, format panel (size, position, rotation, fill, line, dash, shadow, slide background), export to PDF, and present.

### Review diffs

`diffDocuments`, `diffDocumentWithFile`, and `diffFiles` compare two versions: slides added, removed, moved, and edited; per slide, layout, visibility, background, notes, and transition changes; per shape, added, removed, text (with before and after), formatting, moved, resized, rotated, fill, line, geometry, picture, and table changes; and deck-wide theme, master, media, and size changes. `PresentationDiffView` shows them with before and after thumbnails and line diffs of text. The review UI for agent proposals will use it.

### Copy and paste between decks

The clipboard payload (`application/x-pulpo-presentation+json`) carries the copied shapes or slides and every part they reach through relationships (images, charts and their workbooks, SmartArt parts). Pasting into another deck brings those parts along under fresh names and maps slides to the layout with the same name.

## Supported, kept, and not yet supported

| Feature | Status |
| --- | --- |
| Text, shapes, pictures, tables, groups, connectors, notes, sections, hidden slides, layouts, backgrounds | Rendered and editable |
| Themes, masters, layouts | Rendered; kept, not editable |
| Charts | Rendered from cached data; kept, not editable |
| SmartArt | Rendered from its cached drawing; kept, not editable |
| Video, audio | Poster and playback; kept |
| Transitions | Kept; played as a fade |
| Animations, comments, tags, custom XML, ink, OLE objects, embedded fonts, VBA | Kept, not played or edited |
| Effects other than outer shadow (glow, soft edges, reflection, 3-D) | Kept, not drawn |
| Strict Open XML, encrypted files, legacy `.ppt` | Refused with a clear error (legacy formats are converted elsewhere) |

Known limitations, most important first:

- Group members are selected and edited through their group (ungroup to change one member); grouping is limited to shapes in the same container.
- Picture crop and adjust handles (the yellow ones) have no on-canvas handles yet; values from files are honored.
- Animations do not play in the slide show; transitions all play as a fade.
- Text layout uses the browser's line breaking and the fonts available; without Calibri, Carlito or system fallbacks change line breaks slightly.
- Charts do not draw error bars, trendlines, data tables, or leader lines; date axes are spaced evenly; 3-D charts are drawn flat.
- The Y.Doc keeps templates and each slide's original bytes beside the model, about 4× the uncompressed package for shape-heavy decks.
- `applyFile` reconciles the document with the pushed file, not with the version the agent pulled: edits other people made between the agent's pull and its push are overwritten where the agent's file differs. Concurrent edits that are still in flight merge. A three-way merge needs the pulled version, which the agent integration can provide later.

## Limits and hostile files

Every file is untrusted. Reading refuses (with a `LiveFormatError`) packages over 10,000 parts or 512 MiB expanded, zip entries whose compressed size dwarfs their declared size, XML nested deeper than 256 levels, more than 5,000 slides or 10,000 shapes on a slide, groups nested deeper than 64, and slide sizes over PowerPoint's 56 inches. External relationships are never fetched. Charts cap series and points, and custom geometry caps guides and path commands.

## Testing

- **Regressions** (`regressions.test.ts`): cases from review, such as slide links after inserting slides, cleared table cells after a push, non-slide internal hyperlinks, animations on duplicated slides, dangling references, simultaneous first notes, Enter keeping paragraph properties, control characters, hostile clipboard payloads, and slide id limits.
- **Unit and round trip** (`packages/client-core`, `npm test`): every corpus deck exports byte-identical parts after an import through a second replica; edits through commands (text, shapes, images, tables, notes, grouping, layout changes, slide moves, sections) read back correctly; untouched slides stay byte-identical when another slide changes; macros are kept or dropped by format.
- **`applyFile`**: an agent-style edit merges with a concurrent user edit on another replica; re-applying the document's own export changes nothing; keys of slides and shapes the document created survive the round trip.
- **Concurrency**: three replicas make random edits (typing, moving, formatting, inserting, deleting, grouping, slide moves, table rows) with random partial syncs, converge to the same state, and export a valid deck with unique ids that exports identically again.
- **Hostile files**: zip bombs, deep nesting, entities, broken and cyclic references, path traversal, huge values, duplicates, truncated and non-zip files each fail with a typed error, or import and export cleanly, within seconds.
- **Performance**: a 300-slide deck imports in about 3 s and exports in about 2 s in Node; in the browser it opens in about 1.5 s and switches slides in about 25 ms, with only visible thumbnails drawn.
- **Fidelity** (opt-in, `PULPO_OFFICE_FIDELITY=1`): python-pptx reads every round-tripped deck the same as the original, LibreOffice opens it with every slide, edits made through commands read back in python-pptx, and a python-pptx edit merges through `applyFile`. `apps/web/tests/presentation-fidelity.browser.mjs` renders 66 slides from 16 decks and scores them against LibreOffice renderings: mean similarity 0.981 and structural similarity 0.990 at the time of writing.
- **Browser** (`npm run test:presentation-editor -w @pulpo/web`): select, move, resize, rotate, nudge, undo; marquee, group, align, delete; typing and formatting with two collaborators (presence and per-user undo); inserting text boxes, shapes, tables, images, and typing in cells; slide management by dragging; clipboard; the slide show and presenter view; read-only mode; touch; `.ppsx`; fixtures; the review diff; and performance budgets.

The corpus and its sources are listed in `packages/client-core/fixtures/presentation/README.md`; the Python and LibreOffice tools in `packages/client-core/test-tools/presentation/README.md`.

The harness (`apps/web/tests/presentation-editor/index.html`, served by `npm run dev -w @pulpo/web`) loads a fixture (`?deck=generated/autoshapes.pptx`, or `?blank=1`) into two Y.Docs kept in sync in memory, with `split=1` (both collaborators side by side), `view=diff`, `theme=dark`, `lang=es`, `readonly=1`, and `big=300`.
