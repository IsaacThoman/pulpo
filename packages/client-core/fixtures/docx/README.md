# Word fixture corpus

These small fixtures exercise the Pulpo Word importer/exporter. All files are below
200,000 bytes. Treat third-party documents as untrusted input: inspect them with
isolated Python (`python -I`) and `zipfile`; never execute embedded content.

## Generated fixtures

Source: [`generate.py`](generate.py), using python-docx 1.2 and lxml, with explicit
WordprocessingML for features the library cannot author. These original Pulpo
fixtures and their generator use the repository's [Pulpo Noncommercial License](../../../../LICENSE.md).
Core dates, comment/revision dates, IDs, image pixels, ZIP metadata, and ZIP entry
order are fixed so repeated generation produces identical bytes.

```sh
/tmp/pulpo-docx-venv/bin/python -I packages/client-core/fixtures/docx/generate.py
```

| File | Coverage |
| --- | --- |
| `basic-formatting.docx` | Title, Heading 1–3, normal paragraphs; bold, italic, single/double/wavy/colored underlines, strike/double strike, super/subscript, small/all caps, highlight, RGB/theme accent1 color, sizes, Arial/Times New Roman/Courier New, character spacing; four alignments; left/right/first-line/hanging indents; before/after and single/1.5/double/exact/at-least line spacing; keep-with-next, page-break-before, borders/shading, left/center/right/decimal tab stops with dot leaders, and line/page/column breaks. |
| `lists.docx` | List Bullet/List Number; custom decimal, lower-letter, lower-Roman, legal multilevel numbering (levels 0–4); shared abstract numbering, start override 5 and a fresh numbering instance to restart; Symbol F0B7 and Wingdings F0A7 bullet levels; Heading 1/2 styles linked to an outline through style `numPr`. |
| `tables.docx` | 4×4 Table Grid; spans 2/3 and three-row vertical merge; shading, per-cell borders/margins, center/bottom vertical alignment; fixed dxa and percentage widths; exact/at-least row heights; banded built-in style and repeating header; nested table; omitted gridBefore/gridAfter cells; 40-row multipage table. |
| `sections-headers.docx` | Portrait Letter, landscape Letter with swapped dimensions, and A4 with distinct margins; next-page/continuous section breaks; complex PAGE/NUMPAGES fields in default header/footer; first-page and even-page stories/settings; lower-Roman page-number restart; two columns. A continuous section with a changed page size may be paginated onto a new page by layout engines. |
| `notes-fields.docx` | Footnotes/endnotes with separator/continuation separator notes, relationships/content types and note/reference styles; complex TOC with cached bookmarked hyperlinks; bookmarks; internal/external hyperlinks; complex REF/DATE and simple PAGE fields. |
| `review.docx` | Comment ranges/references, reply/resolved metadata in commentsExtended; inserted/deleted runs with fixed author/date; run/paragraph property changes; inserted paragraph mark; paired move-from/move-to ranges. |
| `objects.docx` | Pure-Python 64×48 gradient PNG, inline/anchored/cropped pictures, square wrapping and column/paragraph positioning; two-paragraph block control, inline plain-text and checkbox controls; OMML fraction/superscript/radical/sum; Wingdings F04A; DrawingML text box with VML AlternateContent fallback. |

## Apache POI fixtures

The files below are unmodified copies from Apache POI's `trunk` test data,
licensed under [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).
Copyright The Apache Software Foundation; see the upstream
[LICENSE](https://github.com/apache/poi/blob/trunk/LICENSE) and
[NOTICE](https://github.com/apache/poi/blob/trunk/NOTICE).
Their license remains Apache-2.0, separately from the original Pulpo fixtures.
Each source link gives the exact upstream repository path.

| Local file | Coverage verified in package XML | Exact upstream path |
| --- | --- | --- |
| `poi/ComplexNumberedLists.docx` | Complex multilevel numbering | [`test-data/document/ComplexNumberedLists.docx`](https://github.com/apache/poi/blob/trunk/test-data/document/ComplexNumberedLists.docx) |
| `poi/NumberingWOverrides.docx` | Numbering overrides | [`test-data/document/NumberingWOverrides.docx`](https://github.com/apache/poi/blob/trunk/test-data/document/NumberingWOverrides.docx) |
| `poi/delins.docx` | Insertions/deletions, hyperlinks, complex fields | [`test-data/document/delins.docx`](https://github.com/apache/poi/blob/trunk/test-data/document/delins.docx) |
| `poi/testComment.docx` | Comments and modern comment extension parts | [`test-data/document/testComment.docx`](https://github.com/apache/poi/blob/trunk/test-data/document/testComment.docx) |
| `poi/footnotes.docx` | Footnote reference and note parts | [`test-data/document/footnotes.docx`](https://github.com/apache/poi/blob/trunk/test-data/document/footnotes.docx) |
| `poi/endnotes.docx` | Endnote reference and note parts | [`test-data/document/endnotes.docx`](https://github.com/apache/poi/blob/trunk/test-data/document/endnotes.docx) |
| `poi/DiffFirstPageHeadFoot.docx` | Different first-page headers/footers | [`test-data/document/DiffFirstPageHeadFoot.docx`](https://github.com/apache/poi/blob/trunk/test-data/document/DiffFirstPageHeadFoot.docx) |
| `poi/PageSpecificHeadFoot.docx` | Page-specific headers/footers | [`test-data/document/PageSpecificHeadFoot.docx`](https://github.com/apache/poi/blob/trunk/test-data/document/PageSpecificHeadFoot.docx) |
| `poi/drawing.docx` | 12 tables, 15 DrawingML drawings, 5 VML pictures | [`test-data/document/drawing.docx`](https://github.com/apache/poi/blob/trunk/test-data/document/drawing.docx) |
| `poi/Bug54849.docx` | Two tables, headers/footers, footnotes/endnotes | [`test-data/document/Bug54849.docx`](https://github.com/apache/poi/blob/trunk/test-data/document/Bug54849.docx) |
| `poi/rtl.docx` | RTL document, hyperlinks, start/end paragraph alignment | [`test-data/document/rtl.docx`](https://github.com/apache/poi/blob/trunk/test-data/document/rtl.docx) |
| `poi/FieldCodes.docx` | Complex field codes | [`test-data/document/FieldCodes.docx`](https://github.com/apache/poi/blob/trunk/test-data/document/FieldCodes.docx) |

Fetch the larger external corpus with Node 22 (no dependencies):

```sh
node packages/client-core/scripts/fetch-docx-corpus.mjs /tmp/pulpo-docx-corpus/poi
PULPO_DOCX_CORPUS=/tmp/pulpo-docx-corpus/poi npm run test -w @pulpo/client-core -- src/office/docx/corpus.test.ts
```

The downloader lists GitHub's recursive tree and copies every `.docx`, `.docm`,
`.dotx`, and `.dotm` below `test-data/document/`, preserving relative subdirectories,
skipping existing files, and using eight workers. It never executes the files.

See [fidelity tooling](../../scripts/docx-fidelity/README.md) for semantic comparison
and LibreOffice/PDF validation. PDFs and page PNGs belong in `/tmp`, outside this corpus.
