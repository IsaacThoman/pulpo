#!/bin/sh
# Existing-raw evaluation ONLY. Never run a BoundaryRunner or compile.
set -eu
cd "$(dirname "$0")"
python3 audit.py evidence/work evidence/audit
# Optional exact frozen CLI evaluation; comparison intentionally exits 1.
python3 evidence/work/author/evaluate.py evidence/work/comparison/raw.json || test "$?" -eq 1
python3 -O evidence/work/author/evaluate.py evidence/work/comparison/raw.json || test "$?" -eq 1
python3 evidence/work/author/evaluate.py evidence/work/candidate/raw.json
python3 -O evidence/work/author/evaluate.py evidence/work/candidate/raw.json
