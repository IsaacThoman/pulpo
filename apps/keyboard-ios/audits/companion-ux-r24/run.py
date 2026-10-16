#!/usr/bin/env python3
"""Serialized R24 simulator checks. Raw artifacts stay outside the checkout."""
import argparse
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import time

UUID = '1EDC5D9A-7E25-432A-B5B1-9A8B702306A7'
ROOT = Path(__file__).resolve().parents[4]
p = argparse.ArgumentParser()
p.add_argument('phase', choices=['live', 'regression', 'exposed', 'heldout'])
p.add_argument('--heldout', type=Path)
p.add_argument('--source', type=Path, default=ROOT)
p.add_argument('--output', type=Path, required=True)
p.add_argument('--derived-data', type=Path, default=Path('/tmp/pulpo-r24/native'))
a = p.parse_args()
if a.phase == 'heldout':
    if not a.heldout or hashlib.sha256(a.heldout.read_bytes()).hexdigest() != 'c9b6e19365547fc039e300f6e52baad50989d8029a9df017f85b284adae35ab5':
        p.error('heldout requires the original sealed corpus with its frozen SHA256')
a.output.mkdir(parents=True, exist_ok=True)
ready = a.output / 'ready'
ready.unlink(missing_ok=True)
subprocess.run(['xcrun', 'simctl', 'ui', UUID, 'content_size',
                'large' if a.phase == 'live' else 'accessibility-extra-extra-extra-large'], check=True)
subprocess.run(['python3', str(a.source / 'apps/keyboard-ios/scripts/simulator_keyboard.py'), UUID], check=True)
subprocess.run(['xcodegen', 'generate', '--spec', str(a.source / 'apps/keyboard-ios/project.yml')], check=True)
selectors = {
 'live': ['PulpoKeyboardAppTests/CompanionDynamicTypeR24Tests'],
 'regression': ['PulpoKeyboardAppTests/CompanionWorkflowR24Tests',
                'PulpoKeyboardAppTests/DraftEditorTests', 'PulpoKeyboardUITests/CompanionUXR24Tests'],
 'exposed': ['PulpoKeyboardAppTests/BroadExposedR24Tests'],
 'heldout': ['PulpoKeyboardUITests/HeldoutCompanionR24Tests'],
}[a.phase]
env = dict(os.environ, TEST_RUNNER_PK_R24_LIVE_DIR=str(a.output),
           TEST_RUNNER_PK_R24_REPORT=str(a.output / 'exposed-prefixes.json'),
           TEST_RUNNER_PK_SCREENSHOT_DIR=str(a.output))
if a.phase == 'heldout':
    env['TEST_RUNNER_PK_R24_HELDOUT'] = str(a.heldout)
    env['TEST_RUNNER_PK_R24_HELDOUT_REPORT'] = str(a.output / 'report.json')
cmd = ['xcodebuild', '-project', str(a.source / 'apps/keyboard-ios/PulpoKeyboard.xcodeproj'),
       '-scheme', 'PulpoKeyboard', '-destination', f'platform=iOS Simulator,id={UUID}',
       '-derivedDataPath', str(a.derived_data), '-resultBundlePath', str(a.output) + '.xcresult',
       '-parallel-testing-enabled', 'NO', '-collect-test-diagnostics', 'never']
cmd += ['-only-testing:' + name for name in selectors] + ['test']
with (a.output / 'build.txt').open('w') as log:
    process = subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT, env=env)
    if a.phase == 'live':
        limit = time.monotonic() + 300
        while process.poll() is None and not ready.exists() and time.monotonic() < limit:
            time.sleep(0.25)
        if ready.exists():
            subprocess.run(['xcrun', 'simctl', 'ui', UUID, 'content_size',
                            'accessibility-extra-extra-extra-large'], check=True)
            print('Actual system content_size changed after ready', flush=True)
        else:
            print('No live fixture ready marker; inspect failure after completion', flush=True)
    result = process.wait()
print(f'xcodebuild exit {result}; raw output: {a.output / "build.txt"}')
sys.exit(result)
