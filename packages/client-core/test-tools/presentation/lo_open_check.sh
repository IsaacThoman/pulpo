#!/usr/bin/env bash
# Checks that LibreOffice opens a presentation: converts it to PDF headless and
# exits 0 only when the PDF is non-empty and has one page per slide.
#   lo_open_check.sh <file.pptx> [--hidden-slides]
# Hidden slides are not exported by default, so they are not counted; with
# --hidden-slides they are exported and counted. Prints "ok <pages>" or the reason.
set -euo pipefail

[[ $# -ge 1 ]] || { echo "usage: $0 <file.pptx> [--hidden-slides]" >&2; exit 2; }
src=$1
hidden=
[[ ${2:-} == --hidden-slides ]] && hidden=1
[[ -f $src ]] || { echo "no such file: $src" >&2; exit 2; }
here=$(cd "$(dirname "$0")" && pwd)
python=${PULPO_PPTX_PYTHON:-/tmp/pulpo-pptx-venv/bin/python}
[[ -x $python ]] || python=python3

tmp=$(mktemp -d "${TMPDIR:-/tmp}/pulpo-lo-check.XXXXXX")
trap 'rm -rf "$tmp"' EXIT

if [[ -n $hidden ]]; then
  pdf=$("$python" -I "$here/lo_tools.py" convert "$src" "$tmp" --to pdf --hidden-slides) || { echo "fail: conversion failed"; exit 1; }
  expected=$("$python" -I "$here/lo_tools.py" slide-count "$src" --include-hidden) || { echo "fail: cannot count slides"; exit 1; }
else
  pdf=$("$python" -I "$here/lo_tools.py" convert "$src" "$tmp" --to pdf) || { echo "fail: conversion failed"; exit 1; }
  expected=$("$python" -I "$here/lo_tools.py" slide-count "$src") || { echo "fail: cannot count slides"; exit 1; }
fi
[[ -s $pdf ]] || { echo "fail: empty pdf"; exit 1; }
pages=$("$python" -I "$here/lo_tools.py" pdf-pages "$pdf")
if [[ $pages -ne $expected ]]; then
  echo "fail: pdf has $pages pages, expected $expected slides"
  exit 1
fi
echo "ok $pages"
