#!/usr/bin/env python3
"""Replay revealed R12 cases in an external directory; never edit the checkout."""
import argparse
import hashlib
import importlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASELINE = {
    'en_US': '168c21378b29aa7fd37838aed910d64348b5267389abfd2dacd0598247cf1e64',
    'es': '66a256a487f451812ec53920b2a5f2dea9aafb77fbf8e50240a0b87d2729e7fb',
    'en_es': '93d2d22d58e7e753771dd0e29b19036d74a5ec7aeafba703724c24a93e581237',
}
REJECTED = '62d70c17513c7d84403942815c391a93bbf0dac004992bd98f0f2b4d31d7f210'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checkout', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--split', choices=['dev', 'heldout'], required=True)
    parser.add_argument('--variant', choices=['baseline', 'rejected'], required=True)
    args = parser.parse_args()
    checkout, output = args.checkout.resolve(), args.output.resolve()
    if output.is_relative_to(checkout) or output.is_relative_to(ROOT):
        raise ValueError('Choose an output directory outside the checkout and audit package')
    app = checkout / 'apps' / 'keyboard-ios'
    dirty = subprocess.check_output(
        ['git', '-C', str(checkout), 'status', '--porcelain', '--',
         'apps/keyboard-ios/PulpoKeyboardKit/Sources', 'apps/keyboard-ios/LanguageData',
         'apps/keyboard-ios/scripts'], text=True)
    if dirty:
        raise ValueError('Use a clean source/compiler/dictionary checkout')
    for language, expected in BASELINE.items():
        if digest(app / 'LanguageData' / f'{language}.pkdict') != expected:
            raise ValueError(f'Expected unchanged bundled input: {language}')
    output.mkdir(parents=True, exist_ok=False)  # Preserve every earlier attempt.
    data = output / 'data'
    data.mkdir()
    for language in BASELINE:
        shutil.copyfile(app / 'LanguageData' / f'{language}.pkdict', data / f'{language}.pkdict')
    if args.variant == 'rejected':
        # Apply the rejected policy only to a disposable compiler copy. Neither
        # the supplied checkout nor its bundled dictionary is modified.
        disposable = output / 'rejected-checkout'
        scripts = disposable / 'apps' / 'keyboard-ios' / 'scripts'
        scripts.mkdir(parents=True)
        for name in ['build_multilingual_data.py', 'build_language_data.py', 'build_validation_words.py']:
            shutil.copyfile(app / 'scripts' / name, scripts / name)
        subprocess.run(['git', 'apply', str(ROOT / 'rejected-compiler.patch')],
                       cwd=disposable, check=True)
        sys.path.insert(0, str(scripts))
        merge = importlib.import_module('build_multilingual_data').merge_dictionaries
        candidate = merge((data / 'en_US.pkdict').read_bytes(), (data / 'es.pkdict').read_bytes())
        if hashlib.sha256(candidate).hexdigest() != REJECTED:
            raise ValueError('Rejected resource did not reproduce its frozen hash')
        (data / 'en_es.pkdict').write_bytes(candidate)
    core = sorted((app / 'PulpoKeyboardKit' / 'Sources' / 'KeyboardCore').rglob('*.swift'))
    runner = output / 'runner'
    subprocess.run(['swiftc', '-O', '-parse-as-library', '-module-name', 'SuppressionAudit',
                    *map(str, core), str(ROOT / 'harness' / 'Runner.swift'), '-o', str(runner)], check=True)
    cases = ROOT / 'inputs' / f'{args.split}.json'
    paths = output / 'paths.json'
    subprocess.run([str(runner), 'freeze', str(cases), str(paths)], check=True)
    frozen = json.loads((ROOT / 'original' / ('harness-freeze.json' if args.split == 'dev'
                                          else 'heldout-reveal.json')).read_text())
    expected_paths = frozen['dev-paths.json'] if args.split == 'dev' else frozen['pathsSHA256']
    if digest(paths) != expected_paths:
        raise ValueError('Generated paths differ from the frozen paths; do not tune them')
    report = output / 'report.json'
    subprocess.run([str(runner), 'run', str(cases), str(data), str(paths), str(report)], check=True)
    revision = subprocess.check_output(['git', '-C', str(checkout), 'rev-parse', 'HEAD'], text=True).strip()
    metadata = dict(revision=revision, variant=args.variant, split=args.split,
                    sourceSHA256={str(path.relative_to(checkout)): digest(path) for path in core},
                    harnessSHA256=digest(ROOT / 'harness' / 'Runner.swift'),
                    inputSHA256=digest(cases), pathsSHA256=digest(paths),
                    resourceSHA256={language: digest(data / f'{language}.pkdict') for language in BASELINE})
    (output / 'replay-provenance.json').write_text(json.dumps(metadata, indent=2) + '\n')
    print(report)


if __name__ == '__main__':
    main()
