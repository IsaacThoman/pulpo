#!/usr/bin/env python3
"""Prepare immutable paired binaries, then execute once after a separate freeze.

No product run occurs in prepare. A run-start marker prevents retry after any
partial execution. This driver records transport; evaluators decide behavior.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import shutil
import subprocess
import tarfile

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def strict_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate JSON key: ' + key)
        result[key] = value
    return result

def read(path):
    return json.loads(path.read_text(), object_pairs_hook=strict_object,
        parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))

def write(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')

def inside(base, relative):
    pure = PurePosixPath(relative)
    if pure.is_absolute() or '..' in pure.parts:
        raise ValueError('Unsafe relative path')
    value = (base / relative).resolve()
    value.relative_to(base.resolve())
    return value

def unpack(archive, destination):
    with tarfile.open(archive) as source:
        for member in source.getmembers():
            inside(destination, member.name)
            if not (member.isdir() or member.isfile()):
                raise ValueError('Nonregular archive entry')
        source.extractall(destination, filter='data')

def swift_string(value):
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n') + '"'

def prepare(config_path, work, audit):
    config = read(config_path)
    work.mkdir(parents=False, exist_ok=False)
    shutil.copyfile(config_path, work / 'config.json')
    env = dict(os.environ, DEVELOPER_DIR='/Applications/Xcode.app/Contents/Developer')
    compiler = subprocess.check_output(['swift', '--version'], env=env, text=True).strip()
    bundle = config['author']
    archive = inside(audit, bundle['archive'])
    if digest(archive) != bundle['archiveSHA256']:
        raise ValueError('Author archive hash mismatch')
    unpack(archive, work / 'author')
    author = inside(work / 'author', bundle['root'])
    if not {'Runner.swift', 'fixtures.json', 'evaluate.py'} <= set(bundle['files']):
        raise ValueError('Missing required authored file binding')
    for name, expected in bundle['files'].items():
        if digest(inside(author, name)) != expected:
            raise ValueError('Author file hash mismatch: ' + name)
    runner = inside(author, 'Runner.swift')
    fixtures = inside(author, 'fixtures.json')
    records = []
    for version in config['versions']:
        directory = inside(work, version['name'])
        directory.mkdir()
        source_archive = inside(audit, version['archive'])
        if digest(source_archive) != version['archiveSHA256']:
            raise ValueError('Core archive hash mismatch')
        unpack(source_archive, directory)
        core = inside(directory, 'apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardCore')
        actual = {str(p.relative_to(directory)):digest(p) for p in core.rglob('*') if p.is_file()}
        if actual != version['files']:
            raise ValueError('Core source inventory/hash mismatch')
        package = directory / 'PulpoKeyboardKit'
        package.mkdir()
        shutil.copytree(core, package / 'Sources/KeyboardCore')
        (package / 'Package.swift').write_text('// swift-tools-version: 6.2\nimport PackageDescription\nlet package = Package(name: "PulpoKeyboardKit", platforms: [.macOS(.v15)], products: [.library(name: "KeyboardCore", targets: ["KeyboardCore"])], targets: [.target(name: "KeyboardCore")])\n')
        client = directory / 'client'
        sources = client / 'Sources/BoundaryRunner'
        sources.mkdir(parents=True)
        shutil.copyfile(runner, sources / 'Runner.swift')
        (client / 'Package.swift').write_text('// swift-tools-version: 6.2\nimport PackageDescription\nlet package = Package(name: "BoundaryClient", platforms: [.macOS(.v15)], dependencies: [.package(path: ' + swift_string(str(package)) + ')], targets: [.executableTarget(name: "BoundaryRunner", dependencies: [.product(name: "KeyboardCore", package: "PulpoKeyboardKit")])])\n')
        command = ['swift', 'build', '-c', 'release', '--package-path', str(client), '--product', 'BoundaryRunner', '-Xswiftc', '-parse-as-library']
        with (directory / 'build.log').open('wb') as log:
            result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, env=env, timeout=900)
        record = {'name':version['name'], 'buildExit':result.returncode, 'buildArgv':command,
            'successfulBuildLogRead':False, 'productExecutions':0}
        if result.returncode == 0:
            binary = client / '.build/release/BoundaryRunner'
            source_digest = hashlib.sha256(json.dumps(actual, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
            environment = {'compiler':compiler, 'architecture':platform.machine(),
                'productSourceSHA256':source_digest, 'runnerSHA256':digest(runner),
                'fixturesSHA256':digest(fixtures), 'versionLabel':version['name']}
            write(directory / 'environment.json', environment)
            record.update(binary=str(binary.relative_to(work)), binarySHA256=digest(binary),
                environment=str((directory / 'environment.json').relative_to(work)),
                environmentSHA256=digest(directory / 'environment.json'),
                sourceInventorySHA256=source_digest)
        records.append(record)
        write(work / 'prepared.json', {'configSHA256':digest(work/'config.json'),
            'driverSHA256':digest(Path(__file__)), 'compiler':compiler,
            'runnerSHA256':digest(runner), 'fixturesSHA256':digest(fixtures),
            'authorRoot':str(author.relative_to(work)), 'records':records})
    print(json.dumps({'stage':'prepared', 'versions':len(records),
        'allBuildsPass':all(r['buildExit']==0 for r in records),
        'productExecutions':0, 'preparedSHA256':digest(work/'prepared.json')}))
    if not all(r['buildExit']==0 for r in records):
        raise SystemExit(1)

def run(freeze_path, work):
    freeze = read(freeze_path)
    if freeze.get('verdict') != 'APPROVE_FOR_ONE_PAIRED_EXECUTION':
        raise ValueError('Final parent execution disposition missing')
    gates = freeze.get('gates', {})
    if set(gates) != {'authorSemanticReview', 'sourceComposition', 'ordinaryCore', 'nativeIntegration', 'executorReview'}:
        raise ValueError('Required final gate bindings missing')
    audit = Path(__file__).resolve().parent
    for gate in gates.values():
        if digest(inside(audit, gate['path'])) != gate['sha256']:
            raise ValueError('Final gate artifact hash mismatch')
    if digest(work/'prepared.json') != freeze['preparedSHA256']:
        raise ValueError('Prepared ledger mismatch')
    prepared = read(work/'prepared.json')
    if prepared['driverSHA256'] != digest(Path(__file__)) or prepared['configSHA256'] != digest(work/'config.json'):
        raise ValueError('Driver/config changed after preparation')
    if len(prepared['records']) != 2 or any(r['buildExit'] != 0 for r in prepared['records']):
        raise ValueError('Both paired builds must pass before either execution')
    author = inside(work, prepared['authorRoot'])
    if digest(author/'Runner.swift') != prepared['runnerSHA256'] or digest(author/'fixtures.json') != prepared['fixturesSHA256']:
        raise ValueError('Runner/input changed after preparation')
    for record in prepared['records']:
        if digest(inside(work, record['binary'])) != record['binarySHA256'] or digest(inside(work, record['environment'])) != record['environmentSHA256']:
            raise ValueError('Binary/environment changed after preparation')
    # Even a partial or interrupted invocation consumes this execution attempt.
    marker = os.open(work/'RUN-STARTED', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(marker, 'w') as stream:
        stream.write(digest(freeze_path) + '\n')
    records = []
    for record in prepared['records']:
        directory = inside(work, record['name'])
        cwd = directory/'empty-cwd'
        cwd.mkdir(exist_ok=False)
        command = [str(inside(work, record['binary'])), str(author/'fixtures.json'),
            str(directory/'raw.json'), str(inside(work, record['environment']))]
        item = {'name':record['name'], 'productAttempts':1, 'argv':command}
        records.append(item)
        write(work/'execution.json', records)
        try:
            result = subprocess.run(command, cwd=cwd, capture_output=True, timeout=300)
            (directory/'runner.stdout').write_bytes(result.stdout)
            (directory/'runner.stderr').write_bytes(result.stderr)
            item.update(exit=result.returncode, stdoutSHA256=digest(directory/'runner.stdout'),
                stderrSHA256=digest(directory/'runner.stderr'))
        except subprocess.TimeoutExpired as error:
            (directory/'runner.stdout').write_bytes(error.stdout or b'')
            (directory/'runner.stderr').write_bytes(error.stderr or b'')
            item.update(timeout=True, exit=None)
        item['rawSHA256'] = digest(directory/'raw.json') if (directory/'raw.json').exists() else None
        item['cwdFiles'] = sorted(str(p.relative_to(cwd)) for p in cwd.rglob('*'))
        write(work/'execution.json', records)
    print(json.dumps({'stage':'transport_complete', 'records':records,
        'behavioralAcceptance':'NOT decided by this driver'}))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage', choices=['prepare', 'run'])
    parser.add_argument('binding', type=Path, help='Config for prepare; final freeze for run')
    parser.add_argument('work', type=Path)
    args = parser.parse_args()
    work = args.work.resolve()
    if work.parent != Path('/tmp').resolve() or not work.name.startswith('pulpo-r48-'):
        raise ValueError('Work must be a fresh /tmp/pulpo-r48-* directory')
    if args.stage == 'prepare':
        prepare(args.binding.resolve(), work, Path(__file__).resolve().parent)
    else:
        run(args.binding.resolve(), work)

if __name__ == '__main__':
    main()
