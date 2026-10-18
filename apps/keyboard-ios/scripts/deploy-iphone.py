#!/usr/bin/env python3
"""Build and install the standalone Pulpo Keyboard app, never the Expo app."""

import fcntl
import hashlib
import os
from pathlib import Path
import plistlib
import re
import subprocess
import sys


APP_ID = 'com.isaacthoman.pulpo.keyboard'
EXTENSION_ID = APP_ID + '.extension'


def validate_app(app, language_data):
    with (app / 'Info.plist').open('rb') as stream:
        info = plistlib.load(stream)
    if info.get('CFBundleIdentifier') != APP_ID or info.get('CFBundleDisplayName') != 'Pulpo Keyboard':
        raise RuntimeError('Refusing to install an app other than Pulpo Keyboard')
    extension = app / 'PlugIns/PulpoKeyboardExtension.appex'
    with (extension / 'Info.plist').open('rb') as stream:
        info = plistlib.load(stream)
    if (info.get('CFBundleIdentifier') != EXTENSION_ID or
            info.get('NSExtension', {}).get('NSExtensionPointIdentifier') != 'com.apple.keyboard-service'):
        raise RuntimeError('Refusing to install without the Pulpo Keyboard extension')
    for name in ('emoji.json', 'en_US.pkdict'):
        expected = hashlib.sha256((language_data / name).read_bytes()).digest()
        actual = hashlib.sha256((extension / name).read_bytes()).digest()
        if actual != expected:
            raise RuntimeError(f'Refusing to install stale keyboard data: {name}')


def main():
    source = Path(__file__).resolve().parents[1]
    root = Path(os.environ.get('PULPO_KEYBOARD_IOS_BUILD_ROOT', '~/.cache/pulpo/keyboard-iphone-build')).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    device = os.environ.get('PULPO_IOS_DEVICE', 'Isaac iphone')
    configuration = os.environ.get('PULPO_IOS_CONFIGURATION', 'Release')
    if configuration not in ('Release', 'Debug'):
        raise ValueError('PULPO_IOS_CONFIGURATION must be Release or Debug')
    destination = ('id=' if re.fullmatch(r'[0-9A-Fa-f-]{16,}', device) else 'name=') + device
    log_path = Path(os.environ.get('PULPO_KEYBOARD_IOS_DEPLOY_LOG', '/tmp/pulpo-keyboard-ios-deploy.log')).expanduser()
    with (root / 'deploy.lock').open('a') as lock:
        print(f'Deploying Pulpo Keyboard {configuration} to {device}; waiting for its build lock…', flush=True)
        fcntl.flock(lock, fcntl.LOCK_EX)
        with log_path.open('w') as log:
            def run(arguments):
                print('+ ' + ' '.join(arguments), file=log, flush=True)
                subprocess.run(arguments, cwd=source, check=True, stdout=log, stderr=log,
                               pass_fds=(lock.fileno(),))

            try:
                print('Building the standalone PulpoKeyboard scheme…', flush=True)
                run(['xcodegen', 'generate'])
                run(['xcodebuild', '-project', 'PulpoKeyboard.xcodeproj', '-scheme', 'PulpoKeyboard',
                     '-configuration', configuration, '-destination', 'platform=iOS,' + destination,
                     '-derivedDataPath', str(root / 'DerivedData'), '-allowProvisioningUpdates',
                     '-allowProvisioningDeviceRegistration', 'build'])
                app = root / 'DerivedData/Build/Products' / (configuration + '-iphoneos') / 'PulpoKeyboard.app'
                validate_app(app, source / 'LanguageData')
                print(f'Validated {APP_ID}, its keyboard extension, and current language data. Installing…', flush=True)
                run(['xcrun', 'devicectl', 'device', 'install', 'app', '--device', device, str(app)])
                print('Installed Pulpo Keyboard. Launching its companion app…', flush=True)
                run(['xcrun', 'devicectl', 'device', 'process', 'launch', '--device', device, APP_ID])
            except (Exception, KeyboardInterrupt) as error:
                log.flush()
                print(f'Keyboard deployment failed: {error}. Log: {log_path}', file=sys.stderr)
                print(''.join(log_path.read_text(errors='replace').splitlines(keepends=True)[-80:]), file=sys.stderr)
                return error.returncode if isinstance(error, subprocess.CalledProcessError) else 1
    print(f'Deployed and launched Pulpo Keyboard {configuration} ({APP_ID}) on {device}.', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
