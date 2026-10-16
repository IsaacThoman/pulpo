#!/usr/bin/env python3
"""Retain serial Release Swift test provenance without mutating older attempts."""
import datetime, gzip, hashlib, json, pathlib, subprocess, sys, tarfile

audit = pathlib.Path(__file__).resolve().parent
root = audit.parents[3]
version = sys.argv[1]
if not version.isalnum():
    raise SystemExit('invalid attempt')
receipt_path = audit / ('source-test-run-' + version + '.json')
if receipt_path.exists():
    raise SystemExit('attempt already retained')
package = root / 'apps/keyboard-ios/PulpoKeyboardKit'
files = sorted([*package.glob('Sources/**/*.swift'), *package.glob('Tests/**/*.swift'), package / 'Package.swift'])
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
hashes = lambda: {str(p.relative_to(root)): sha(p) for p in files}
resources = {p.name: sha(p) for p in (root / 'apps/keyboard-ios/LanguageData').glob('*.pkdict')}
xml_base = pathlib.Path('/tmp/pulpo-r47-ordinary-' + version + '.xml')
log = pathlib.Path('/tmp/pulpo-r47-ordinary-' + version + '.log')
command = ['swift', 'test', '--package-path', str(package), '--scratch-path', '/tmp/pulpo-r47-swift-tests', '-c', 'release', '--no-parallel', '--xunit-output', str(xml_base)]
receipt = {'command': command, 'started': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'sources': hashes(), 'resources': resources}
with log.open('x') as stream:
    result = subprocess.run(command, stdout=stream, stderr=stream)
receipt.update(exit=result.returncode, finished=datetime.datetime.now(datetime.timezone.utc).isoformat(), sourcesAfter=hashes())
receipt['status'] = 'PASS' if result.returncode == 0 and receipt['sources'] == receipt['sourcesAfter'] else 'WHOLE_GATE_ERROR'
xml = xml_base.with_name(xml_base.stem + '-swift-testing.xml')
binary = pathlib.Path('/tmp/pulpo-r47-swift-tests/out/Products/Release/KeyboardCoreTests.xctest/Contents/MacOS/KeyboardCoreTests')
if xml.exists():
    receipt['XMLSHA256'] = sha(xml)
    (audit / xml.name).with_suffix('.xml.gz').write_bytes(gzip.compress(xml.read_bytes(), mtime=0))
if binary.exists():
    receipt['binarySHA256'] = sha(binary)
    (audit / ('binaries/source-controls-' + version + '.gz')).write_bytes(gzip.compress(binary.read_bytes(), mtime=0))
receipt_path.write_text(json.dumps(receipt, indent=2) + '\n')
(audit / (log.name + '.gz')).write_bytes(gzip.compress(log.read_bytes(), mtime=0))
with tarfile.open(audit / ('snapshots/ordinary-' + version + '-sources.tar.gz'), 'w:gz') as archive:
    for path in files:
        archive.add(path, arcname=str(path.relative_to(root)))
print('ordinary', version, 'exit', result.returncode)
if result.returncode:
    print(log.read_text()[-14000:])
sys.exit(result.returncode)
