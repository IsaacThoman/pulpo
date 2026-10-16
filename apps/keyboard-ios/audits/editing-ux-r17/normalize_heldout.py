#!/usr/bin/env python3
"""Lossless schema adapter. Never repairs or filters authored expectations."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parent
source = root / 'cursor-heldout-authored.json'
raw = source.read_bytes()
assert hashlib.sha256(raw).hexdigest() == '17bb56224c82db0b4bbe58c83a55d30555eecac4236b0695f64326044daf252b'
authored = json.loads(raw)
rows = []
for case in authored['cases']:
    start, end = case['starting_selection'], case['expected_selection']
    rows.append({
        'id': case['id'], 'language': case['language'], 'document': case['document'],
        'selectionUTF16': [start['location'], start['length']], 'offset': case['character_offset'],
        'insert': case['inserted_text'], 'expectedDocument': case['expected_document'],
        'expectedSelectionUTF16': [end['location'], end['length']],
    })
(root / 'cursor-heldout-runner.json').write_text(json.dumps({
    'version': 1, 'sourceSHA256': hashlib.sha256(raw).hexdigest(), 'cases': rows,
}, ensure_ascii=False, indent=2) + '\n')
