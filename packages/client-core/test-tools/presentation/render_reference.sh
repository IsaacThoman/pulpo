#!/usr/bin/env bash
# Renders a presentation to one PNG per slide through LibreOffice:
#   render_reference.sh <file.pptx> <outdir> [--width 1280|--dpi 96] [--hidden-slides]
# Writes <outdir>/<stem>.pdf and <outdir>/<stem>-<n>.png (n starts at 1, zero-padded
# by pdftoppm to the page count's width). Exits nonzero when conversion or
# rasterization fails or produces no pages.
set -euo pipefail

usage() { echo "usage: $0 <file.pptx> <outdir> [--width PX | --dpi N] [--hidden-slides]" >&2; exit 2; }
[[ $# -ge 2 ]] || usage
src=$1 outdir=$2; shift 2
width=1280 dpi= hidden=
while [[ $# -gt 0 ]]; do
  case $1 in
    --width) width=$2; dpi=; shift 2 ;;
    --dpi) dpi=$2; width=; shift 2 ;;
    --hidden-slides) hidden=--hidden-slides; shift ;;
    *) usage ;;
  esac
done
[[ -f $src ]] || { echo "no such file: $src" >&2; exit 2; }
here=$(cd "$(dirname "$0")" && pwd)
python=${PULPO_PPTX_PYTHON:-/tmp/pulpo-pptx-venv/bin/python}
[[ -x $python ]] || python=python3
command -v pdftoppm >/dev/null || { echo "pdftoppm (poppler) is required: brew install poppler" >&2; exit 2; }

mkdir -p "$outdir"
pdf=$("$python" -I "$here/lo_tools.py" convert "$src" "$outdir" --to pdf $hidden)
stem=$(basename "${pdf%.pdf}")
rm -f "$outdir/$stem"-*.png
if [[ -n $dpi ]]; then
  pdftoppm -png -r "$dpi" "$pdf" "$outdir/$stem"
else
  pdftoppm -png -scale-to-x "$width" -scale-to-y -1 "$pdf" "$outdir/$stem"
fi
shopt -s nullglob
pngs=("$outdir/$stem"-*.png)
[[ ${#pngs[@]} -gt 0 ]] || { echo "pdftoppm produced no pages for $pdf" >&2; exit 1; }
printf '%s\n' "${pngs[@]}"
