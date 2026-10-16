#!/usr/bin/env python3
"""Opt-in historical R15 replay using isolated source exports, never the checkout."""
import argparse
import io
import json
import os
import subprocess
import tarfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPOSITORY = HERE.parents[3]
AUDIT = HERE.parent / 'technical-preservation-r15'


def command(arguments, *, cwd, log, env=None):
    with log.open('wb') as stream:
        result = subprocess.run(arguments, cwd=cwd, env=env, stdout=stream, stderr=subprocess.STDOUT)
    if result.returncode:
        raise RuntimeError(f'{arguments[0]} exited {result.returncode}; {log}\n' + log.read_text(errors='replace')[-8000:])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True, help='New external directory retaining source exports/builds/reports')
    args = parser.parse_args()
    output = args.output.expanduser().resolve()
    if output.exists() or output.is_relative_to(REPOSITORY):
        parser.error('--output must be a new directory outside this repository')
    subprocess.run(['python3', str(HERE / 'validate.py')], check=True)
    base = json.loads((AUDIT / 'candidate-freeze.json').read_text())['baseCommit']
    archive = subprocess.check_output(['git', 'archive', base, 'apps/keyboard-ios'], cwd=REPOSITORY)
    output.mkdir(parents=True)
    (output / 'identity.json').write_text(json.dumps({'base': base, 'candidate': 'base plus archived rejected-policy.patch', 'classification': 'exposed historical reproduction, not blind'}, indent=2) + '\n')
    for version in ('baseline', 'candidate'):
        checkout = output / (version + '-source')
        checkout.mkdir()
        with tarfile.open(fileobj=io.BytesIO(archive)) as stream:
            stream.extractall(checkout, filter='data')
        if version == 'candidate':
            patch = str(HERE / 'rejected-artifacts/rejected-policy.patch')
            command(['git', 'apply', '--check', patch], cwd=checkout, log=output / 'patch-check.log')
            command(['git', 'apply', patch], cwd=checkout, log=output / 'patch-apply.log')
        package = checkout / 'apps/keyboard-ios/PulpoKeyboardKit'
        runner = package / 'Tests/KeyboardCoreTests/TechnicalPreservationReplayTests.swift'
        runner.write_bytes((HERE / 'rejected-artifacts/TechnicalPreservationReplayTests.swift.txt').read_bytes())
        for index, split in enumerate(('development', 'heldout', 'post-review')):
            cases = HERE / 'post-review-diagnostic/cases.json' if split == 'post-review' else AUDIT / (split + '.json')
            report = output / (version + '-' + split + '.json')
            env = dict(os.environ, PK_R15_CASES=str(cases), PK_R15_REPORT=str(report))
            arguments = ['swift', 'test', '--package-path', str(package), '--scratch-path', str(output / (version + '-build')), '-c', 'release', '--filter', 'TechnicalPreservationReplayTests']
            if index:
                arguments.append('--skip-build')
            command(arguments, cwd=checkout, env=env, log=output / (version + '-' + split + '.log'))
            if not report.is_file():
                raise RuntimeError('Replay returned without producing ' + str(report))
    print('Historical replay complete:', output)
    print('No tracked source was patched. Outputs do not replace frozen evidence or establish blind gains.')


if __name__ == '__main__':
    main()
