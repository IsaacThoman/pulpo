#!/usr/bin/env python3
"""Static only: rejects invented APIs/fields, invalid actor order, wrong oracle types."""
import hashlib, json, pathlib, sys
p = pathlib.Path(sys.argv[1])
raw = p.read_bytes()
cases = json.loads(raw)
assert isinstance(cases, list) and 1 <= len(cases) <= 80
ids = set()
checks = 0
for case in cases:
    assert set(case) == {'id', 'description', 'actions'}
    assert isinstance(case['id'], str) and case['id'] and case['id'] not in ids
    ids.add(case['id'])
    assert isinstance(case['description'], str) and case['description']
    assert isinstance(case['actions'], list) and 1 <= len(case['actions']) <= 200
    actors = set()
    case_checks = 0
    for action in case['actions']:
        assert isinstance(action, dict)
        op, actor = action['op'], action['instance']
        assert isinstance(actor, str) and actor
        allowed = {'op', 'instance'}
        required = {'op', 'instance'}
        if op == 'new':
            assert actor not in actors
            actors.add(actor)
            allowed |= {'memory'}
        else:
            assert actor in actors
            if op == 'learn':
                required |= {'word'}
                allowed |= {'word', 'after', 'pinned'}
            elif op in ('pin', 'forget'):
                allowed |= {'word'}; required |= {'word'}
            elif op == 'transient':
                allowed |= {'words'}; required |= {'words'}
            elif op in ('save', 'background', 'clear'): pass
            elif op == 'reload': allowed |= {'expected'}
            elif op == 'check':
                allowed |= {'field', 'expected'}
                required |= {'field', 'expected'}
                field = action['field']
                if field in ('count', 'known', 'blocked'): required |= {'word'}; allowed |= {'word'}
                elif field == 'pair':
                    required |= {'word', 'after'}; allowed |= {'word', 'after'}
                    assert isinstance(action.get('after'), str)
                elif field == 'history':
                    required |= {'after'}; allowed |= {'after'}
                    assert isinstance(action.get('after'), str)
                else: assert field in ('total', 'dirty', 'knownWords', 'files')
                if field in ('count', 'pair', 'history', 'total'): assert type(action['expected']) is int and action['expected'] >= 0
                elif field in ('known', 'blocked', 'dirty'): assert type(action['expected']) is bool
                else: assert isinstance(action['expected'], list) and all(isinstance(x, str) for x in action['expected']) and action['expected'] == sorted(action['expected'])
            else: raise AssertionError('unavailable operation: ' + str(op))
        assert required <= set(action) <= allowed
        for key in ('memory', 'pinned'):
            if key in action: assert type(action[key]) is bool
        if 'word' in action: assert isinstance(action['word'], str) and 0 < len(action['word']) <= 40
        if 'after' in action: assert action['after'] is None or isinstance(action['after'], str)
        if 'words' in action: assert isinstance(action['words'], list) and all(isinstance(x, str) for x in action['words'])
        if op == 'reload' and 'expected' in action: assert type(action['expected']) is bool
        if 'expected' in action: case_checks += 1
    assert case_checks > 0
    checks += case_checks
print(json.dumps({'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw), 'available_cases': len(cases), 'unavailable_cases': 0, 'checks': checks, 'static_validation': 'pass'}, sort_keys=True))
