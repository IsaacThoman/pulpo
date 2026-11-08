# Presentations

Pulpo opens PowerPoint decks (`.pptx`, `.potx`, `.ppsx`, `.pptm`, and their macro-enabled siblings) as live, collaborative documents. People and agents view, edit, and present them in Pulpo itself; downloads and agent `pull` still produce real `.pptx` files. This page describes the engine in `@pulpo/client-core/office/presentation`: the model, what is editable, what is kept but not edited, and how it is tested.

Decks are a [live format](./live-formats.md) (`presentation`), so everything Files does for documents works for them:

- **Files.** **New → New presentation** creates `Untitled.pptx` from a blank 16:9 deck. Uploaded decks open read only until **Edit** converts them, keeping every part byte for byte and their pictures and media as document assets. Downloads export a real `.pptx` (or `.potx`, `.ppsx`, `.pptm`, … after the file's extension).
- **Web and desktop.** The editor (`apps/web/src/features/files/live/presentation`) is the registry entry's lazy `Editor`. `.ppsx` decks open in the slide show. The desktop app wraps the web app, so it gets the same editor.
- **Mobile.** `apps/mobile/editor/presentation/` is a web view page: the shared view core on a replica of the document, a slide that fills the width, and a strip of thumbnails below it that scrolls sideways. Images come from the app, because the page has no network. A native bar above the keyboard holds undo, redo, new slide, text box, shape, bold, italic, bullets, delete, and present. Insert image, tables, and the format panel are web only for now.
- **Agents.** `pull` writes the deck as `.pptx`, and `cat` and `grep` read it as text (`toText`: each slide's text, tables, chart data, alt text, and notes). `push` merges the file through `applyFile`. In Suggest mode the push becomes a proposal that people review.
- **Review.** The web review dialog shows `PresentationDiffView`. On mobile, the review sheet loads the same page in review mode (`presentationDiff` in the bridge protocol), which draws changed slides with before and after thumbnails. If a version cannot be fetched or read, it falls back to the text diff.

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
- **Identifiers are assigned on export.** New slides get the next free `p:sldId` and part name; new shapes the next free `cNvPr/@id` on their slide. Clones receive random file ids during cloning so references can be remapped before insertion. Duplicates that concurrent edits can create are repaired the same way. Assignment is deterministic, so `applyFile` can predict which file ids belong to which document keys.
- **Garbage collection happens on export.** Parts that only a deleted slide used, such as its chart or its notes, are left out of the file. They stay in the document, and so does a part a pushed file no longer has, because undo, a collaborator's in-flight copy, or an earlier clipboard may still use them. Parts that were already unreachable in the imported file are kept.
- **Parts are written outside undo.** Image parts and parts brought by a paste are written under their own origin, which no undo manager tracks. Undoing an insert therefore never deletes a part that another shape uses. Pasted parts get a random suffix, so two people pasting from different decks never overwrite each other's images. Every part with a content type that its extension's Default does not give gets an Override.
- **One owner per chart.** When two slides use one chart, diagram, or embedded object, for example after duplicating a slide, export gives each later slide a copy, as PowerPoint does.
- **No dangling references.** Links to deleted slides keep their action with an empty relationship id, as PowerPoint leaves them. This also applies to links in speaker notes and to links in slides pasted from another deck. Custom shows drop deleted slides. Animations, build entries, and connector glue that name deleted shapes are removed, and so are a slide's timing and build list once they are empty. The part name of a deleted slide is never given to a new slide. Cloning shapes or slides allocates ids for the complete cloned set and remaps connector endpoints and every `spid` reference, including animation targets and preserved AlternateContent. An endpoint outside the copied set keeps its target only when pasted on the source slide; elsewhere it is removed. Comments are not duplicated. New shape ids skip ids used inside kept equations and ink.
- **Text is valid XML.** Vertical tabs (PowerPoint's soft line breaks) are written as `a:br`; characters XML cannot hold are dropped.

Saving a `.pptm` as `.pptx` drops the VBA project and its content type, because macro-free formats cannot hold it. Macros are never run.

### Collaborative layout

Everything lives under the root map `presentation` (`ydoc.ts`):

| Key | Type | Holds |
| --- | --- | --- |
| `version`, `mainPart`, `slideWidth`, `slideHeight`, `notesWidth`, `notesHeight` | scalars | Deck settings (EMU) |
| `documentId` | string | A random id shared by every replica, so a paste can tell whether it came from this deck |
| `parts` / `partBytes` | `Y.Map<path, {asset?, contentType, orphan}>` / `Y.Map<path, Uint8Array>` | Raw parts. Bytes are kept apart, because Yjs freezes plain values deeply and cannot freeze typed arrays inside them |
| `slideOrder` / `slides` | `Y.Array<key>` / `Y.Map<key, Y.Map>` | Slide order and slides |
| `sectionOrder` / `sections` | `Y.Array<key>` / `Y.Map<key, {name, id}>` | Sections; slides name their section |

A slide map holds scalars (`layout`, `hidden`, `section`, `background`, `rels`, the template `xml`, the original `source`), `shapeOrder`/`shapes` (z-order and shapes, flat, groups list their members' keys in `children`), and `notes` (a map with the notes text). A shape map holds each modeled property under its own key: `xfrm` (a nested map: `x`, `y`, `cx`, `cy`, `rot`, `flipH`, `flipV`, child extents), `geom`, `fill`, `line`, `effects`, `blipFill`, `bodyPr` (XML strings), `name`, `descr`, `hidden`, `text` (a `Y.XmlFragment`), and `table`. A table map holds `columnOrder`/`columns` and `rowOrder`/`rows`; rows hold cells keyed by column key, each with its text fragment.

Why this shape:

- **Order arrays of keys beside maps of content.** Moving a slide, reordering shapes, or inserting a table row is a small edit to an array of keys; the content's map is untouched, so someone else's edits to the moved item are never lost. Reorders move only the keys that changed place. Concurrent moves and groupings can list a key twice. Readers keep the first listing, depth first. Grouping, ungrouping, and deleting use that same resolution, and slide indexes count visible slides.
- **Merged cells are normalized when read**: an anchor spans only cells marked as merged into it, and merged cells that nothing covers become plain cells. Inserting a row or column inside a merge extends it. Deleting a merge's first row or column hands its content to the next covered cell.
- **One key per property.** Two people moving and recoloring the same shape, or one resizing while another rotates, merge. Same-property conflicts resolve last-writer-wins, as in Google Slides.
- **Text is a ProseMirror document per text body**, bound with y-prosemirror, so typing in the same shape merges character by character. Paragraph properties are one raw `a:pPr` per paragraph (rarely contended). Run properties are split into one mark per property (`b`, `i`, `u`, `strike`, `sz`, `font`, `fill`, `highlight`, `baseline`, `cap`, `spc`, `link`) plus a mark holding the rest of `a:rPr`, so one person bolding a range while another colors it keeps both. Fields (slide number, date), line breaks, and unknown inline content (equations) are inline nodes; unknown ones are kept verbatim.
- **Cells keyed by column key**, so inserting a column while someone types in a cell keeps both.
- **New identifiers are random keys**; file ids are assigned on export, except cloned shapes receive random file ids immediately so references can follow them and independent replicas can duplicate without choosing the same next id.

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

- `PresentationController` owns per-slide caches, selection, presence (awareness field `presentation`: slide, selected shapes, shape being edited), per-user undo (`Y.UndoManager` tracking only this user's origins; a drag is one step), image URLs, and the command API toolbars and menus call:
  - insert (text boxes, shapes, lines with arrowheads, pictures at their aspect ratio and optionally centered on a point, tables), slides, sections, layouts, Reset slide, background, and the system clipboard (`copyToClipboard`, `cutToClipboard`, `pasteFromClipboard`);
  - arrange: order, group, align and distribute to each other or to the slide, flip, rotate by 90°, change shape, and outlines (`editLine` with `lineEdits`: width, color, dash, arrowheads, changing only what an edit names);
  - tables: insert rows above or below and columns left or right of the cell being edited (after a merged cell's span), delete its rows or columns (all of them deletes the table), each one undo step;
  - text: marks, paragraphs, typed and stepped font sizes (each run steps along PowerPoint's ladder from its own size), highlight, superscript and subscript, Clear Formatting (links stay), links (`setLink`; `normalizeLink` completes `example.com` and refuses schemes other than http, https, and mailto), slide number and date fields, symbols, and text box options (anchor, autofit, margins, wrap) through `bodyEdits`;
  - find and replace (`find.ts`): slides in order, their shapes in drawing order with group members and table cells, then their notes, with match case and whole words. Replacing edits the text at the match with the formatting where it starts, so other typing merges; replace all is one undo step, and a match that changed since the search is refused. `revealMatch` goes to the slide and selects the match in the slide's or notes' editor, highlighted while focus stays in the host's find bar; a match inside a group selects the group. `SlideCanvas.focus()` (closing the find bar) returns to that text with the match selected, and keys that reach the slide while its text is open go to the text, never to the shape.
  - `formatState()` reports explicit and inherited formatting (alignment, the font in use, size), baseline, highlight, link, whether the notes are the target, and text box properties.
  - `onRequest` tells the host to open UI the view core does not draw: Mod+F (find), Ctrl+H or Cmd+Shift+H (replace), Mod+K on text (link). While nothing listens, those keys keep their browser meaning.
- `SlideCanvas`: select, shift-click and marquee multi-select, move with smart guides to the slide's edges and center and other shapes, resize (Shift keeps the aspect ratio; pictures keep it from corners), rotate (Shift snaps to 15°), arrow-key nudge, Delete, Cmd/Ctrl+D (the slide when nothing is selected), G, Shift+G, A, Z, Y, copy, cut, paste (shapes, and images at their aspect ratio), image files dropped on the slide (centered where they land, kept from the chat composer's window drop), collaborators' selections with names, pinch, Ctrl-wheel, and Mod+Alt+= / - / 0 zoom (`onZoomChange`, `zoomIn`, `zoomOut`, `setZoom('fit')`), Page Up/Down and Home/End between slides, Ctrl+M for a new slide, and clicking links (http, https, mailto only) and media.
  - Text editing starts where the user points: a double click selects the word under the pointer, a click on an already selected text box, placeholder, shape with text, or table cell puts the caret there (as in Google Slides; a selected empty shape stays selected so it can be dragged), a press beside the text in the open editor moves the caret, and double-tap places it on touch. Typing replaces a selected shape's text.
  - Formatting shortcuts with shapes selected change all their text: Mod+B/I/U, Mod+Shift+L/E/R/J (alignment, as in Google Slides, since Ctrl+L/E/R/J are browser shortcuts), Mod+Shift+> and <, Mod+Shift+7 and 8 (numbered and bulleted lists), Mod+Backslash (clear formatting). Selected groups format their members' text.
  - Right-click calls `onContextMenu(event, shapeKey, cell)` with the table cell under the pointer; inside text being edited the browser's own menu, with spelling suggestions, shows instead. Tab in a table's last cell adds a row, and the cell editor follows its cell when rows or columns move around it.
- `InlineTextEditor`: ProseMirror over the shape's text fragment, styled by the renderer's own functions so editing looks like the slide. Enter, Shift+Enter (line break), Tab and Shift+Tab (list level), Cmd/Ctrl+B/I/U, the canvas's text shortcuts, Cmd/Ctrl+click on links, collaborators' carets. Autofit runs while typing: "shrink text on overflow" lowers the font scale in 10% steps and "resize shape to fit text" grows the shape, both written to the model.
- `SlideList`: the thumbnail strip and the slide sorter (lazy thumbnails, sections with `data-section` headers and `onSectionContextMenu`, hidden slides, collaborators' positions, multi-select and Cmd/Ctrl+A, drag to reorder, keyboard including Home, End, and Ctrl+M).
- `NotesEditor`: speaker notes. Every slide (and every shape that can hold text) has its text fragment from the start, so two people who start typing notes at once both keep their text; a notes page is written only when there are notes. While the notes have focus they are where text formatting goes (shortcuts and the toolbar), until the slide selection changes or the slide gets focus; focusing them closes the text being edited on the slide, as in PowerPoint.
- `Presenter`: full screen, keyboard (arrows, space, Page Up/Down, Home, End, number + Enter, Esc), click, tap, and swipe; hidden slides are skipped; slides with a transition fade in. The presenter view adds the next slide, notes, a timer, and the count. `.ppsx` decks open in the show.
- `await printSlides(controller)`: one slide per page at the slide's size, for Save as PDF. It loads images for all printable slides before generating pages and waits for image decoding and fonts. Preparation rejects on a load/decoding failure or after 30 seconds; the web editor shows an error and allows retrying. The mounted editor's `print()` also returns a promise.

The web wrapper (`apps/web/src/features/files/live/presentation`) arranges these with the app's toolbar buttons, menus, popovers, and `ui()` strings: insert (slide from a layout, text box, shape gallery, image, table), text formatting (font, size, bold, italic, underline, strike, color, alignment, bullets, numbering, list level, line spacing), shape fill, arrange, slide (layout, duplicate, hide, delete), sorter, format panel (size, position, rotation, fill, line, dash, shadow, slide background), export to PDF, and present.

Applying a layout adds the empty placeholders it has and the slide lacks ("Click to add title"), under keys derived from the layout and placeholder, so two people applying the same layout at once get one copy of each. Reset slide (`resetSlide`) puts the layout's placeholders back at its position and look, keeps their text, and restores missing ones.

The web wrapper presents from the current slide with Cmd/Ctrl+Enter and from the beginning with Cmd/Ctrl+Shift+Enter (Google Slides, PowerPoint for Mac), and keeps F5 and Shift+F5 (PowerPoint for Windows).

Table frame resizing scales column widths and row heights proportionally in the same undoable transaction. Ungrouping a scaled table preserves its grid size. Group child coordinates stay in their original space while the parent transform scales them.

Read-only access blocks controller commands, undo/redo, keyboard editing, and local text transactions while still accepting remote updates. Pending image insertion and paste operations recheck access before changing the document; active drags stop when access changes or the selected slide changes.

### Review diffs

`diffDocuments`, `diffDocumentWithFile`, and `diffFiles` compare two versions: slides added, removed, moved, and edited; per slide, layout, visibility, background, notes, and transition changes; per shape, added, removed, text (with before and after), formatting, moved, resized, rotated, fill, line, geometry, picture, and table changes; and deck-wide theme, master, media, and size changes. `PresentationDiffView` shows them with before and after thumbnails and line diffs of text. The web review dialog uses it for agent proposals (`PresentationFileDiff`). On mobile, the presentation page's review mode (`apps/mobile/editor/presentation/diff.ts`) draws the same rows. After the specific comparisons, a canonical comparison covers every modeled shape property and preserved XML, notes, backgrounds, layout/master references, and the complete referenced-part graph including media hashes. An otherwise unexplained difference adds **Slide formatting changed**, so the affected slide stays visible in review. XML attribute/declaration order, comments, and indentation do not create changes. A seeded property test mutates preserved XML and attributes, verifies each mutation survives export, and requires a visible slide diff.

### Copy and paste between decks

The clipboard payload (`web application/x-pulpo-presentation+json`) carries the copied shapes or slides and every part they reach through relationships: images, charts and their workbooks, and SmartArt parts. Any page can write that type, so pastes are validated. Shapes and slides whose XML or numbers would make an invalid file are dropped, and text is accepted only on `p:sp`. Pasting into another deck brings the parts along under fresh names and maps slides to the layout with the same name. Pasting into the same deck reuses parts only while their contents and dependencies still match the copied version. Changed pictures, charts, workbooks, and relationship graphs are restored from the clipboard under fresh names, preserving both the copied content and later edits. Reuse is checked after asynchronous asset preparation, immediately before insertion. Shape and whole-slide copies use the same recursive relationship collector: every relationship-namespace attribute (including diagram ids, chart/OLE references, and AlternateContent branches) and each referenced part's relationships participates. Parts such as SmartArt data that reference slide-owned relationships carry those bindings in the clipboard; pasting allocates collision-free destination ids and rewrites the references without touching the source. Cached drawings and their own images travel with the graph. Shape payloads include their source slide identity so references cannot bind accidentally to matching ids on another slide. The canvas and the slide strip both copy and paste.

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

- Two people making the very first move or resize of the same inherited placeholder at the same moment can lose one of the two changes: the first edit copies the inherited transform into the shape, and the two copies resolve last writer wins.
- If one person deletes the first row and another the first column of the same merged table cell at the same moment, the merged cell's text can be lost: each deletion hands the text to a cell the other one removes.
- Group members are selected and edited through their group (ungroup to change one member); grouping is limited to shapes in the same container.
- Picture crop and adjust handles (the yellow ones) have no on-canvas handles yet; values from files are honored.
- Animations do not play in the slide show; transitions all play as a fade.
- Text layout uses the browser's line breaking and the fonts available; without Calibri, Carlito or system fallbacks change line breaks slightly.
- Charts do not draw error bars, trendlines, data tables, or leader lines; date axes are spaced evenly; 3-D charts are drawn flat.
- The Y.Doc keeps templates and each slide's original bytes beside the model, about 4× the uncompressed package for shape-heavy decks.
- A push that rewrites the text someone is typing in wins over that typing. When an agent replaces a text body (python-pptx's `shape.text = …`), the paragraphs it removes take any unsent typing in them along, as with any concurrent deletion of a paragraph in Yjs. Typing in other shapes, cells, slides, and in paragraphs the push keeps is merged.
- `applyFile` reconciles the document with the pushed file, not with the version the agent pulled. Edits other people made between the agent's pull and its push are overwritten where the agent's file differs. Concurrent edits that are still in flight merge. A three-way merge needs the pulled version.
- `applyFile` matches slides and shapes by their ids. Tools such as python-pptx give a new slide or shape the id of a deleted one. A shape is treated as the old one only when it keeps its kind and also its name, its text, or its position. A slide is treated as the old one only when one of its shapes continues, and, if its layout changed, keeps its name or text. So a new slide or shape that looks like the deleted one can still pick up edits meant for it.
- `applyFile` matches table rows and columns in stages:
  1. ids or exact cell texts that are unique on both sides, wherever they moved, so reordering keeps edits. The ids are PowerPoint's row and column ids (`a16:rowId`, `a16:colId`), which Pulpo gives every table, row, and column it creates;
  2. then, among the rest in order, the same id or text;
  3. then the most similar cell texts;
  4. then position.

  Rows or columns whose ids differ are never paired.
  
  Rows with identical text and no ids, such as the empty rows of a table python-pptx made, cannot be told apart, so a concurrent edit to one of them can land in another.
- Re-applying the document's own export right after a slide was deleted reports a change once, because the stored presentation part is updated. Applying it again changes nothing.
- Collaborators' carets show in on-canvas text, not in speaker notes. Their selections show on the canvas and in the strip.
- If two people apply the same layout at the same moment and one types into a new placeholder before their edits meet, that typing can be lost: both write the same placeholder, and one copy wins.
- Changing autofit outside editing does not resize or rescale the text until someone edits it, as with PowerPoint files; table columns and rows are resized with the frame, not by dragging their borders.

## Limits and hostile files

Every file is untrusted. Reading refuses (with a `LiveFormatError`) packages over 10,000 parts or 512 MiB expanded, zip entries whose compressed size dwarfs their declared size, XML nested deeper than 256 levels, more than 5,000 slides or 10,000 shapes on a slide, groups nested deeper than 64, and slide sizes over PowerPoint's 56 inches. External relationships are never fetched. Charts cap series and points, and custom geometry caps guides and path commands.

## Testing

- **Review regressions** (`review-regressions.test.ts`): one case for each finding of the second review. These include undo after a push, self-including SmartArt, slide keys in SVG ids, concurrent pastes from different decks, part-name reuse, empty timing, fonts with panose, hostile clipboard numbers, text on groups, concurrent group and z-order, ungrouping flipped groups, merged cells, notes links, ids of opaque shapes, shared image parts under undo, row matching, sections, visible indexes, python-pptx slide ids, caret sanitizing, WebP, charts on duplicated slides, hover links, cross-deck slide links, and editors on deleted shapes.
- **Regressions** (`regressions.test.ts`): cases from the first review, such as slide links after inserting slides, cleared table cells after a push, non-slide internal hyperlinks, animations on duplicated slides, dangling references, simultaneous first notes, Enter keeping paragraph properties, control characters, hostile clipboard payloads, and slide id limits.
- **Unit and round trip** (`packages/client-core`, `npm test`): every corpus deck exports byte-identical parts after an import through a second replica; edits through commands (text, shapes, images, tables, notes, grouping, layout changes, slide moves, sections) read back correctly; untouched slides stay byte-identical when another slide changes; macros are kept or dropped by format.
- **`applyFile`**: an agent-style edit merges with a concurrent user edit on another replica; re-applying the document's own export changes nothing; keys of slides and shapes the document created survive the round trip.
- **Concurrency**: three replicas make random edits (typing, moving, formatting, inserting, deleting, grouping, slide moves, table rows) with random partial syncs, converge to the same state, and export a valid deck with unique ids that exports identically again.
- **Hostile files**: zip bombs, deep nesting, entities, broken and cyclic references, path traversal, huge values, duplicates, truncated and non-zip files each fail with a typed error, or import and export cleanly, within seconds.
- **Performance**: a 300-slide deck imports in about 3 s and exports in about 2 s in Node; in the browser it opens in about 1.5 s and switches slides in about 25 ms, with only visible thumbnails drawn.
- **Fidelity** (opt-in, `PULPO_OFFICE_FIDELITY=1`): python-pptx reads every round-tripped deck the same as the original, LibreOffice opens it with every slide, edits made through commands read back in python-pptx, and a python-pptx edit merges through `applyFile`. `apps/web/tests/presentation-fidelity.browser.mjs` renders 66 slides from 16 decks and scores them against LibreOffice renderings: mean similarity 0.981 and structural similarity 0.990 at the time of writing.
- **Browser** (`npm run test:presentation-editor -w @pulpo/web`) covers:
  - select, move, resize, rotate, nudge, and undo;
  - marquee, group, align, and delete;
  - typing and formatting with two collaborators, with presence and per-user undo;
  - inserting text boxes, shapes, tables, and images, and typing in cells;
  - managing slides by dragging, and the clipboard, including from the strip;
  - the slide show and presenter view, read-only mode, and touch;
  - `.ppsx` decks, the corpus fixtures, and the review diff;
  - markup in a collaborator's slide key, cells under vertical merges, switching cells while editing and Tab;
  - Escape and the show shortcuts in text fields;
  - the caret at the click, double-click word selection, and a second click editing;
  - pasting and dropping images at their aspect ratio, with drops kept from the chat;
  - applying a layout's placeholders, Reset slide, and undoing both;
  - table rows and columns, Tab in the last cell, and the cell editor following its cell;
  - keyboard shortcuts (formatting selected shapes, Ctrl+M, Cmd+D, page keys, zoom, presenting, requests to the host);
  - formatting speaker notes, find in slides and notes without taking focus, and replace all;
  - arrowheads kept through format panel line edits, flips, and text anchoring;
  - performance budgets.
- **View commands** (`view/interaction-regressions.test.ts`, `view/text-commands.test.ts`, `view/canvas-events.test.ts`, `find.test.ts`): table rows and columns with merged cells and a second collaborator, picture placement, sections, text formatting round trips (python-pptx when fidelity is on), editor formatting, links and fields, notes formatting, arrange, outlines, text box options, context menus, shortcuts, zoom, and find and replace with concurrent typing.
- **Files, end to end** (`npm run test:presentation-files -w @pulpo/web`, against a real API and PostgreSQL):
  - **New presentation**, editing, two tabs collaborating, and reloading;
  - downloading and reading the bytes with python-pptx;
  - converting an upload with **Edit**, with a byte-identical export;
  - an agent push merging with an unsent edit from an offline tab;
  - reviewing and accepting an agent's suggestion.
- **Server** (`apps/server/src/files/agent/presentation.postgres.test.ts`, `PULPO_FILES_TESTS=true`): creating, converting, exporting, `cat`, a push merging with a concurrent edit, a suggestion merging with a later edit, and refusing bytes that are not a deck.
- **Mobile** (`presentationBridge.test.ts`): the page's bridge, which covers loading, edits both ways, asset requests, commands, and toolbar state.

The corpus and its sources are listed in `packages/client-core/fixtures/presentation/README.md`; the Python and LibreOffice tools in `packages/client-core/test-tools/presentation/README.md`.

The harness (`apps/web/tests/presentation-editor/index.html`, served by `npm run dev -w @pulpo/web`) loads a fixture (`?deck=generated/autoshapes.pptx`, or `?blank=1`) into two Y.Docs kept in sync in memory, with `split=1` (both collaborators side by side), `view=diff`, `theme=dark`, `lang=es`, `readonly=1`, and `big=300`.
