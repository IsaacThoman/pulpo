#!/usr/bin/env bash
# Creates (or refreshes) the Python virtualenv used by the sheets fidelity tools.
# Idempotent, no sudo. Override the location with PULPO_SHEETS_VENV.
set -euo pipefail

VENV="${PULPO_SHEETS_VENV:-$HOME/.cache/pulpo-sheets-venv}"
PYTHON="${PYTHON:-python3}"
# Pinned so dumps stay comparable across machines.
OPENPYXL_VERSION="${OPENPYXL_VERSION:-3.1.5}"
# Pillow is required for openpyxl to read/write images (without it images are silently dropped on load).
PILLOW_SPEC="${PILLOW_SPEC:-pillow>=10}"

if ! command -v "$PYTHON" >/dev/null 2>&1; then
  echo "error: $PYTHON not found (install Python 3.9+)" >&2
  exit 1
fi

if [ ! -x "$VENV/bin/python" ]; then
  echo "creating venv at $VENV"
  mkdir -p "$(dirname "$VENV")"
  "$PYTHON" -m venv "$VENV"
fi

if ! "$VENV/bin/python" -I -c "import openpyxl, PIL, sys; sys.exit(0 if openpyxl.__version__ == '$OPENPYXL_VERSION' else 1)" 2>/dev/null; then
  "$VENV/bin/python" -I -m pip install --quiet --disable-pip-version-check "openpyxl==$OPENPYXL_VERSION" "$PILLOW_SPEC"
fi

"$VENV/bin/python" -I -c "import openpyxl, PIL, sys; print('openpyxl', openpyxl.__version__, 'pillow', PIL.__version__, 'python', sys.version.split()[0])"

SOFFICE="${PULPO_SOFFICE:-/Applications/LibreOffice.app/Contents/MacOS/soffice}"
if [ -x "$SOFFICE" ] || command -v soffice >/dev/null 2>&1; then
  echo "libreoffice: found"
else
  echo "libreoffice: not found (lo_convert.sh / lo_render_png.sh will be unavailable)"
fi
if command -v pdftoppm >/dev/null 2>&1; then
  echo "pdftoppm: found"
else
  echo "pdftoppm: not found (lo_render_png.sh falls back to sips, first page only)"
fi
echo "venv ready: $VENV/bin/python"
