#!/usr/bin/env python3
"""Bounded R23 artifact checks. No builds, devices, debugger or source writes."""
import gzip
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

root = Path(__file__).resolve().parent
assert set(sys.argv[1:]) <= {'--git', '--external'}
sha = lambda b: hashlib.sha256(b).hexdigest()
raw = lambda name: (root / name).read_bytes()
def content(name):
    data = raw(name)
    return gzip.decompress(data) if name.endswith('.gz') else data
text = lambda name: content(name).decode()
manifest = json.loads(raw('manifest.json'))
for name, record in manifest.items():
    data = raw(name)
    assert len(data) == record['bytes'] and sha(data) == record['sha256'], name
provenance = json.loads(raw('provenance.json'))
for name, record in provenance.items():
    data = content(name)
    assert len(data) == record['retainedUncompressedBytes']
    assert sha(data) == record['retainedUncompressedSha256'], name
    if '--external' in sys.argv and record['kind'] != 'git-blob':
        source = Path(record['path']).read_bytes()
        assert sha(source) == record['sourceSha256']
        if record['kind'] == 'line-excerpt':
            lines = source.splitlines(keepends=True)
            source = b''.join(b''.join(lines[a-1:b]) for a, b in record['lineRangesInclusive'])
        assert source == data, name
report = json.loads(raw('r23-evidence.json'))
summary = json.loads(raw('evidence/final-app-tests-summary.json'))
assert (summary['totalTestCount'], summary['passedTests'], summary['failedTests'], summary['skippedTests']) == (28, 20, 8, 0)
assert summary['runtimeWarnings'] == [] and summary['expectedFailures'] == 0
log = text('evidence/final-method-results-and-assertions.txt')
methods = re.findall(r"Test Case '-\[PulpoKeyboardAppTests\.(\w+) (\w+)\]' (passed|failed)", log)
assert len(methods) == 28 and sum(m[2] == 'passed' for m in methods) == 20
assert len(re.findall('error:.*XCTAssertNil failed', log)) == report['final']['failedAssertions'] == 16
original = [m for m in methods if m[0] != 'PreviewConsumerOwnershipTests']
new = [m for m in methods if m[0] == 'PreviewConsumerOwnershipTests']
assert len(original) == 19 and sum(m[2] == 'passed' for m in original) == 18
assert len(new) == 9 and sum(m[2] == 'passed' for m in new) == 2
assert 'Unbalanced calls' in log and report['final']['standaloneDocumentChecksExecuted'] is False
runs = report['nativeRuns']
assert len(runs) == 13 and all(r['commandExit'] == 65 for r in runs)
assert round(sum(r['wallSeconds'] for r in runs), 2) == 273.74
pointer = text('evidence/candidate-pointer-and-content-methods.txt.gz')
match = re.search(r'input (0x\w+) left (0x\w+) left.input (0x\w+) right (0x\w+) right.input (0x\w+)', pointer)
assert match and match.groups() == ('0x116b74000', '0x11809c380', '0x116b74000', '0x11809c540', '0x116b74000')
assert report['runtime']['UIKitCoreUUID'] in pointer and 'Process 67042 detached' in pointer
assert '<+128>' in pointer and pointer.count('symbol stub for: objc_storeStrong') == 2
probe = dict(line.split('=', 1) for line in text('evidence/candidate-probe.txt').splitlines())
assert probe['pid'] == '67042' and int(probe['input'], 16) == int(match[1], 16) and probe['host'] == 'nil'
metadata = text('evidence/strong-layout-and-ivar-offsets.txt')
for name, layout, fields in [('UIInputView', '11 12 b6', {'_leftContentView': 440, '_rightContentView': 448}), ('_UIInputViewContent', '21', {'_inputView': 432})]:
    block = re.search(r'CLASS ' + name + r' superclassSize=416 size=\d+\nstrong: ([\da-f ]+)\nweak:\n(.*?)(?=CLASS|\Z)', metadata, re.S)
    assert block and block[1].strip() == layout
    cursor, strong = 416, []
    for value in layout.split():
        value = int(value, 16); cursor += 8 * (value >> 4)
        strong.extend(range(cursor, cursor + 8 * (value & 15), 8)); cursor += 8 * (value & 15)
    assert all(offset in strong and f'{field} +{offset}' in block[2] for field, offset in fields.items())
plain = text('evidence/plain-uikit-closed-pointer.txt')
plain_addresses = [int(value, 16) for value in re.findall(r'0x[0-9a-f]+', plain)]
assert plain_addresses.count(0x10aca8780) >= 3 and 0x10ad1e840 in plain_addresses
assert '_inputView (UIInputView*): <UIInputView: 0x10aca8780>' in plain
assert '+432: __strong _inputView' in text('evidence/plain-uikit-strong-incoming-reference.txt')
for name in ['baseline', 'candidate']:
    excerpt = text('evidence/' + name + '-living-host-failures.txt')
    assert excerpt.count('error:') == 3 and 'PreviewInputView' in excerpt and 'KeyboardController' in excerpt and 'KeyboardEngine' in excerpt
assert not list(root.rglob('*.swift'))
if '--git' in sys.argv:
    for name, record in provenance.items():
        if record['kind'] == 'git-blob':
            assert subprocess.check_output(['git', 'show', record['commit'] + ':' + record['path']], cwd=root) == content(name)
    proof = json.loads(raw('source-proof.json'))
    for path, expected in proof['originalAppTests'].items():
        for commit in [proof['startingCommit'], proof['finalCommit']]:
            assert sha(subprocess.check_output(['git', 'show', commit + ':' + path], cwd=root)) == expected
    path = 'apps/keyboard-ios/AppTests/PreviewDocumentLifecycleCounterchecks.swift'
    assert sha(subprocess.check_output(['git', 'show', proof['originalCountercheckCommit'] + ':' + path], cwd=root)) == proof['originalAppTests'][path]
    for commit, record in proof['livingHostComparisonSource'].items():
        assert sha(subprocess.check_output(['git', 'show', commit + ':' + record['path']], cwd=root)) == record['sha256']
    assert subprocess.check_output(['git', 'diff', proof['startingCommit'], proof['finalCommit'], '--', 'apps/keyboard-ios/App', 'apps/keyboard-ios/PulpoKeyboardKit/Sources'], cwd=root) == b''
print(f'PASS: {len(manifest)} file hashes; pointer closure/strong layouts; 20/28 methods, 16 failed assertions; acceptance remains incomplete. No native replay.')
