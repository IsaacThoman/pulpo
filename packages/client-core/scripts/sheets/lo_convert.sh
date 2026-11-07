#!/usr/bin/env bash
# Convert a spreadsheet with headless LibreOffice, safely alongside other LibreOffice users.
#
#   lo_convert.sh <input> <outdir> <format>
#
# format: pdf | png | xlsx | csv | ods | html | any raw LibreOffice --convert-to spec
#   (e.g. 'csv:Text - txt - csv (StarCalc):59,34,76,1'). 'csv' exports EVERY sheet as
#   UTF-8, comma-separated, to <base>-<SheetName>.csv; 'png' renders the first page only
#   (use lo_render_png.sh for all pages).
#
# Every run uses a private, throw-away profile (-env:UserInstallation) so it never
# touches or collides with other LibreOffice instances, plus --headless --norestore
# and a timeout (LO_TIMEOUT seconds, default 120). Macros are never enabled.
# Optional: LO_INFILTER='CSV:44,34,76' to force an import filter.
#
# Prints JSON {"ok", "format", "input", "outputs": [...], "elapsedMs", "log"?} and exits
# 0 on success, 1 if LibreOffice produced nothing / failed, 124 on timeout, 2 on usage.
set -uo pipefail

if [ $# -ne 3 ]; then
  echo "usage: $0 <input> <outdir> <format>" >&2
  exit 2
fi
INPUT="$1"
OUTDIR="$2"
FORMAT="$3"
TIMEOUT="${LO_TIMEOUT:-120}"

find_soffice() {
  if [ -n "${PULPO_SOFFICE:-}" ]; then echo "$PULPO_SOFFICE"; return; fi
  for c in /Applications/LibreOffice.app/Contents/MacOS/soffice "$(command -v soffice 2>/dev/null)" "$(command -v libreoffice 2>/dev/null)"; do
    if [ -n "$c" ] && [ -x "$c" ]; then echo "$c"; return; fi
  done
}
SOFFICE="$(find_soffice)"

json() { python3 -I -c 'import json,sys; print(json.dumps(json.loads(sys.argv[1]), indent=1, sort_keys=True))' "$1"; }
jstr() { python3 -I -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1"; }

if [ -z "$SOFFICE" ]; then
  json "{\"ok\": false, \"error\": \"LibreOffice (soffice) not found\"}"
  exit 1
fi
if [ ! -f "$INPUT" ]; then
  json "{\"ok\": false, \"error\": $(jstr "input not found: $INPUT")}"
  exit 2
fi
mkdir -p "$OUTDIR"
INPUT_ABS="$(cd "$(dirname "$INPUT")" && pwd)/$(basename "$INPUT")"
OUTDIR_ABS="$(cd "$OUTDIR" && pwd)"

case "$FORMAT" in
  csv) SPEC='csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,false,false,false,-1'; EXT=csv ;;
  pdf) SPEC='pdf:calc_pdf_Export'; EXT=pdf ;;
  png) SPEC='png'; EXT=png ;;
  xlsx) SPEC='xlsx:Calc MS Excel 2007 XML'; EXT=xlsx ;;
  ods) SPEC='ods'; EXT=ods ;;
  html) SPEC='html:HTML (StarCalc)'; EXT=html ;;
  *) SPEC="$FORMAT"; EXT="${FORMAT%%:*}" ;;
esac

BASE="$(basename "$INPUT_ABS")"
STEM="${BASE%.*}"
if [ "$OUTDIR_ABS/$STEM.$EXT" = "$INPUT_ABS" ]; then
  json "{\"ok\": false, \"error\": \"output would overwrite the input; choose another outdir\"}"
  exit 2
fi

PROFILE="$(mktemp -d /tmp/lo-sheets-XXXXXXXX)"
LOG="$PROFILE.log"
BEFORE="$(ls -1 "$OUTDIR_ABS" 2>/dev/null)"
cleanup() { rm -rf "$PROFILE" "$LOG"; }
trap cleanup EXIT

START_MS=$(python3 -I -c 'import time; print(int(time.time()*1000))')
ARGS=(--headless --norestore --nologo --nodefault --nolockcheck
  "-env:UserInstallation=file://$PROFILE"
  --convert-to "$SPEC" --outdir "$OUTDIR_ABS")
if [ -n "${LO_INFILTER:-}" ]; then ARGS+=("--infilter=$LO_INFILTER"); fi

"$SOFFICE" "${ARGS[@]}" "$INPUT_ABS" >"$LOG" 2>&1 &
PID=$!
# Watchdog: must not hold our stdout (callers capture it with $(...)) and must take its
# own sleep down with it when cancelled.
(
  trap 'kill "$SLEEP_PID" 2>/dev/null; exit 0' TERM
  sleep "$TIMEOUT" &
  SLEEP_PID=$!
  wait "$SLEEP_PID"
  if kill -0 "$PID" 2>/dev/null; then
    kill -TERM "$PID" 2>/dev/null; sleep 3; kill -KILL "$PID" 2>/dev/null
  fi
) >/dev/null 2>&1 &
WATCHDOG=$!
wait "$PID" 2>/dev/null
STATUS=$?
kill "$WATCHDOG" 2>/dev/null
wait "$WATCHDOG" 2>/dev/null
END_MS=$(python3 -I -c 'import time; print(int(time.time()*1000))')

OUTPUTS="$(python3 -I - "$OUTDIR_ABS" "$STEM" "$EXT" "$BEFORE" <<'PY'
import json, os, sys
outdir, stem, ext, before = sys.argv[1], sys.argv[2], sys.argv[3].lower(), set(sys.argv[4].splitlines())
found = []
for name in sorted(os.listdir(outdir)):
    if not name.lower().endswith("." + ext):
        continue
    if name == f"{stem}.{ext}" or name.startswith(stem + "-") or name not in before:
        found.append(os.path.join(outdir, name))
print(json.dumps(found))
PY
)"
LOGTEXT="$(tail -c 2000 "$LOG" 2>/dev/null)"

if [ "$STATUS" -ge 128 ] && [ "$((END_MS - START_MS))" -ge "$((TIMEOUT * 1000))" ]; then
  json "{\"ok\": false, \"error\": \"timeout after ${TIMEOUT}s\", \"input\": $(jstr "$INPUT_ABS"), \"log\": $(jstr "$LOGTEXT")}"
  exit 124
fi
if [ "$OUTPUTS" = "[]" ]; then
  json "{\"ok\": false, \"error\": \"LibreOffice produced no output (exit $STATUS)\", \"input\": $(jstr "$INPUT_ABS"), \"format\": $(jstr "$FORMAT"), \"log\": $(jstr "$LOGTEXT")}"
  exit 1
fi
json "{\"ok\": true, \"input\": $(jstr "$INPUT_ABS"), \"format\": $(jstr "$FORMAT"), \"outputs\": $OUTPUTS, \"elapsedMs\": $((END_MS - START_MS)), \"exitCode\": $STATUS}"
