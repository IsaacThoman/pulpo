# Sheets engine fixtures

Small, committed test inputs for the xlsx/csv engine (`src/office/sheets`). Every file is
listed below and in [`manifest.json`](manifest.json), which also carries an `expect` value
tests can iterate over:

| `expect` | Meaning |
|---|---|
| `open` | must load; round-trips should preserve everything (including unknown parts) |
| `refuse:strict` | Strict OOXML: refuse with a clear "strict OOXML not supported" error |
| `refuse:encrypted` | OLE2/CFB-wrapped encrypted package: refuse with a "password protected" error |
| `refuse:corrupt` | broken zip / hostile XML: refuse cleanly, never hang or expand entities |
| `open-or-refuse` | either outcome is fine, but no crash, hang or partial write |

Layout:

- `poi/`: real files from [Apache POI](https://github.com/apache/poi) `test-data/spreadsheet`
  (and one from `test-data/poifs`), pinned to commit `7f4d36854109efa17152b27a5fb1b2c7d842c314`.
  Almost all are Microsoft-Excel-authored (`docProps/app.xml`), so they carry Excel's cached
  values and serialisation quirks. **License: Apache-2.0.** POI's `legal/LICENSE` and
  `legal/NOTICE` are copied into `poi/LICENSE` and `poi/NOTICE` as the license requires.
  The POI LICENSE lists no separate terms for test-data, so it is covered by Apache-2.0.
- `generated/`: written by `scripts/sheets/generate_fixtures.py` (openpyxl, deterministic
  bytes). **openpyxl never computes formulas, so these files have no cached values.**
- `libreoffice/`: a few `generated/` files round-tripped through headless LibreOffice
  (`generate_fixtures.py --libreoffice`), so formula cells carry LibreOffice-calculated
  cached values. Use them as a formula oracle, with these caveats (seen with LibreOffice 26.8):
  - Cached numbers are rounded to **15 significant digits** (`PI()` → `3.14159265358979`,
    `2^53+1` → `9007199254740990`). Compare with a relative tolerance.
  - Some results differ from Excel, e.g. `SQRT(-1)` gives `#VALUE!` (Excel: `#NUM!`).
  - LibreOffice rewrites some things: boolean constants become `=TRUE()` formulas,
    undefined names are lowercased, and `1.7976931348623157e308` is written as
    `<v>INF</v>`, which makes `gen-values.lo.xlsx` unreadable by openpyxl.
- `csv/`: CSV/TSV edge cases from `generate_fixtures.py`, as exact bytes.
  `.gitattributes` turns off line-ending normalisation for this whole folder.

Large and opt-in inputs are not committed. Run `scripts/sheets/fetch-corpus.sh` to get them,
then set `PULPO_SHEETS_CORPUS=~/.cache/pulpo-sheets-corpus` (see `scripts/sheets/README.md`).

Regenerate with:

```sh
~/.cache/pulpo-sheets-venv/bin/python -I packages/client-core/scripts/sheets/generate_fixtures.py --libreoffice
```

`generated/` and `csv/` come out byte-identical when regenerated. `libreoffice/` doesn't
(LibreOffice stamps its own metadata).

## Files

### `poi/`

| File | Exercises | Expect | Source | License |
|---|---|---|---|---|
| `shared_formulas.xlsx` | shared formulas (t="shared" with ref/si) and cached values | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/shared_formulas.xlsx) | Apache-2.0 |
| `FormulaEvalTestData_Copy.xlsx` | POI's function test sheet: ~1300 formulas over ~200 functions with Excel cached values (incl. errors); also hyperlinks | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/FormulaEvalTestData_Copy.xlsx) | Apache-2.0 |
| `MatrixFormulaEvalTestData.xlsx` | array (CSE) formulas: MMULT, MINVERSE, TRANSPOSE, MDETERM, range arithmetic; merged cells | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/MatrixFormulaEvalTestData.xlsx) | Apache-2.0 |
| `55906-MultiSheetRefs.xlsx` | cross-sheet and 3D (Sheet1:Sheet3!A1) references | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/55906-MultiSheetRefs.xlsx) | Apache-2.0 |
| `xlookup.xlsx` | _xlfn.XLOOKUP/XMATCH, dynamic-array spill with xl/metadata.xml (Excel Online) | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/xlookup.xlsx) | Apache-2.0 |
| `StructuredReferences.xlsx` | table structured references (Table1[[#This Row],[col]]) | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/StructuredReferences.xlsx) | Apache-2.0 |
| `testNames.xlsm` | defined names: constants, array constant, ranges, an OFFSET() formula name; macro-enabled (vbaProject.bin) | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/testNames.xlsm) | Apache-2.0 |
| `styles.xlsx` | fonts, rich text runs in shared strings, theme fill with tint, named cell styles | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/styles.xlsx) | Apache-2.0 |
| `50784-font_theme_colours.xlsx` | font colours given as theme indexes | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/50784-font_theme_colours.xlsx) | Apache-2.0 |
| `50786-indexed_colours.xlsx` | legacy indexed colours | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/50786-indexed_colours.xlsx) | Apache-2.0 |
| `50846-border_colours.xlsx` | border colours (theme/indexed/rgb) | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/50846-border_colours.xlsx) | Apache-2.0 |
| `NumberFormatTests.xlsx` | date1904=1 workbook; ~300 number formats with Excel's TEXT() results cached; frozen panes | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/NumberFormatTests.xlsx) | Apache-2.0 |
| `WidthsAndHeights.xlsx` | column widths, row heights, hidden rows/columns (Excel Online) | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/WidthsAndHeights.xlsx) | Apache-2.0 |
| `GroupTest.xlsx` | row/column outline groups, collapsed levels | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/GroupTest.xlsx) | Apache-2.0 |
| `TwoSheetsOneHidden.xlsx` | hidden sheet | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/TwoSheetsOneHidden.xlsx) | Apache-2.0 |
| `SheetTabColors.xlsx` | sheet tab colours | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/SheetTabColors.xlsx) | Apache-2.0 |
| `right-to-left.xlsx` | right-to-left sheet view; threaded comments + persons part | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/right-to-left.xlsx) | Apache-2.0 |
| `unicodeSheetName.xlsx` | non-ASCII sheet names | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/unicodeSheetName.xlsx) | Apache-2.0 |
| `NewStyleConditionalFormattings.xlsx` | cellIs/expression/colorScale/dataBar/iconSet (all built-in sets) plus x14 extLst variants (custom icons, 3Stars, x14 data bar) | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/NewStyleConditionalFormattings.xlsx) | Apache-2.0 |
| `simple-monthly-budget.xlsx` | Excel template: x14 data bars in extLst, two tables, bar chart + picture in one drawing, customXml, tab colours, merges | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/simple-monthly-budget.xlsx) | Apache-2.0 |
| `conditional_formatting_multiple_ranges.xlsx` | one rule applying to a multi-range sqref | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/conditional_formatting_multiple_ranges.xlsx) | Apache-2.0 |
| `DataValidations-49244.xlsx` | list/whole/decimal/date/textLength validations with prompts and errors | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/DataValidations-49244.xlsx) | Apache-2.0 |
| `WithMoreVariousData.xlsx` | hyperlinks (URL, file, internal) and comments | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/WithMoreVariousData.xlsx) | Apache-2.0 |
| `sharedhyperlink.xlsx` | a <hyperlink> whose ref spans A3:A5 (openpyxl splits it per cell) | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/sharedhyperlink.xlsx) | Apache-2.0 |
| `SimpleWithComments.xlsx` | legacy comments (notes) with VML | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/SimpleWithComments.xlsx) | Apache-2.0 |
| `64759.xlsx` | threaded comments (xl/threadedComments + xl/persons) with legacy fallback note | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/64759.xlsx) | Apache-2.0 |
| `ExcelTables.xlsx` | a styled table with a defined name | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/ExcelTables.xlsx) | Apache-2.0 |
| `Excel_file_with_trash_item.xlsx` | autoFilter, hidden rows, customXml | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/Excel_file_with_trash_item.xlsx) | Apache-2.0 |
| `bug63189.xlsx` | embedded PNG picture | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/bug63189.xlsx) | Apache-2.0 |
| `WithDrawing.xlsx` | pictures (png/jpeg) plus emf/wmf media; openpyxl sees 2 images | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/WithDrawing.xlsx) | Apache-2.0 |
| `WithEmbeded.xlsx` | embedded OLE objects (xl/embeddings) with EMF previews - preserve only | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/WithEmbeded.xlsx) | Apache-2.0 |
| `WithThreeCharts.xlsx` | line, pie (exploded, titled) and bar charts on one sheet | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/WithThreeCharts.xlsx) | Apache-2.0 |
| `SimpleScatterChart.xlsx` | scatter chart plus a chartsheet | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/SimpleScatterChart.xlsx) | Apache-2.0 |
| `InlineStrings.xlsx` | t="inlineStr" cells, no shared strings | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/InlineStrings.xlsx) | Apache-2.0 |
| `SimpleMacro.xlsm` | macro-enabled workbook with vbaProject.bin (must be preserved, never executed) | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/SimpleMacro.xlsm) | Apache-2.0 |
| `test.xltx` | template content type (spreadsheetml.template.main+xml) | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/test.xltx) | Apache-2.0 |
| `sheetProtection_allLocked.xlsx` | sheet protection with all actions locked | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/sheetProtection_allLocked.xlsx) | Apache-2.0 |
| `workbookProtection-workbook_password-2013.xlsx` | workbook structure protection with SHA-512 password hash | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/workbookProtection-workbook_password-2013.xlsx) | Apache-2.0 |
| `RepeatingRowsCols.xlsx` | print titles (repeating rows/columns) as _xlnm.Print_Titles | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/RepeatingRowsCols.xlsx) | Apache-2.0 |
| `HeaderFooterComplexFormats.xlsx` | headers/footers with formatting codes | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/HeaderFooterComplexFormats.xlsx) | Apache-2.0 |
| `ExcelPivotTableSample.xlsx` | pivot table + pivot cache (preserve only) | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/ExcelPivotTableSample.xlsx) | Apache-2.0 |
| `ref-56737.xlsx` | external workbook link (xl/externalLinks) with cached values | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/ref-56737.xlsx) | Apache-2.0 |
| `sample.xlsx` | transitional twin of sample.strict.xlsx; rich text, formulas | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/sample.xlsx) | Apache-2.0 |
| `sample.strict.xlsx` | Strict OOXML (purl.oclc.org namespaces); openpyxl silently loads it as a workbook with ZERO sheets | refuse:strict | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/sample.strict.xlsx) | Apache-2.0 |
| `protected_passtika.xlsx` | password-encrypted OOXML: OLE2/CFB container with EncryptionInfo + EncryptedPackage streams | refuse:encrypted | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/protected_passtika.xlsx) | Apache-2.0 |
| `MalformedSSTCount.xlsx` | sharedStrings count/uniqueCount wrong (written by LibreOffice) | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/MalformedSSTCount.xlsx) | Apache-2.0 |
| `59746_NoRowNums.xlsx` | <row>/<c> elements without r= attributes (positional), outlines | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/59746_NoRowNums.xlsx) | Apache-2.0 |
| `invalid_cell_reference.xlsx` | cell with r="B" (no row); openpyxl refuses it, Excel repairs | open-or-refuse | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/invalid_cell_reference.xlsx) | Apache-2.0 |
| `clusterfuzz-testcase-minimized-XLSX2CSVFuzzer-5636439151607808.xlsx` | 372-byte truncated zip (fuzzer output) | refuse:corrupt | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/clusterfuzz-testcase-minimized-XLSX2CSVFuzzer-5636439151607808.xlsx) | Apache-2.0 |
| `poc-xmlbomb.xlsx` | billion-laughs entity expansion in sheet XML; must never be expanded | refuse:corrupt | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/poc-xmlbomb.xlsx) | Apache-2.0 |
| `xxe_in_schema.xlsx` | XML map whose schema references http://localhost; must never be fetched | open | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/xxe_in_schema.xlsx) | Apache-2.0 |
| `duplicate-filename.xlsx` | zip with two entries named xl/worksheets/sheet1.xml (Excel Online) | open-or-refuse | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/spreadsheet/duplicate-filename.xlsx) | Apache-2.0 |
| `protect-encrypted.xlsx` | password-encrypted OOXML (CFB container, standard encryption), from POI test-data/poifs/protect.xlsx (renamed) | refuse:encrypted | [POI](https://github.com/apache/poi/blob/7f4d36854109efa17152b27a5fb1b2c7d842c314/test-data/poifs/protect.xlsx) | Apache-2.0 |

### `generated/`

| File | Exercises | Expect | Source | License |
|---|---|---|---|---|
| `gen-formulas.xlsx` | ~170 formulas over ~150 functions/operators by group (math, operators, stats, logical, text, lookup, date, info, financial, refs, errors), CSE arrays, global/local/constant/formula defined names, 3D refs, a Volatile sheet. NO cached values | open | generated | project |
| `gen-values.xlsx` | every value type: ints/floats/edge doubles, -0, empty string, whitespace, newlines, unicode, _xHHHH_ escapes, booleans, dates/times, error literals, 32767-char text, rich text; 'Sparse' sheet with XFD1 and A1048576 | open | generated | project |
| `gen-1904.xlsx` | date1904 workbook with dates, datetime and formulas over them | open | generated | project |
| `gen-styles.xlsx` | fonts (underline kinds, strike, super/subscript, theme/tint/indexed colours), all 18 pattern fills + gradients, all 13 border styles + diagonal, every alignment, ~30 number formats (locale, conditional sections, elapsed time), protection, named + builtin styles | open | generated | project |
| `gen-conditional-formatting.xlsx` | every cellIs operator, expression (+stopIfTrue), 2/3-colour scales, data bars, icon sets (reverse, showValue=0), top/bottom N/%, above/below average, stdDev, duplicate/unique, text rules, blanks/errors, timePeriod, multi-range sqref, overlapping priorities | open | generated | project |
| `gen-data-validation.xlsx` | list (inline, range, defined name, hidden arrow), whole/decimal/date/time/textLength/custom, prompts, all three error styles, multi-range sqref | open | generated | project |
| `gen-layout.xlsx` | merged cells, freeze panes, widths/heights (incl. tiny), hidden rows/cols, 2-level outlines, summaryBelow=0, zoom, tab colours, print setup (A4 landscape fit-to-width, margins, header/footer codes, print titles, print area), hidden + veryHidden sheets, password-protected sheet, right-to-left sheet, custom default row height/col width | open | generated | project |
| `gen-tables.xlsx` | table with totals row, calculated column and structured-reference formulas (#This Row, #Headers, #Data, #Totals); second table; autoFilter with value filter + sort state + hidden filtered rows | open | generated | project |
| `gen-links-comments.xlsx` | URL, mailto, internal location (quoted sheet), relative file links, HYPERLINK(); comments (multi-line, sized, unicode, two sheets) | open | generated | project |
| `gen-image.xlsx` | three PNGs: string anchor, twoCellAnchor (editAs=oneCell, offsets), oneCellAnchor with ext | open | generated | project |
| `gen-charts.xlsx` | column, stacked bar, line (markers/smooth), 100% area, pie, doughnut, scatter, bar+line combo on a secondary axis, and a chartsheet | open | generated | project |
| `gen-multisheet.xlsx` | 8 sheets with awkward names (spaces, apostrophe, unicode, numeric, hyphen), tab colours, hidden sheet, quoted cross-sheet + 3D refs, global/local (same name on two sheets)/hidden defined names, active sheet != first, workbook structure lock | open | generated | project |
| `gen-template.xltx` | openpyxl template (template content type) | open | generated | project |

### `libreoffice/`

| File | Exercises | Expect | Source | License |
|---|---|---|---|---|
| `gen-formulas.lo.xlsx` | LibreOffice-calculated cached values for gen-formulas.xlsx (formula oracle) | open | LibreOffice round-trip | project |
| `gen-values.lo.xlsx` | LibreOffice export of gen-values.xlsx; NOTE LibreOffice wrote 1.7976931348623157e308 as <v>INF</v> (openpyxl cannot load it) and rounds numbers to 15 significant digits | open-or-refuse | LibreOffice round-trip | project |
| `gen-1904.lo.xlsx` | LibreOffice export of gen-1904.xlsx (1904 date system kept) | open | LibreOffice round-trip | project |
| `gen-tables.lo.xlsx` | LibreOffice export of gen-tables.xlsx with structured-reference results | open | LibreOffice round-trip | project |
| `gen-conditional-formatting.lo.xlsx` | LibreOffice export of gen-conditional-formatting.xlsx (LibreOffice writes x14 extLst CF) | open | LibreOffice round-trip | project |

### `csv/`

| File | Exercises | Expect | Source | License |
|---|---|---|---|---|
| `utf8-lf.csv` | UTF-8, no BOM, LF; accents, CJK, astral-plane emoji | open | generated | project |
| `utf8-bom-crlf.csv` | UTF-8 with BOM, CRLF | open | generated | project |
| `utf8-cr.csv` | UTF-8, classic-Mac CR-only line endings | open | generated | project |
| `utf8-no-trailing-newline.csv` | last record not newline-terminated | open | generated | project |
| `utf16le-bom.csv` | UTF-16LE with BOM, comma-delimited, CRLF | open | generated | project |
| `utf16le-bom-excel-unicode-text.txt` | UTF-16LE with BOM, TAB-delimited (Excel 'Unicode Text' export shape) | open | generated | project |
| `tab-delimited.tsv` | UTF-8 TSV | open | generated | project |
| `quoted-fields.csv` | quoted fields with embedded commas, doubled quotes, LF and CRLF inside quotes, padded spaces, quoted vs unquoted empty, and one malformed field (text after closing quote) | open | generated | project |
| `ragged-rows.csv` | rows with 1-5 fields, blank line | open | generated | project |
| `trailing-empty-fields.csv` | trailing empty fields and trailing blank lines | open | generated | project |
| `semicolon-european.csv` | semicolon delimiter, decimal comma, dd.mm.yyyy dates, quoted field containing ';', thousands '.' | open | generated | project |
| `windows-1252.csv` | Windows-1252 bytes (é ï ö á, € = 0x80, curly quotes) - invalid as UTF-8 | open | generated | project |
| `header-only.csv` | header row only | open | generated | project |
| `empty.csv` | 0 bytes | open | generated | project |
| `long-field.csv` | one 40,000-char field (beyond Excel's 32,767-char cell limit) | open | generated | project |
| `type-inference-and-injection.csv` | leading zeros, 20-digit ints, scientific, %, currency, -0, booleans, ambiguous dates, times, #N/A, and CSV-injection payloads (=, +, -, @) that must stay text | open | generated | project |

## CSV notes

Expected parse results, assuming the engine sniffs encoding and delimiter the way Excel or
Google Sheets would:

- `utf8-lf.csv`, `utf8-bom-crlf.csv`, `utf8-cr.csv`, `utf8-no-trailing-newline.csv`,
  `utf16le-bom.csv`: all decode to the same 5×6 grid. The BOM is not part of `id`.
- `utf16le-bom-excel-unicode-text.txt` and `tab-delimited.tsv`: the same grid, tab-delimited.
- `quoted-fields.csv`: field 2 of each row is `a,b,c`, `she said "hi"`, `""`, a value with an
  embedded LF, one with an embedded CRLF, and `  spaces  `. The last row has text after a
  closing quote; RFC 4180 calls that malformed, and most parsers keep `quoted, thenx`.
- `ragged-rows.csv`: the grid width is the longest row (5). The blank line is an empty row.
- `semicolon-european.csv`: 4 columns. `1,50` is the number 1.5 only under a decimal-comma
  locale. `"Wein; rot"` is a single field.
- `windows-1252.csv`: invalid UTF-8. Decode as Windows-1252 to get `€4.50`, `Montréal`, `“quoted”`.
- `header-only.csv`: one row. `empty.csv`: zero rows, which must not be an error.
- `long-field.csv`: a 40,000-character field; Excel truncates cells at 32,767 characters.
- `type-inference-and-injection.csv`: values that should stay text (leading zeros,
  20-digit ids) and formula-injection payloads (`=`, `+`, `-`, `@`) that must never be
  evaluated as formulas.
