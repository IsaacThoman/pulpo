#!/usr/bin/env bash
# Render every printed page of a workbook to PNG for visual comparison.
#
#   lo_render_png.sh <xlsx> <outdir>
#
# xlsx -> PDF via lo_convert.sh (private LibreOffice profile, headless, timeout), then
# PDF -> <stem>-page-<n>.png with pdftoppm (poppler) at LO_PNG_DPI (default 96).
# Without pdftoppm it falls back to macOS sips, which renders the FIRST page only.
# Pages are what LibreOffice would print: all non-empty sheets, honouring print areas,
# scaling and page breaks.
#
# Prints JSON {"ok", "pdf", "pages": [...], "renderer"} ; exit codes as lo_convert.sh.
set -uo pipefail

if [ $# -ne 2 ]; then
  echo "usage: $0 <xlsx> <outdir>" >&2
  exit 2
fi
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INPUT="$1"
OUTDIR="$2"
DPI="${LO_PNG_DPI:-96}"
mkdir -p "$OUTDIR"
OUTDIR_ABS="$(cd "$OUTDIR" && pwd)"
STEM="$(basename "$INPUT")"
STEM="${STEM%.*}"

WORK="$(mktemp -d /tmp/lo-sheets-render-XXXXXXXX)"
trap 'rm -rf "$WORK"' EXIT

CONVERT_JSON="$("$HERE/lo_convert.sh" "$INPUT" "$WORK" pdf)"
STATUS=$?
if [ $STATUS -ne 0 ]; then
  echo "$CONVERT_JSON"
  exit $STATUS
fi
PDF="$WORK/$STEM.pdf"
cp "$PDF" "$OUTDIR_ABS/$STEM.pdf"
rm -f "$OUTDIR_ABS/$STEM"-page-*.png

if command -v pdftoppm >/dev/null 2>&1; then
  RENDERER=pdftoppm
  pdftoppm -r "$DPI" -png "$PDF" "$OUTDIR_ABS/$STEM-page" || { echo '{"ok": false, "error": "pdftoppm failed"}'; exit 1; }
elif command -v sips >/dev/null 2>&1; then
  RENDERER="sips (first page only)"
  sips -s format png "$PDF" --out "$OUTDIR_ABS/$STEM-page-1.png" >/dev/null 2>&1 || { echo '{"ok": false, "error": "sips failed"}'; exit 1; }
else
  echo '{"ok": false, "error": "no PDF rasteriser (install poppler for pdftoppm)"}'
  exit 1
fi

python3 -I - "$OUTDIR_ABS" "$STEM" "$RENDERER" <<'PY'
import json, os, re, sys
outdir, stem, renderer = sys.argv[1:4]
pat = re.compile(re.escape(stem) + r"-page-0*(\d+)\.png$")
pages = sorted((int(m.group(1)), os.path.join(outdir, n)) for n in os.listdir(outdir) if (m := pat.match(n)))
print(json.dumps({"ok": bool(pages), "pdf": os.path.join(outdir, stem + ".pdf"), "pages": [p for _, p in pages],
                  "renderer": renderer}, indent=1, sort_keys=True))
sys.exit(0 if pages else 1)
PY
