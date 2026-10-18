import importlib.util
import os
from pathlib import Path
import plistlib
import subprocess
import tempfile
import unittest


SCRIPTS = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('keyboard_deploy', SCRIPTS / 'deploy-iphone.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeploymentTargetTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.app = self.root / 'PulpoKeyboard.app'
        self.extension = self.app / 'PlugIns/PulpoKeyboardExtension.appex'
        self.extension.mkdir(parents=True)
        self.data = self.root / 'LanguageData'
        self.data.mkdir()
        self.write_plist(self.app / 'Info.plist', {
            'CFBundleIdentifier': deploy.APP_ID, 'CFBundleDisplayName': 'Pulpo Keyboard',
        })
        self.write_plist(self.extension / 'Info.plist', {
            'CFBundleIdentifier': deploy.EXTENSION_ID,
            'NSExtension': {'NSExtensionPointIdentifier': 'com.apple.keyboard-service'},
        })
        for name in ('emoji.json', 'en_US.pkdict'):
            (self.data / name).write_bytes(b'current data')
            (self.extension / name).write_bytes(b'current data')

    def write_plist(self, path, value):
        with path.open('wb') as stream:
            plistlib.dump(value, stream)

    def test_accepts_current_standalone_keyboard_and_embedded_extension(self):
        deploy.validate_app(self.app, self.data)

    def test_rejects_main_pulpo_before_installation(self):
        self.write_plist(self.app / 'Info.plist', {
            'CFBundleIdentifier': 'com.isaacthoman.pulpo', 'CFBundleDisplayName': 'Pulpo',
        })
        with self.assertRaisesRegex(RuntimeError, 'other than Pulpo Keyboard'):
            deploy.validate_app(self.app, self.data)

    def test_rejects_wrong_or_missing_keyboard_extension(self):
        for info in [
            {'CFBundleIdentifier': 'com.isaacthoman.pulpo.extension'},
            {'CFBundleIdentifier': deploy.EXTENSION_ID, 'NSExtension': {}},
        ]:
            self.write_plist(self.extension / 'Info.plist', info)
            with self.assertRaisesRegex(RuntimeError, 'without the Pulpo Keyboard extension'):
                deploy.validate_app(self.app, self.data)
        (self.extension / 'Info.plist').unlink()
        with self.assertRaises(FileNotFoundError):
            deploy.validate_app(self.app, self.data)

    def test_rejects_stale_or_missing_emoji_data(self):
        for name in ('emoji.json', 'en_US.pkdict'):
            path = self.extension / name
            path.write_bytes(b'old data')
            with self.assertRaisesRegex(RuntimeError, 'stale keyboard data'):
                deploy.validate_app(self.app, self.data)
            path.unlink()
            with self.assertRaises(FileNotFoundError):
                deploy.validate_app(self.app, self.data)
            path.write_bytes(b'current data')

    def test_dispatches_explicit_target_without_falling_back_to_main_app(self):
        scripts = self.root / 'repo/apps/mobile/scripts'
        keyboard = self.root / 'repo/apps/keyboard-ios/scripts'
        scripts.mkdir(parents=True)
        keyboard.mkdir(parents=True)
        wrapper = scripts / 'deploy-iphone.sh'
        wrapper.write_text((SCRIPTS.parents[1] / 'mobile/scripts/deploy-iphone.sh').read_text())
        (scripts / 'deploy-iphone.py').write_text('print("MAIN APP")\n')
        (keyboard / 'deploy-iphone.py').write_text('print("KEYBOARD APP")\n')
        for target, expected in [('keyboard', 'KEYBOARD APP'), ('pulpo', 'MAIN APP')]:
            result = subprocess.run(['bash', str(wrapper)], env=dict(os.environ, PULPO_IOS_APP=target),
                                    capture_output=True, text=True, check=True)
            self.assertEqual(result.stdout.strip(), expected)
        result = subprocess.run(['bash', str(wrapper)], env=dict(os.environ, PULPO_IOS_APP='typo'),
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, '')
        (keyboard / 'deploy-iphone.py').unlink()
        result = subprocess.run(['bash', str(wrapper)], env=dict(os.environ, PULPO_IOS_APP='keyboard'),
                                capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('MAIN APP', result.stdout)


if __name__ == '__main__':
    unittest.main()
