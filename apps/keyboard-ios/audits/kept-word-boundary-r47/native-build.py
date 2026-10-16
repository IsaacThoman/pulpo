#!/usr/bin/env python3
"""Retain a generic simulator Release build, hashes and untouched raw logs."""
import datetime, gzip, hashlib, json, pathlib, subprocess, sys, tarfile

audit = pathlib.Path(__file__).resolve().parent
root = audit.parents[3]
base = root / 'apps/keyboard-ios'
version = sys.argv[1]
if not version.isalnum() or (audit / ('native-build-' + version + '-receipt.json')).exists():
    raise SystemExit('invalid/existing attempt')
files = sorted(set([*base.glob('PulpoKeyboardKit/Sources/**/*.swift'), *base.glob('App/**/*.swift'), *base.glob('AppTests/**/*.swift'), *base.glob('Extension/**/*.swift'), base / 'PulpoKeyboardKit/Package.swift', base / 'project.yml', base / 'PulpoKeyboard.xcodeproj/project.pbxproj']))
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
hashes = lambda: {str(p.relative_to(root)): sha(p) for p in files}
resources = {p.name: sha(p) for p in (base / 'LanguageData').glob('*.pkdict')}
output = pathlib.Path('/tmp/pulpo-r47-native')
command = ['xcodebuild', '-project', str(base / 'PulpoKeyboard.xcodeproj'), '-scheme', 'PulpoKeyboard', '-configuration', 'Release', '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', str(output / 'DerivedData'), 'ENABLE_TESTABILITY=YES', 'ONLY_ACTIVE_ARCH=YES', '-parallel-testing-enabled', 'NO', '-collect-test-diagnostics', 'never', '-only-testing:PulpoKeyboardAppTests/ExternalTextTouchR47Tests', 'build-for-testing']
receipt = {'command': command, 'sources': hashes(), 'resources': resources, 'started': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'scriptSHA256': sha(pathlib.Path(__file__))}
log = output / ('build-' + version + '.log')
with log.open('x') as stream:
    result = subprocess.run(command, stdout=stream, stderr=stream)
receipt.update(exit=result.returncode, sourcesAfter=hashes(), finished=datetime.datetime.now(datetime.timezone.utc).isoformat())
receipt['status'] = 'PASS' if result.returncode == 0 and receipt['sources'] == receipt['sourcesAfter'] else 'WHOLE_GATE_ERROR'
app = output / 'DerivedData/Build/Products/Release-iphonesimulator/PulpoKeyboard.app'
if result.returncode == 0:
    binaries = {'host': app / 'PulpoKeyboard', 'test': app / 'PlugIns/PulpoKeyboardAppTests.xctest/PulpoKeyboardAppTests'}
    receipt['binaries'] = {k: sha(p) for k, p in binaries.items()}
    for key, path in binaries.items():
        (audit / ('binaries/native-' + version + '-' + key + '.gz')).write_bytes(gzip.compress(path.read_bytes(), mtime=0))
    receipt['builtResources'] = {p.name: sha(p) for p in app.glob('PlugIns/PulpoKeyboardExtension.appex/*.pkdict')}
(audit / ('native-build-' + version + '-receipt.json')).write_text(json.dumps(receipt, indent=2) + '\n')
(audit / (log.name + '.gz')).write_bytes(gzip.compress(log.read_bytes(), mtime=0))
with tarfile.open(audit / ('snapshots/native-' + version + '-sources.tar.gz'), 'w:gz') as archive:
    for path in files:
        archive.add(path, arcname=str(path.relative_to(root)))
print('native build', version, 'exit', result.returncode)
if result.returncode:
    print(log.read_text()[-16000:])
sys.exit(result.returncode)
