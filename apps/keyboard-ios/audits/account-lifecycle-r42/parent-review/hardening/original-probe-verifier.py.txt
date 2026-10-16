#!/usr/bin/env python3
"""Reject malformed copies; never edit frozen fixtures or reports."""
import copy
import json
import verify

cases = verify.read('heldout/cases.json')
raw = verify.read('heldout/candidate-raw.json')
probes = []
for kind in ('missing-row', 'lying-check', 'wrong-count', 'wrong-input', 'missing-check', 'unsettled-task'):
    rows = copy.deepcopy(raw)
    if kind == 'missing-row': rows.pop()
    if kind == 'lying-check': rows[0]['checks'][0]['memory']['name'] = 'tampered'
    if kind == 'wrong-count': rows[0]['counts']['save'] += 1
    if kind == 'wrong-input': rows[0]['events'][1]['step']['email'] = 'tampered'
    if kind == 'missing-check': rows[0]['checks'].pop()
    if kind == 'unsettled-task': rows[0]['unsettled'] = ['L']
    try:
        verify.audit_rows(rows, cases)
    except ValueError as error:
        probes.append(dict(probe=kind, rejected=True, reason=str(error)))
    else:
        raise ValueError('Malformed probe accepted: ' + kind)
print(json.dumps(probes, indent=2))
