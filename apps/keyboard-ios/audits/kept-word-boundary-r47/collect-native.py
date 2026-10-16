#!/usr/bin/env python3
"""Bind serial xcresult exports to their actual run; never rewrite observations."""
import hashlib, json, pathlib, shutil, sys, tarfile

audit = pathlib.Path(__file__).resolve().parent
attempt, version = sys.argv[1:3]
if not attempt.isalnum() or not version.isalnum():
    raise SystemExit('invalid attempt/version')
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
run_path = audit / ('native-run-' + attempt + '.json')
run = json.loads(run_path.read_text())
build_path = audit / ('native-build-' + version + '-receipt.json')
build = json.loads(build_path.read_text())
if run['exit'] != 0 or run['status'] != 'PASS' or run['sources'] != run['sourcesAfter'] or run['binaries'] != run['binariesAfter'] or run['buildReceiptSHA256'] != sha(build_path) or run['sources'] != build['sources'] or run['builtResources'] != build['builtResources']:
    raise SystemExit('failed/stale run or build')
directory = pathlib.Path('/tmp/pulpo-r47-native/attachments-' + attempt)
manifest = json.loads((directory / 'manifest.json').read_text())
rows = []
for group in manifest:
    for entry in group['attachments']:
        filename = entry['exportedFileName']
        if pathlib.Path(filename).name != filename or entry['deviceId'] != run['uuid']:
            raise SystemExit('unexpected attachment path/device')
        name = entry['suggestedHumanReadableName'].split('_0_', 1)[0]
        payload = json.loads((directory / filename).read_text())
        expected = ('r47-second-' if name.startswith('r47-second-') else 'r47-') + payload['language'] + '-' + payload['route']
        if name != expected:
            raise SystemExit('attachment attribution mismatch')
        rows.append({'name': name, 'payload': payload})
output = audit / ('native-attachments-' + attempt + '.json')
with output.open('x') as stream:
    stream.write(json.dumps(rows, ensure_ascii=False, indent=2) + '\n')
shutil.copyfile(directory / 'manifest.json', audit / ('native-attachment-manifest-' + attempt + '.json'))
archives = {}
for source, filename, arcname in [
    (directory, 'native-attachments-export-' + attempt + '.tar.gz', 'attachments'),
    (pathlib.Path('/tmp/pulpo-r47-native/test-' + attempt + '.xcresult'), 'snapshots/native-xcresult-' + attempt + '.tar.gz', 'native.xcresult'),
]:
    target = audit / filename
    if target.exists():
        raise SystemExit('archive already retained')
    with tarfile.open(target, 'w:gz') as archive:
        archive.add(source, arcname=arcname)
    archives[filename] = sha(target)
receipt = {**run, 'buildSHA256': sha(build_path), 'summarySHA256': sha(audit / ('native-summary-' + attempt + '.json')), 'attachmentsSHA256': sha(output), 'buildLogSHA256': sha(audit / ('build-' + version + '.log.gz')), 'logSHA256': sha(audit / ('native-log-' + attempt + '.gz')), 'originalRunPath': run_path.name, 'originalRunSHA256': sha(run_path), 'testTreeSHA256': sha(audit / ('native-tests-' + attempt + '.json')), 'attachmentManifestSHA256': sha(audit / ('native-attachment-manifest-' + attempt + '.json')), 'rawArchives': archives, 'collectorSHA256': sha(pathlib.Path(__file__))}
with (audit / ('native-complete-run-' + attempt + '.json')).open('x') as stream:
    stream.write(json.dumps(receipt, indent=2) + '\n')
print('retained native envelopes', len(rows), 'original UUID', run['uuid'])
