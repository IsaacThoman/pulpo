"""Temporary-copy integrity probes only; no product/runtime benchmark execution."""
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
packet = Path(sys.argv[1]).resolve()
repo = Path(sys.argv[2]).resolve()
helper = HERE / 'verify-inactive-candidate-parent.py'
manifest = json.loads((packet / 'candidate-source-manifest.json').read_text())
records = []


def snapshot(root):
    return {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in root.rglob('*') if p.is_file()}


def run(name, source, baseline, optimized, expected, env_only=False):
    cmd = [sys.executable] + (['-O'] if optimized else []) + [str(helper)]
    env = os.environ.copy()
    if env_only:
        env['R40_PACKET'] = str(source)
    else:
        cmd += ['--packet', str(source)]
        env.pop('R40_PACKET', None)
    if baseline:
        cmd += ['--check-baseline', '--baseline-root', str(baseline)]
    before = snapshot(source)
    before_base = snapshot(baseline) if baseline else None
    result = subprocess.run(cmd, cwd='/tmp', env=env, capture_output=True, text=True)
    if (result.returncode == 0) != expected:
        raise RuntimeError(name + ': unexpected exit ' + str(result.returncode) + result.stderr)
    if before != snapshot(source) or (baseline and before_base != snapshot(baseline)):
        raise RuntimeError(name + ': checker wrote input files')
    records.append({'name': name, 'optimized': optimized, 'exit': result.returncode,
                    'stdout': result.stdout.strip(), 'stderr': result.stderr.strip(),
                    'inputFilesUnchanged': True})


with tempfile.TemporaryDirectory(prefix='r40-derived-probes-') as temp:
    temp = Path(temp)
    original = temp / 'original-packet'
    original.mkdir()
    names = [line.split('  ', 1)[1] for line in (packet/'audit-files.sha256').read_text().splitlines()]
    for name in names + ['audit-files.sha256']:
        target = original / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(packet/name, target)
    baseline = temp / 'standalone-baseline'
    baseline.mkdir()
    for entry in manifest['files']:
        if entry['baselineSHA256'] is not None:
            target = baseline / entry['path']
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(repo/entry['path'], target)
    archive = original / manifest['files'][0]['archive']
    archive_bytes = archive.read_bytes()
    before_image = baseline / manifest['files'][0]['path']
    before_bytes = before_image.read_bytes()
    new_file = baseline / manifest['files'][3]['path']
    for optimized in (False, True):
        run('standalone-portable-env', original, None, optimized, True, env_only=True)
        run('standalone-before-images-and-git-check', original, baseline, optimized, True)
        archive.write_bytes(archive_bytes + b'\nCORRUPTED\n')
        run('corrupted-retained-candidate', original, None, optimized, False)
        archive.write_bytes(archive_bytes)
        before_image.write_bytes(before_bytes + b'\nCORRUPTED\n')
        run('changed-before-image', original, baseline, optimized, False)
        before_image.write_bytes(before_bytes)
        before_image.unlink()
        run('missing-before-image', original, baseline, optimized, False)
        before_image.write_bytes(before_bytes)
        new_file.parent.mkdir(parents=True, exist_ok=True)
        new_file.write_bytes(b'unexpected existing candidate test')
        run('must-be-absent-new-file-present', original, baseline, optimized, False)
        new_file.unlink()
        archived = archive.read_bytes()
        archive.unlink()
        archive.symlink_to(packet/manifest['files'][0]['archive'])
        run('symlinked-candidate-archive', original, None, optimized, False)
        archive.unlink()
        archive.write_bytes(archived)
        raw_manifest = (original/'candidate-source-manifest.json').read_bytes()
        mutated = json.loads(raw_manifest)
        mutated['files'][0]['archive'] = '../escape.txt'
        (original/'candidate-source-manifest.json').write_text(json.dumps(mutated))
        run('mutated-unsafe-manifest', original, None, optimized, False)
        (original/'candidate-source-manifest.json').write_bytes(raw_manifest)
        run('git-subdirectory-baseline-root', original, repo/'apps', optimized, False)
print(json.dumps({'classification': 'derived verifier integrity probes, not runtime replay',
                  'checks': len(records), 'passesExpected': sum(r['exit']==0 for r in records),
                  'rejectionsExpected': sum(r['exit']!=0 for r in records),
                  'records': records}, indent=2))
