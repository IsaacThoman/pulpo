# Sheets fidelity tooling

Python and LibreOffice tools for testing the in-house xlsx/csv engine against independent
readers. Every tool prints JSON to stdout so tests can call it through `child_process`. The
TypeScript wrappers are in `src/office/sheets/testing/fidelity.ts` (test-only; runtime code
must not import them). Fixtures live in `../../test-fixtures/sheets/` (see its README).

## Setup

```sh
packages/client-core/scripts/sheets/setup-fidelity-env.sh     # venv at ~/.cache/pulpo-sheets-venv (idempotent, no sudo)
packages/client-core/scripts/sheets/fetch-corpus.sh           # optional: ~27 MB corpus at ~/.cache/pulpo-sheets-corpus
PULPO_SHEETS_FIDELITY=1 npx vitest run packages/client-core/src/office/sheets/fidelity-tools.test.ts
```

- The venv has pinned `openpyxl` (3.1.5) plus Pillow. Without Pillow, openpyxl silently drops
  images on load. Override the location with `PULPO_SHEETS_VENV`.
- LibreOffice is looked up at `/Applications/LibreOffice.app/Contents/MacOS/soffice`, then
  `soffice` on `PATH`. Override with `PULPO_SOFFICE`. PNG rendering uses `pdftoppm` (poppler) and
  falls back to `sips`, which renders the first page only.
- Opt-in corpus tests read `PULPO_SHEETS_CORPUS=~/.cache/pulpo-sheets-corpus`. It holds `poi/`
  (all 367 POI xlsx/xlsm/xltx files, pinned commit), `poi-encrypted/` (4 encrypted CFB files),
  `generated/gen-large-50k.{xlsx,csv}`, and `manifest.json` with sha256 for every file.

**Corpus files are untrusted.** They're only written into the cache, never executed or opened
with macros, and only parsed by Python running in isolated mode (`-I`). XML parsing in the tools
refuses DTDs. Each script puts its own directory on `sys.path` explicitly and doesn't write
`__pycache__`.

Run each Python tool as `~/.cache/pulpo-sheets-venv/bin/python -I <script> ...`.

## Tools

| Tool | What it does | Exit codes |
|---|---|---|
| `inspect_xlsx.py FILE [--values] [--no-styles] [--no-package] [--sheet S]... [--max-cells N]` | Canonical JSON dump of what openpyxl reads (details below) | 0 ok, 2 couldn't load (`{"error": ...}`) |
| `compare_xlsx.py A B [--ignore P,...] [--values] [--no-styles] [--format json\|text] [--max N]` | Diffs two inspect dumps. A and B can be workbooks or saved `.json` dumps | 0 equal, 1 different, 2 error |
| `xml_parts_diff.py A B [--max-diffs N] [--ignore-part GLOB]...` | Part-by-part zip comparison: `added`/`removed`/`identical`, `equivalent` (only attribute order, whitespace, namespace prefixes, XML declaration, or child order in `[Content_Types].xml`/`.rels` differ), `different` (element paths such as `/worksheet/sheetData[1]/row[1]/c[1]/v[1]/text()`), and `binary` | 0 nothing different, 1 different, 2 bad zip |
| `cached_values.py FILE [--sheet S]... [--only-cached]` | Formula oracle: every formula cell with its formula, array ref, and cached value (`null` if none was stored) | 0, 2 |
| `edit_with_openpyxl.py IN OUT OPS` | Applies agent-style edits with openpyxl and saves. `OPS` is a JSON array, `@file.json`, or `-`. `[]` is a plain load/save round-trip. Ops are listed in the script docstring: `set`, `set_range`, `insert_rows`/`delete_rows`/`insert_cols`/`delete_cols`, `add_sheet`, `delete_sheet`, `rename_sheet`, `copy_sheet`, `style`, `merge`/`unmerge`, `column_width`, `row_height`, `freeze`, `comment`, `hyperlink`, `define_name`, `sheet_state` | 0, 2 |
| `lo_convert.sh IN OUTDIR FORMAT` | Headless LibreOffice conversion. FORMAT is `pdf`, `png` (first page), `xlsx`, `csv` (every sheet as UTF-8 `<stem>-<Sheet>.csv`), `ods`, `html`, or a raw `--convert-to` spec. Each run gets a private `-env:UserInstallation=file:///tmp/lo-sheets-XXXX` profile plus `--headless --norestore` and a watchdog timeout (`LO_TIMEOUT`, default 120 s), so it's safe next to other LibreOffice users | 0, 1 failed, 124 timeout |
| `lo_render_png.sh XLSX OUTDIR` | Renders every printed page to `<stem>-page-N.png` through PDF (`LO_PNG_DPI`, default 96) | as above |
| `generate_fixtures.py [--libreoffice] [--large] [--large-only]` | Regenerates `test-fixtures/sheets/{generated,csv}`. `--libreoffice` also refreshes `libreoffice/*.lo.xlsx`, and `--large` writes the 50k-row files into the cache | 0 |
| `fetch-corpus.sh [--force]` | Downloads the opt-in corpus (`POI_REF` overrides the pinned commit) | 0 |

### `inspect_xlsx.py` output

- **workbook**: sheet order, kind (worksheet or chartsheet), state, and tab colour; the active
  sheet; `date1904`; defined names (value, scope, hidden); raw `<calcPr>` attributes; workbook
  protection; external-link count; named styles.
- **sheets.<name>**:
  - `cells`: coordinate → `{t, v | f, array, rich, numFmt, font, fill, border, alignment, protection, style}`.
    Values from date-formatted numbers are kept as the stored serial with `t: "d"`, so 2/3 stays
    `0.6666666666666666` and isn't rounded through a datetime.
  - `merged`, `view` (freeze, zoom, gridlines, RTL), `columns` (coalesced runs such as `"B:D"`), `rows`
  - `conditionalFormatting` (type, ranges, formula, priority, dxf summary, colour scale, data bar, icon set)
  - `dataValidations`, `hyperlinks`, `comments`, `tables`, `autoFilter`
  - `drawings` (images and charts with anchors, chart types and series count)
  - `print` (setup, margins, header/footer, print area and titles), `protection`
  - `x14`: extLst conditional formats, data validations, and sparklines, read from raw XML because
    openpyxl drops them
- **package**: every part with its content type, plus `features` (VBA, threaded comments,
  pivots, external links, slicers, customXml, metadata, calcChain, embeddings, extLst URIs).
- **warnings**: openpyxl warnings, which name what it dropped or couldn't read.

Normalisation, so that two dumps diff meaningfully:

- Keys are sorted.
- Colours are written as `#RRGGBB`, `theme:N/tint:T`, `indexed:N`, or `auto`. Alpha is dropped.
- Integral floats become ints.
- Defaults are omitted (no font bold `false`, alignment `general`, and so on).
- Merged-cell placeholders are skipped.

Useful ignores for round-trip comparisons are `package`, `warnings`, `calc`, `style` (named
style names), and `sheets/*/print/margins`.

## Known reader quirks (what the tools will and won't tell you)

- **openpyxl doesn't compute formulas.** `generated/*.xlsx` have no cached values. Use the
  `libreoffice/*.lo.xlsx` twins or POI's Excel files as the oracle.
- **openpyxl loads Strict OOXML silently as a workbook with zero sheets.** `inspect_xlsx.py`
  detects the purl.oclc.org namespaces and reports `error.type = "StrictOoxml"` instead.
- **openpyxl drops** x14 extLst (data bars, custom icon sets, x14 validations), threaded comments
  (only the legacy "[Threaded comment]" note remains), shapes, text boxes, slicers, sparklines,
  OLE objects, and pictures it can't anchor. It also splits range hyperlinks per cell and invents
  `<calcPr fullCalcOnLoad="1">` (the dump reads the raw attributes instead). An
  `edit_with_openpyxl.py IN OUT '[]'` round-trip shows exactly that loss.
- **LibreOffice's cached values** are rounded to 15 significant digits, and a few functions
  differ from Excel (`SQRT(-1)` gives `#VALUE!`, not `#NUM!`). LibreOffice also writes the
  largest double as `<v>INF</v>`.
- In the full POI corpus (367 files), openpyxl refuses 28: 15 aren't valid zips (fuzzer
  output and truncations), 3 are CFB containers (encrypted, or legacy data with an .xlsx name),
  4 have DTD/entity bombs (expat's amplification limit stops them), and 6 have broken
  styles, workbook parts, or cell refs. It also "opens" the 4 strict files with zero sheets,
  so `inspect_xlsx.py` returns errors for 32 files in total.
