#!/usr/bin/env python3
"""Bind the independently approved packet; never run an Engine or judge review prose."""
import argparse, datetime, gzip, hashlib, importlib.util, json, pathlib, subprocess

audit = pathlib.Path(__file__).resolve().parent
root = audit.parents[3]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--oracle', type=pathlib.Path, required=True)
parser.add_argument('--input', type=pathlib.Path, default=audit / 'heldout.json')
parser.add_argument('--baseline', type=pathlib.Path, default=pathlib.Path('/tmp/pulpo-r47-baseline-v2/runner'))
parser.add_argument('--candidate', type=pathlib.Path, default=pathlib.Path('/tmp/pulpo-r47-candidate-v5/runner'))
args = parser.parse_args()
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
def module(name):
    spec = importlib.util.spec_from_file_location('r47_' + name, audit / (name + '.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result
gate, checker = module('freeze_gate'), module('check')
input_path = args.input.resolve()
oracle = args.oracle.resolve()
relative = lambda path: path.resolve().relative_to(root.resolve()).as_posix()
if (audit / 'final-freeze.json').exists() or (audit / 'seal-receipt.json').exists():
    raise SystemExit('seal already exists; preserve it')
packet = json.loads(input_path.read_bytes())
checker.preflight(packet)
# These approvals are selected by independent agent review. This script only
# verifies exact bindings; it cannot interpret or replace those decisions.
evidence = {
    'sourceReview': relative(audit / 'source-review-v5.md'),
    'evaluatorReview': relative(audit / 'evaluator-review-v7.md'),
    'oracleReview': relative(oracle),
    'authorNotes': relative(audit / 'author-notes.md'),
}
prior_path = audit / 'evaluator-freeze-v7.json'
prior = json.loads(prior_path.read_text())
for name, digest in prior.items():
    if sha(gate.safe(root, name)) != digest:
        raise SystemExit('admitted preauthor binding changed: ' + name)
paths = gate.required(root) | set(prior) | set(evidence.values()) | {
    relative(input_path), relative(pathlib.Path(__file__)), relative(prior_path),
    relative(audit / 'AUTHOR-BRIEF.md'), relative(audit / 'dependencies/manifest.json'),
    relative(audit / 'dependencies/r44-verbatim.tar.gz'),
    relative(audit / 'binaries/baseline-v2.gz'), relative(audit / 'binaries/candidate-v5.gz'),
    relative(audit / 'binaries/baseline-v2-source.tar.gz'), relative(audit / 'binaries/candidate-v5-source.tar.gz'),
}
for kind in gate.ADMISSIONS:
    record = json.loads((audit / gate.ADMISSIONS[kind]).read_text())
    paths |= {entry['path'] for entry in record['artifacts'].values()}
executables = {'baseline': sha(args.baseline), 'candidate': sha(args.candidate)}
for variant, archive in [('baseline', 'baseline-v2.gz'), ('candidate', 'candidate-v5.gz')]:
    if hashlib.sha256(gzip.decompress((audit / 'binaries' / archive).read_bytes())).hexdigest() != executables[variant]:
        raise SystemExit('portable executable mismatch: ' + variant)
resources = gate.admission.resources(root)
freeze = {'version': 1, 'inputSHA256': sha(input_path),
          'files': {name: sha(gate.safe(root, name)) for name in sorted(paths)},
          'executables': executables, 'resources': resources, 'evidence': evidence}
gate.verify(freeze, input_path, executables, resources, root)
with (audit / 'final-freeze.json').open('x') as output:
    output.write(json.dumps(freeze, indent=2) + '\n')
receipt = {'status': 'SEALED_UNEXECUTED', 'time': datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'HEAD': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip(),
           'inputSHA256': freeze['inputSHA256'], 'freezeSHA256': sha(audit / 'final-freeze.json'),
           'files': len(freeze['files']), 'cases': len(packet['cases']),
           'rowsPerVariant': sum(len(case['ops']) for case in packet['cases']),
           'scope': 'Bindings verified before one paired reveal; no executable invoked by sealing.'}
with (audit / 'seal-receipt.json').open('x') as output:
    output.write(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt))
