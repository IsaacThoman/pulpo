#!/usr/bin/env python3
"""Execute an exposed witness against an immutable copied Core assembly."""
import gzip, hashlib, json, pathlib, subprocess, sys

audit = pathlib.Path(__file__).resolve().parent
root = audit.parents[3]
build = pathlib.Path(sys.argv[1])
witness = audit / sys.argv[2]
label = sys.argv[3]
if not label.replace('-', '').isalnum():
    raise SystemExit('invalid attempt label')
out = pathlib.Path('/tmp/pulpo-r47-' + label)
out.mkdir(exist_ok=False)
main = out / 'Witness.swift'
main.write_bytes(witness.read_bytes())
sources = sorted((build / 'sources/apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardCore').rglob('*.swift')) + [main]
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
command = ['swiftc', '-O', '-parse-as-library', *map(str, sources), '-o', str(out / 'runner')]
receipt = {'command': command, 'sources': {str(p): sha(p) for p in sources}}
with (out / 'compile.log').open('w') as stream:
    result = subprocess.run(command, stdout=stream, stderr=stream)
receipt['compileExit'] = result.returncode
if result.returncode:
    print((out / 'compile.log').read_text())
else:
    output = audit / (label + '.json')
    result = subprocess.run([str(out / 'runner'), str(root / 'apps/keyboard-ios/LanguageData'), str(output)], capture_output=True, text=True)
    receipt.update(exit=result.returncode, stderr=result.stderr, binarySHA256=sha(out / 'runner'))
    (audit / ('binaries/' + label + '.gz')).write_bytes(gzip.compress((out / 'runner').read_bytes(), mtime=0))
    print([{k: v for k, v in row.items() if k != 'offsets'} for row in json.loads(output.read_text())])
(audit / (label + '-process.json')).write_text(json.dumps(receipt, indent=2) + '\n')
sys.exit(result.returncode)
