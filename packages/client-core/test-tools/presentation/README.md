# Presentation fidelity tools

Python and shell tools that give the .pptx engine an independent reference: what
python-pptx reads from a file, how two packages differ part by part, and how
LibreOffice renders it. The fixture corpus they run against is described in
[`../../fixtures/presentation/README.md`](../../fixtures/presentation/README.md).

None of this is needed for the normal test run. Vitest suites call these tools
only when `PULPO_OFFICE_FIDELITY=1` is set.

## Setup

```sh
python3 -m venv /tmp/pulpo-pptx-venv
/tmp/pulpo-pptx-venv/bin/pip install python-pptx lxml Pillow   # + msoffcrypto-tool for generate_hostile.py
brew install poppler            # pdftoppm, pdfinfo (render_reference.sh, lo_open_check.sh)
brew install --cask libreoffice # or any soffice on PATH
```

| Variable | Default | Used by |
| --- | --- | --- |
| `PULPO_OFFICE_FIDELITY` | unset | Vitest: set to `1` to run fidelity suites |
| `PULPO_PPTX_PYTHON` | `/tmp/pulpo-pptx-venv/bin/python` | Shell scripts, `check_fixtures.py`, vitest |
| `PULPO_SOFFICE` | `soffice` on `PATH`, then `/opt/homebrew/bin/soffice` | `lo_tools.py` |
| `PULPO_LO_PROFILE` | `/tmp/pulpo-pptx-lo-profile` | `lo_tools.py`: private LibreOffice profile, so a running LibreOffice (or another engineer's) is never reused |
| `PULPO_LO_TIMEOUT` | `180` (seconds) | `lo_tools.py convert` |

Run Python on downloaded or hostile files with `python -I` (isolated mode), as the
scripts below do.

## Tools

### `pptx_inspect.py <file> [--out snap.json] [--compact] [--no-notes]`

Prints a JSON snapshot of everything python-pptx can read:

- package: main content type, part count, VBA present, media and SmartArt part names
- `slide_size`, core properties, masters with layout names, sections
- per slide, in order: slide id, part name, layout name, `hidden`, transition (kind,
  speed, auto-advance), animation target shape ids, background fill, legacy and
  modern comments, notes text
- per shape: id, name, type, left/top/width/height (EMU), rotation, flipH/flipV,
  placeholder type/idx, auto shape type, custom geometry, adjustments, fill (solid
  RGB/theme + brightness, gradient angle/stops/path, pattern + colors, picture,
  background), line (width, dash, color, head/tail ends), connector glue, click
  hyperlink, graphic frame URI, group children (recursively)
- text frames: body properties (vert, wrap, anchor, insets, columns, autofit with
  fontScale/lnSpcReduction), paragraphs (text, level, alignment, line spacing,
  space before/after, bullet, rtl) and runs (text, font name/size/bold/italic/
  underline/color, strike, baseline, caps, spacing, hyperlink)
- tables: grid sizes, flags, style id, cell text, spans, fills
- charts: type, title, legend, categories, series names and values (and X values)
- pictures: image sha256, content type, bytes, pixel size, crop, alt text

It does not crash on odd files: failures are recorded as `{"error": "..."}` on the
object that failed. Templates and slideshows that python-pptx refuses (`.potx`) are
read with the main content type relabelled (`opened_with_patched_content_type`).
Exit status 2 with `open_error` when python-pptx cannot open the package at all.

### `pptx_compare.py <a> <b> [--roundtrip] [--ignore GLOB]... [--tolerance N] [--json]`

Diffs two inspect snapshots (`a`/`b` may be .pptx or snapshot .json). Prints
`~ path: old -> new`, `- path`, `+ path`; exit 0 equal, 1 different, 2 unopenable.
Paths are dotted (`slides.2.shapes.0.text_frame.paragraphs.1.runs.0.font.size`);
`--ignore` globs match them (`*` crosses dots). `--roundtrip` ignores fields any
faithful save may change: `file`, `core.modified`, `core.revision`,
`core.last_modified_by`, `package.part_count`, `slides.*.partname`.

### `pptx_parts_diff.py <a> <b> [--json] [--strict] [--ignore GLOB]... [--max-lines N] [--all]`

Part-level comparison: `added`, `removed`, `identical`, `c14n-equal` (bytes differ,
Canonical XML 2.0 equal: attribute order, quoting, empty elements, declaration),
`normalized-equal` (also ignoring indentation whitespace and namespace prefix
names; text in `a:t` and `xml:space="preserve"` is kept), `different` (with a
unified diff of the pretty-printed canonical forms) and `binary-different`
(sizes, sha256). Exit 0 unless something is added, removed or different (`--strict`
also fails XML-equal byte changes); 2 when a file is not a zip. XML is parsed
without entity expansion, DTD loading or network access.

### `render_reference.sh <file> <outdir> [--width 1280 | --dpi 96] [--hidden-slides]`

LibreOffice → PDF → one PNG per slide with pdftoppm. Writes `<outdir>/<stem>.pdf`
and `<outdir>/<stem>-<n>.png` (pdftoppm zero-pads `n` to the page count's width:
`-1`…`-9`, `-01`…`-11`), prints the PNG paths. Default 1280 px wide. Exits nonzero
when conversion fails or yields no pages. Hidden slides are skipped unless
`--hidden-slides`.

### `lo_open_check.sh <file> [--hidden-slides]`

Converts to PDF headless; prints `ok <pages>` and exits 0 only when the PDF is
non-empty and has one page per visible slide (per slide including hidden ones with
`--hidden-slides`). Otherwise prints `fail: <reason>` and exits 1.

### `lo_tools.py`

Shared helper for the two scripts above: `convert <file> <outdir> [--to pdf|pptx]
[--hidden-slides]`, `pdf-pages <pdf>`, `slide-count <pptx> [--include-hidden]`.
Conversion copies the input into a private temp dir under a neutral name, uses
the private profile, retries up to 5 times when the profile is locked, and stops
early on LibreOffice's final errors ("source file could not be loaded", "no
export filter") and on crashes.

### `check_fixtures.py [DIR or FILE ...] [--no-lo] [--json out.json]`

Runs everything above over a tree (default: the fixture folder): inspect, a
python-pptx open+save round-trip checked with `pptx_compare.py --roundtrip` and
`pptx_parts_diff.py`, and `lo_open_check.sh`. Each tool runs as a subprocess with
a timeout. About 2 minutes for the committed corpus.

### `generate_fixtures.py`, `generate_hostile.py`, `fetch_corpus.sh`

- `generate_fixtures.py [--libreoffice] [--big N --big-out PATH]` regenerates
  `fixtures/presentation/generated/` (and `libreoffice/` with `--libreoffice`).
  `--big 200` writes a 200-slide performance deck (~550 KB; text, rotated shapes,
  pictures, tables, charts, notes) that is not committed.
- `generate_hostile.py [--extra DIR]` regenerates `fixtures/presentation/hostile/`;
  `--extra` adds a 20,000-entry package and a 4 GiB overlap bomb outside the repo.
- `fetch_corpus.sh DIR [--max-kb 4096] [--include-fuzz]` downloads Apache POI's
  slideshow test files (Apache-2.0) into `DIR` for broader round-trip runs, with
  `SOURCES.tsv`. Then run `check_fixtures.py DIR`. Not committed.

## Calling from vitest

Suites skip unless the variable is set, spawn the venv Python in isolated mode, and
parse JSON output or use exit codes:

```ts
import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const FIDELITY = process.env.PULPO_OFFICE_FIDELITY === '1'
const PYTHON = process.env.PULPO_PPTX_PYTHON ?? '/tmp/pulpo-pptx-venv/bin/python'
const TOOLS = path.resolve(import.meta.dirname, '../../../test-tools/presentation') // adjust to the test's depth

function inspect(file: string) {
  return JSON.parse(execFileSync(PYTHON, ['-I', path.join(TOOLS, 'pptx_inspect.py'), file, '--compact'], { maxBuffer: 64 << 20 }).toString())
}

function compare(a: string, b: string, ...ignore: string[]) {
  const args = ['-I', path.join(TOOLS, 'pptx_compare.py'), a, b, '--roundtrip', '--json', ...ignore.flatMap((g) => ['--ignore', g])]
  const r = spawnSync(PYTHON, args, { maxBuffer: 64 << 20 })
  return { status: r.status, differences: JSON.parse(r.stdout.toString()).differences as unknown[] }
}

function partsDiff(a: string, b: string) {
  const r = spawnSync(PYTHON, ['-I', path.join(TOOLS, 'pptx_parts_diff.py'), a, b, '--json'], { maxBuffer: 64 << 20 })
  return { status: r.status, ...JSON.parse(r.stdout.toString()) }
}

describe.skipIf(!FIDELITY)('pptx round-trip fidelity', () => {
  it('keeps what python-pptx sees', () => {
    // write the engine's output to a temp file, then:
    // expect(compare(original, written).differences).toEqual([])
    // expect(spawnSync(path.join(TOOLS, 'lo_open_check.sh'), [written]).status).toBe(0)
  })
})
```

LibreOffice calls share one profile, so run LibreOffice-backed tests serially
(`describe.sequential`, or keep them in one file) and give them generous timeouts
(about 5 s per small deck, 30 s for the 200-slide deck).

## Known results (python-pptx 1.0.2, LibreOffice 26.8.2.2, macOS)

Every `poi/`, `generated/` and `libreoffice/` fixture opens in python-pptx and
LibreOffice, with the PDF page count matching the slide count. python-pptx
open+save shows no snapshot differences for any of them. Notes:

- `generated/theme-custom-template.potx` and `poi/testPPT.ppsx`: python-pptx can't
  open templates or slideshows (`is not a PowerPoint file`). `pptx_inspect.py`
  reads them by relabelling the content type; they can't be re-saved with python-pptx.
- `poi/missing-blip-fill.pptx`: one per-object inspect error (picture without image).
- python-pptx re-saves POI files with `c14n-equal` XML (declaration and quoting)
  and different `docProps`/`[Content_Types].xml`; most parts of LibreOffice-written
  files come back `normalized-equal`.

Hostile files:

| File | python-pptx (`pptx_inspect.py`) | LibreOffice (`lo_open_check.sh`) |
| --- | --- | --- |
| `cyclic-references.pptx` | opens; 2 per-object errors | ok, 2 pages |
| `deep-nesting-groups.pptx` | open_error: lxml "Excessive depth in document: 256" | **soffice segfaults** (SIGSEGV) |
| `deep-nesting-xml.pptx` | open_error: same depth limit | ok, 1 page |
| `duplicate-slide-ids.pptx` | opens, 5 slides (one part listed twice) | ok, 5 pages |
| `duplicate-zip-entries.pptx` | opens (Python zip takes the last duplicate) | fails to load |
| `encrypted-password-pulpo.pptx` | open_error (not a zip) | fails (password prompt is impossible headless) |
| `huge-values.pptx` | opens | ok, 2 pages |
| `legacy-ppt-renamed.pptx` | open_error | fail (not a zip; slide count unavailable) |
| `missing-content-types.pptx` | open_error | fails to load |
| `missing-parts.pptx` | opens, but listing slides fails (`KeyError: rId900`), recorded as `slides: {error}` | renders 5 pages for 3 resolvable slides, so the check fails |
| `missing-presentation-xml.pptx` | open_error | fails to load |
| `not-a-zip.pptx` | open_error | fail (LibreOffice would import it as a text document; the Impress PDF filter refuses) |
| `rels-path-traversal.pptx` | opens; 7 per-object errors (unresolvable images) | fails to load |
| `truncated-zip.pptx` | open_error | fails to load |
| `wrong-main-content-type.pptx` | open_error (not a presentation) | ok, 1 page (ignores the content type) |
| `xml-entities.pptx` | open_error: libxml2 entity amplification limit | ok, 2 pages |
| `zip-bomb-declared-size.pptx` | opens (Python zip reads the real 16 bytes) | ok, 1 page |
| `zip-bomb-overlap.pptx` | open_error: zip name mismatch between directory and header | fails to load |
| `zip-bomb-understated.pptx` | open_error: CRC mismatch | fails to load |

For the engine's reader (`fflate.unzipSync` in `src/office/ooxml/package.ts`):
`zip-bomb-overlap` and `zip-bomb-declared-size` trip the declared-size limit, but
`zip-bomb-understated` passes it. fflate then inflates the full 768 MiB (~1.5 s
CPU), truncates each entry to the declared 1 KiB without checking the CRC, and the
actual-size check never fires.
