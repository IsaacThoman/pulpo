#!/usr/bin/env python3
"""Opt-in replay in exported temporary source trees; never patch the checkout."""
import argparse
import io
import json
import os
import subprocess
import tarfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPOSITORY = HERE.parents[3]
BASELINE = 'e1865f3fd1b034c5e157a34e3cd5654528af238c'
CORE = 'apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardCore'


def command(arguments, *, cwd, log, env=None):
    with log.open('wb') as output:
        process = subprocess.run(arguments, cwd=cwd, env=env, stdout=output, stderr=subprocess.STDOUT)
    if process.returncode:
        # Logs are read only after a command has failed.
        raise RuntimeError(f'{arguments[0]} exited {process.returncode}; {log}\n' + log.read_text(errors='replace')[-8000:])


def export(destination):
    archive = subprocess.check_output(['git', 'archive', BASELINE, 'apps/keyboard-ios'], cwd=REPOSITORY)
    destination.mkdir()
    with tarfile.open(fileobj=io.BytesIO(archive)) as stream:
        stream.extractall(destination, filter='data')


def link_client(scratch, destination, log):
    libraries = list(scratch.rglob('libKeyboardCore.a'))
    modules = list(scratch.rglob('KeyboardCore.swiftmodule'))
    if not modules:
        raise RuntimeError('No built KeyboardCore module found under ' + str(scratch))
    module = sorted(modules, key=lambda p: ('Products' not in p.parts and p.parent.name != 'Modules', len(p.parts)))[0]
    if libraries:
        library = sorted(libraries, key=lambda p: len(p.parts))[0]
        linkage = ['-L', str(library.parent), '-lKeyboardCore']
    else:
        # Standard SwiftPM may emit target objects rather than an automatic
        # library archive; its complete target object set is equivalent linkage.
        objects = sorted(p for p in scratch.rglob('*.o') if 'KeyboardCore.build' in p.parts)
        if not objects:
            raise RuntimeError('No KeyboardCore archive or target objects under ' + str(scratch))
        linkage = [str(p) for p in objects]
    command(['swiftc', '-O', '-I', str(module.parent), *linkage, str(HERE / 'diagnostic/Client.swift'), '-o', str(destination)], cwd=REPOSITORY, log=log)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True, help='New directory outside this repository; retains source exports/builds/results')
    args = parser.parse_args()
    output = args.output.expanduser().resolve()
    if output.exists() or output.is_relative_to(REPOSITORY):
        parser.error('--output must be a new directory outside the repository')
    baseline_tree = subprocess.check_output(['git', 'rev-parse', BASELINE + ':' + CORE], cwd=REPOSITORY, text=True).strip()
    if baseline_tree != '9461e76ced19b360c20449e42536a64ae0c8d4c4':
        raise RuntimeError('Published production core differs from recorded R11 baseline')
    subprocess.run(['python3', str(HERE / 'validate.py')], check=True)
    output.mkdir(parents=True)
    identity = {'baseline': BASELINE, 'coreTree': baseline_tree, 'candidate': 'published baseline plus rejected-artifacts/rejected-policy.patch', 'classification': 'reproduction of exposed historical evidence; not blind'}
    (output / 'identity.json').write_text(json.dumps(identity, indent=2) + '\n')
    for version in ['baseline', 'candidate']:
        checkout = output / (version + '-source')
        export(checkout)
        if version == 'candidate':
            patch = str(HERE / 'rejected-artifacts/rejected-policy.patch')
            command(['git', 'apply', '--check', patch], cwd=checkout, log=output / 'patch-check.log')
            command(['git', 'apply', patch], cwd=checkout, log=output / 'patch-apply.log')
        package = checkout / 'apps/keyboard-ios/PulpoKeyboardKit'
        runner = package / 'Tests/KeyboardCoreTests/TechnicalEntryBenchmarkTests.swift'
        runner.write_bytes((HERE / 'rejected-artifacts/TechnicalEntryBenchmarkTests.swift.txt').read_bytes())
        scratch = output / (version + '-build')
        for index, split in enumerate(['development', 'heldout', 'known-r10']):
            report = output / (version + '-' + split + '.json')
            environment = dict(os.environ, PK_TECHNICAL_CASES=str(HERE / 'inputs' / (split + '.json')), PK_TECHNICAL_REPORT=str(report))
            arguments = ['swift', 'test', '--package-path', str(package), '--scratch-path', str(scratch), '-c', 'release', '--filter', 'TechnicalEntryBenchmarkTests']
            if index:
                arguments.append('--skip-build')
            command(arguments, cwd=checkout, env=environment, log=output / (version + '-' + split + '.log'))
            if not report.is_file():
                raise RuntimeError('Benchmark returned without producing ' + str(report))
        client = output / (version + '-diagnostic-client')
        link_client(scratch, client, output / (version + '-link.log'))
        command([str(client), str(HERE / 'diagnostic/cases.json'), str(checkout / 'apps/keyboard-ios/LanguageData'), str(output / (version + '-diagnostic.json'))], cwd=checkout, log=output / (version + '-diagnostic.log'))
    print('Replay complete:', output)
    print('Original frozen oracles remain unchanged. New timing/output observations do not replace the archived run.')


if __name__ == '__main__':
    main()
