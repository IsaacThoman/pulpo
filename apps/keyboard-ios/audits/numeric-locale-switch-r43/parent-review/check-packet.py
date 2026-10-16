#!/usr/bin/env python3
"""Verify packet bytes only; no source, app, schema or execution validation."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import re

ROOT = Path(__file__).resolve().parent

def require(condition, message):
    if not condition:
        raise ValueError(message)

def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'Duplicate manifest key: ' + key)
        result[key] = value
    return result

def main():
    manifest_path = ROOT / 'manifest.json'
    require(manifest_path.is_file() and not manifest_path.is_symlink(), 'Manifest must be a local regular file')
    manifest = json.loads(manifest_path.read_bytes(), object_pairs_hook=unique_object)
    require(type(manifest) is dict and set(manifest) == {'version', 'scope', 'files'}, 'Manifest fields')
    require(type(manifest['version']) is int and manifest['version'] == 1, 'Manifest version')
    require(manifest['scope'] == 'packet-bytes-only', 'Manifest scope')
    require(type(manifest['files']) is list and manifest['files'], 'Manifest inventory')
    expected, total = set(), 0
    for item in manifest['files']:
        require(type(item) is dict and set(item) == {'path', 'bytes', 'sha256'}, 'File entry fields')
        name = item['path']
        require(type(name) is str and name and '\\' not in name, 'Path type')
        path = PurePosixPath(name)
        require(not path.is_absolute() and '..' not in path.parts and path.as_posix() == name,
                'Unsafe or noncanonical path: ' + name)
        require(name != 'manifest.json' and name not in expected, 'Duplicate or self entry: ' + name)
        expected.add(name)
        require(type(item['bytes']) is int and item['bytes'] >= 0, 'Byte count: ' + name)
        require(type(item['sha256']) is str and re.fullmatch('[0-9a-f]{64}', item['sha256']) is not None,
                'Digest format: ' + name)
        target = ROOT.joinpath(*path.parts)
        component = ROOT
        for part in path.parts:
            component = component / part
            require(not component.is_symlink(), 'Symlink: ' + name)
        require(target.is_file(), 'Missing regular file: ' + name)
        raw = target.read_bytes()
        require(len(raw) == item['bytes'], 'Size mismatch: ' + name)
        require(hashlib.sha256(raw).hexdigest() == item['sha256'], 'Hash mismatch: ' + name)
        total += len(raw)
    actual = set()
    for path in ROOT.rglob('*'):
        require(not path.is_symlink(), 'Symlink in packet: ' + str(path.relative_to(ROOT)))
        if path.is_file():
            actual.add(path.relative_to(ROOT).as_posix())
        else:
            require(path.is_dir(), 'Nonregular packet entry')
    require(actual == expected | {'manifest.json'}, 'Packet inventory mismatch')
    print(json.dumps({'scope': 'packet-bytes-only', 'files': len(expected), 'verifiedBytes': total}, sort_keys=True))

if __name__ == '__main__':
    main()
