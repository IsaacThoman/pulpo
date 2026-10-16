#!/usr/bin/env python3
"""One frozen paired execution; never retries a completed product run."""
import argparse
import hashlib
import json
import shutil
import subprocess
import tarfile
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument('freeze', type=Path)
ap.add_argument('root', type=Path)
args = ap.parse_args()
audit = Path(__file__).resolve().parent
freeze = json.loads(args.freeze.read_text())

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

# Freeze references are relative to this audit, making retained artifacts portable.
for relative, expected in freeze['files'].items():
    if sha(audit / relative) != expected:
        raise SystemExit('Freeze hash mismatch: ' + relative)
args.root.mkdir(parents=True, exist_ok=False)
records = []
(args.root / 'execution-start.json').write_text(json.dumps({'freezeSHA256': sha(args.freeze), 'versions': freeze['versions'], 'productRunsPerVersion': 1}, indent=2) + '\n')
for version in freeze['versions']:
    work = args.root / version['name']
    work.mkdir()
    archive = work / 'core-source.tar.gz'
    shutil.copyfile(audit / version['archive'], archive)
    with tarfile.open(archive) as tf:
        for member in tf.getmembers():
            destination = (work / member.name).resolve()
            if work.resolve() not in destination.parents or member.issym() or member.islnk():
                raise SystemExit('Unsafe source archive')
        tf.extractall(work)
    core = work / 'apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardCore'
    source_hashes = {str(f.relative_to(core)): sha(f) for f in sorted(core.rglob('*.swift'))}
    if source_hashes != version['coreSources']:
        raise SystemExit('Committed source mismatch: ' + version['name'])
    package = work / 'PulpoKeyboardKit'
    package.mkdir()
    shutil.copytree(core, package / 'Sources/KeyboardCore')
    (package / 'Package.swift').write_text('// swift-tools-version: 6.2\nimport PackageDescription\nlet package = Package(name: "PulpoKeyboardKit", platforms: [.macOS(.v15)], products: [.library(name: "KeyboardCore", targets: ["KeyboardCore"])], targets: [.target(name: "KeyboardCore")])\n')
    client = work / 'client'
    sources = client / 'Sources/BoundaryRunner'
    sources.mkdir(parents=True)
    shutil.copyfile(audit / freeze['runner'], sources / freeze['entrypointFileName'])
    (client / 'Package.swift').write_text('// swift-tools-version: 6.2\nimport PackageDescription\nlet package = Package(name: "BoundaryClient", platforms: [.macOS(.v15)], dependencies: [.package(path: ' + json.dumps(str(package)) + ')], targets: [.executableTarget(name: "BoundaryRunner", dependencies: [.product(name: "KeyboardCore", package: "PulpoKeyboardKit")])])\n')
    build_argv = ['swift', 'build', '-c', 'release', '--package-path', str(client)]
    with (work / 'build.log').open('wb') as out:
        build = subprocess.run(build_argv, stdout=out, stderr=subprocess.STDOUT)
    record = {'name': version['name'], 'commit': version['commit'], 'coreSources': source_hashes,
              'buildExit': build.returncode, 'buildArgv': build_argv, 'successfulBuildLogRead': False,
              'runnerSHA256': sha(sources / freeze['entrypointFileName']), 'productExecutions': 0}
    if build.returncode == 0:
        binary = client / '.build/release/BoundaryRunner'
        run_argv = [str(binary), str((audit / freeze['input']).resolve()), str(work / 'case-output')]
        cwd = work / 'empty-cwd'
        cwd.mkdir()
        # Capture every exit/stdout/stderr, including failure, without rerunning.
        run = subprocess.run(run_argv, cwd=cwd, capture_output=True)
        (work / 'runner.stdout').write_bytes(run.stdout)
        (work / 'runner.stderr').write_bytes(run.stderr)
        record.update(productExecutions=1, binarySHA256=sha(binary), runArgv=run_argv,
                      runExit=run.returncode, stdoutSHA256=hashlib.sha256(run.stdout).hexdigest(),
                      stderrSHA256=hashlib.sha256(run.stderr).hexdigest(),
                      cwdFiles=sorted(str(f.relative_to(cwd)) for f in cwd.rglob('*')))
    records.append(record)
    (args.root / 'execution.json').write_text(json.dumps(records, indent=2) + '\n')
print(json.dumps([{k: v for k, v in r.items() if k != 'coreSources'} for r in records], indent=2))
