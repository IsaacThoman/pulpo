#!/usr/bin/env python3
"""Check a Pulpo Keyboard archive before it is uploaded to TestFlight."""

import importlib.util
import os
from pathlib import Path
import plistlib
import sys


SCRIPTS = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('keyboard_deploy', SCRIPTS / 'deploy-iphone.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


def validate_archive(archive, language_data, version, build):
    app = archive / 'Products/Applications/PulpoKeyboard.app'
    deploy.validate_app(app, language_data)
    for bundle in (app, app / 'PlugIns/PulpoKeyboardExtension.appex'):
        with (bundle / 'Info.plist').open('rb') as stream:
            info = plistlib.load(stream)
        actual = (info.get('CFBundleShortVersionString'), info.get('CFBundleVersion'))
        if actual != (version, build):
            raise RuntimeError(f'{bundle.name} is {actual[0]} ({actual[1]}), expected {version} ({build})')
        if not (bundle / 'PrivacyInfo.xcprivacy').is_file():
            raise RuntimeError(f'{bundle.name} is missing PrivacyInfo.xcprivacy')


def main():
    if len(sys.argv) != 2:
        print('Usage: validate_archive.py PulpoKeyboard.xcarchive', file=sys.stderr)
        return 2
    version = os.environ['PULPO_APP_VERSION']
    build = os.environ['PULPO_IOS_BUILD_NUMBER']
    validate_archive(Path(sys.argv[1]), SCRIPTS.parent / 'LanguageData', version, build)
    print(f'Validated Pulpo Keyboard {version} ({build}), its keyboard extension, and current language data.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
