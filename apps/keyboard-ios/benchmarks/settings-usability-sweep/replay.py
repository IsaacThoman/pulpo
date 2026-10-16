#!/usr/bin/env python3
"""Replay the immutable settings contract on the exclusively assigned simulator.

Settings UI only: does not drive an editor or change hardware-keyboard state.
Serializes runs, restores this device's original content size, retains all outcomes.
"""
import argparse
import fcntl
import json
from pathlib import Path
import shutil
import subprocess

from compare import frozen_fixture

DEVICE = '7E1D7979-7307-4C53-8466-BB41154B383C'
PACKET = Path(__file__).resolve().parent
OUTPUT = Path('/tmp/pulpo-settings-usability-sweep')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checkout', type=Path, required=True)
    parser.add_argument('--label', required=True)
    args = parser.parse_args()
    if not args.label.replace('-', '').isalnum():
        parser.error('label must contain only letters, numbers and hyphens')
    checkout = args.checkout.resolve()
    OUTPUT.mkdir(exist_ok=True)
    with (OUTPUT / 'replay.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        frozen_fixture(PACKET)  # Always-on hash and full frozen-interface validation.
        executor = PACKET / 'SettingsUsabilityContractTests.swift'
        target = checkout / 'apps/keyboard-ios/UITests/SettingsUsabilityContractTests.swift'
        created = not target.exists()
        if target.exists() and target.read_bytes() != executor.read_bytes():
            raise RuntimeError('Refusing to overwrite a different executor')
        project = checkout / 'apps/keyboard-ios/PulpoKeyboard.xcodeproj'
        original_size = None
        bundle = OUTPUT / f'{args.label}.xcresult'
        log = OUTPUT / f'{args.label}.log'
        try:
            if created:
                shutil.copyfile(executor, target)
            shutil.copyfile(PACKET / 'heldout.json', OUTPUT / 'revealed.json')
            original_size = subprocess.check_output(['xcrun', 'simctl', 'ui', DEVICE, 'content_size'], text=True).strip()
            subprocess.run(['xcodegen', 'generate', '--spec', str(checkout / 'apps/keyboard-ios/project.yml')], check=True)
            subprocess.run(['xcrun', 'simctl', 'ui', DEVICE, 'content_size', 'accessibility-extra-extra-extra-large'], check=True)
            outcomes = OUTPUT / 'contract-outcomes.json'
            outcomes.unlink(missing_ok=True)
            command = ['xcodebuild', 'test', '-project', str(project), '-scheme', 'PulpoKeyboard', '-destination', f'platform=iOS Simulator,id={DEVICE}', '-derivedDataPath', str(OUTPUT / f'{args.label}-build'), '-parallel-testing-enabled', 'NO', '-collect-test-diagnostics', 'never', '-only-testing:PulpoKeyboardUITests/SettingsUsabilityContractTests', '-resultBundlePath', str(bundle)]
            with log.open('w') as stream:
                result = subprocess.run(command, stdout=stream, stderr=subprocess.STDOUT)
            if outcomes.exists():
                shutil.copyfile(outcomes, OUTPUT / f'{args.label}-outcomes.json')
            print(json.dumps({'exitCode': result.returncode, 'log': str(log), 'result': str(bundle), 'command': command}))
            # Raw logs are not read; a nonzero exit is reported for explicit diagnosis.
            raise SystemExit(result.returncode)
        finally:
            try:
                if original_size is not None:
                    subprocess.run(['xcrun', 'simctl', 'ui', DEVICE, 'content_size', original_size], check=True)
            finally:
                if created and target.exists():
                    target.unlink()
                    subprocess.run(['xcodegen', 'generate', '--spec', str(checkout / 'apps/keyboard-ios/project.yml')], check=True)


if __name__ == '__main__':
    main()
