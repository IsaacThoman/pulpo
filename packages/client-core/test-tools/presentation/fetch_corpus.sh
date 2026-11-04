#!/usr/bin/env bash
# Downloads Apache POI's slideshow test files (Apache-2.0) for broader round-trip
# runs. Opt-in and never committed.
#   fetch_corpus.sh <empty-or-new-dir> [--max-kb 4096] [--include-fuzz]
# Fetches .pptx/.pptm/.ppsx/.ppsm/.potx/.potm from
# https://github.com/apache/poi/tree/trunk/test-data/slideshow, skipping files larger
# than --max-kb (default 4096) and, unless --include-fuzz, the clusterfuzz/crash
# reproducers. Treat everything downloaded as untrusted: keep scripts elsewhere and
# run Python on it with `python -I`. Writes SOURCES.tsv (name, bytes, url) next to the files.
set -euo pipefail

[[ $# -ge 1 ]] || { echo "usage: $0 <dir> [--max-kb N] [--include-fuzz]" >&2; exit 2; }
dest=$1; shift
max_kb=4096 fuzz=0
while [[ $# -gt 0 ]]; do
  case $1 in
    --max-kb) max_kb=$2; shift 2 ;;
    --include-fuzz) fuzz=1; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
mkdir -p "$dest"
dest=$(cd "$dest" && pwd)
listing=$(mktemp "${TMPDIR:-/tmp}/pulpo-poi-listing.XXXXXX")
trap 'rm -f "$listing"' EXIT

curl -fsSL -H 'Accept: application/vnd.github+json' \
  'https://api.github.com/repos/apache/poi/contents/test-data/slideshow?ref=trunk' -o "$listing"

python3 -I - "$listing" "$max_kb" "$fuzz" > "$dest/SOURCES.tsv" <<'PY'
import json, sys
listing, max_kb, fuzz = sys.argv[1], int(sys.argv[2]), sys.argv[3] == '1'
exts = ('.pptx', '.pptm', '.ppsx', '.ppsm', '.potx', '.potm')
for e in json.load(open(listing)):
    name = e['name']
    if e.get('type') != 'file' or not name.lower().endswith(exts):
        continue
    if not fuzz and (name.startswith('clusterfuzz') or name.startswith('crash-')):
        continue
    if e['size'] > max_kb * 1024 or '/' in name or name.startswith('.'):
        continue
    print(f"{name}\t{e['size']}\t{e['download_url']}")
PY

count=0
while IFS=$'\t' read -r name size url; do
  [[ -f "$dest/$name" && $(wc -c < "$dest/$name") -eq $size ]] && { count=$((count + 1)); continue; }
  if curl -fsSL --max-time 120 "$url" -o "$dest/$name.part"; then
    mv "$dest/$name.part" "$dest/$name"
    count=$((count + 1))
  else
    rm -f "$dest/$name.part"
    echo "failed: $name" >&2
  fi
done < "$dest/SOURCES.tsv"
echo "$count files in $dest"
