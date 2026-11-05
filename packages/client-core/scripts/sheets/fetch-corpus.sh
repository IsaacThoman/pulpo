#!/usr/bin/env bash
# Opt-in large spreadsheet corpus for the sheets engine corpus tests.
#
# Downloads every xlsx/xlsm/xltx/xltm file from Apache POI's test-data/spreadsheet
# (Apache-2.0) plus POI's encrypted OOXML samples from test-data/poifs, and generates
# the large openpyxl fixtures, into $PULPO_SHEETS_CORPUS (default ~/.cache/pulpo-sheets-corpus).
#
#   packages/client-core/scripts/sheets/fetch-corpus.sh [--force]
#   PULPO_SHEETS_CORPUS=~/.cache/pulpo-sheets-corpus npx vitest ...
#
# Everything downloaded is untrusted data: it is only ever written to the cache
# directory, never executed, and only parsed by tools that run with `python3 -I`.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORPUS="${PULPO_SHEETS_CORPUS:-$HOME/.cache/pulpo-sheets-corpus}"
# Pinned POI commit so the corpus is reproducible. Override with POI_REF=trunk for the latest.
POI_REF="${POI_REF:-7f4d36854109efa17152b27a5fb1b2c7d842c314}"
VENV_PY="${PULPO_SHEETS_VENV:-$HOME/.cache/pulpo-sheets-venv}/bin/python"
FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

for tool in curl python3; do
  command -v "$tool" >/dev/null 2>&1 || { echo "error: $tool is required" >&2; exit 1; }
done

mkdir -p "$CORPUS/poi" "$CORPUS/poi-encrypted" "$CORPUS/generated"
LIST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pulpo-sheets-list.XXXXXX")"
trap 'rm -rf "$LIST_DIR"' EXIT

api_get() {
  local url="$1" out="$2"
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    gh api "${url#https://api.github.com/}" > "$out"
  else
    curl -fsSL -H 'Accept: application/vnd.github+json' "$url" -o "$out"
  fi
}

# Resolve the test-data/spreadsheet tree sha at POI_REF, then list it (one API call each).
api_get "https://api.github.com/repos/apache/poi/contents/test-data?ref=$POI_REF" "$LIST_DIR/test-data.json"
TREE_SHA="$(python3 -I -c 'import json,sys; print(next(e["sha"] for e in json.load(open(sys.argv[1])) if e["name"]=="spreadsheet"))' "$LIST_DIR/test-data.json")"
api_get "https://api.github.com/repos/apache/poi/git/trees/$TREE_SHA" "$LIST_DIR/tree.json"
python3 -I - "$LIST_DIR/tree.json" > "$LIST_DIR/names.txt" <<'PY'
import json, re, sys
tree = json.load(open(sys.argv[1]))
if tree.get("truncated"):
    sys.exit("tree listing truncated")
for e in tree["tree"]:
    name = e["path"]
    if e["type"] == "blob" and re.search(r"\.(xlsx|xlsm|xltx|xltm)$", name, re.I) and re.fullmatch(r"[A-Za-z0-9._+-]+", name):
        print(name)
PY

fetch() {
  local url="$1" dest="$2"
  if [ "$FORCE" = 0 ] && [ -s "$dest" ]; then return 0; fi
  curl -fsSL --retry 3 --max-time 120 "$url" -o "$dest.part" && mv "$dest.part" "$dest"
}

count=0
failed=0
while IFS= read -r name; do
  if fetch "https://raw.githubusercontent.com/apache/poi/$POI_REF/test-data/spreadsheet/$name" "$CORPUS/poi/$name"; then
    count=$((count + 1))
  else
    echo "warn: failed to fetch $name" >&2
    failed=$((failed + 1))
  fi
done < "$LIST_DIR/names.txt"
echo "poi: $count files ($failed failed) in $CORPUS/poi"

# Encrypted (CFB-wrapped) OOXML samples: the engine must refuse these cleanly.
for name in protect.xlsx protected_sha512.xlsx 60320-protected.xlsx extenxls_pwd123.xlsx; do
  fetch "https://raw.githubusercontent.com/apache/poi/$POI_REF/test-data/poifs/$name" "$CORPUS/poi-encrypted/$name" \
    || echo "warn: failed to fetch poifs/$name" >&2
done
echo "poi-encrypted: $(ls "$CORPUS/poi-encrypted" | wc -l | tr -d ' ') files"

if [ -x "$VENV_PY" ]; then
  "$VENV_PY" -I "$SCRIPT_DIR/generate_fixtures.py" --large-only --large-dir "$CORPUS/generated"
else
  echo "warn: $VENV_PY missing; run setup-fidelity-env.sh to generate the large fixtures" >&2
fi

# Manifest: name, size, sha256 for every corpus file.
python3 -I - "$CORPUS" "$POI_REF" > "$CORPUS/manifest.json" <<'PY'
import hashlib, json, os, sys
root, ref = sys.argv[1], sys.argv[2]
files = []
for sub in ("poi", "poi-encrypted", "generated"):
    d = os.path.join(root, sub)
    for name in sorted(os.listdir(d)):
        p = os.path.join(d, name)
        if not os.path.isfile(p) or name.endswith(".part"):
            continue
        h = hashlib.sha256(open(p, "rb").read()).hexdigest()
        files.append({"path": f"{sub}/{name}", "size": os.path.getsize(p), "sha256": h})
json.dump({"poiRef": ref, "license": "Apache-2.0 (poi, poi-encrypted); generated files are ours", "files": files}, sys.stdout, indent=1)
PY
echo "corpus ready: $CORPUS (manifest.json lists $(python3 -I -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["files"]))' "$CORPUS/manifest.json") files)"
echo "export PULPO_SHEETS_CORPUS=$CORPUS"
