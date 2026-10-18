import importlib.util
from pathlib import Path
import plistlib
import tempfile
import unittest


SCRIPTS = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('keyboard_validate_archive', SCRIPTS / 'validate_archive.py')
validate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validate)


class ArchiveValidationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.archive = self.root / 'PulpoKeyboard.xcarchive'
        self.app = self.archive / 'Products/Applications/PulpoKeyboard.app'
        self.extension = self.app / 'PlugIns/PulpoKeyboardExtension.appex'
        self.extension.mkdir(parents=True)
        self.data = self.root / 'LanguageData'
        self.data.mkdir()
        self.write_info(self.app, {'CFBundleIdentifier': validate.deploy.APP_ID, 'CFBundleDisplayName': 'Pulpo Keyboard'})
        self.write_info(self.extension, {
            'CFBundleIdentifier': validate.deploy.EXTENSION_ID,
            'NSExtension': {'NSExtensionPointIdentifier': 'com.apple.keyboard-service'},
        })
        for bundle in (self.app, self.extension):
            (bundle / 'PrivacyInfo.xcprivacy').write_bytes(b'manifest')
        for name in ('emoji.json', 'en_US.pkdict'):
            (self.data / name).write_bytes(b'current data')
            (self.extension / name).write_bytes(b'current data')

    def write_info(self, bundle, info, version='0.159.0', build='1760000000'):
        with (bundle / 'Info.plist').open('wb') as stream:
            plistlib.dump({'CFBundleShortVersionString': version, 'CFBundleVersion': build, **info}, stream)

    def check(self):
        validate.validate_archive(self.archive, self.data, '0.159.0', '1760000000')

    def test_accepts_a_release_versioned_keyboard_archive(self):
        self.check()

    def test_rejects_an_extension_whose_version_does_not_match_the_release(self):
        self.write_info(self.extension, {
            'CFBundleIdentifier': validate.deploy.EXTENSION_ID,
            'NSExtension': {'NSExtensionPointIdentifier': 'com.apple.keyboard-service'},
        }, version='1.0', build='1')
        with self.assertRaisesRegex(RuntimeError, r'PulpoKeyboardExtension.appex is 1.0 \(1\), expected 0.159.0'):
            self.check()

    def test_rejects_a_bundle_without_its_privacy_manifest(self):
        for bundle in (self.app, self.extension):
            with self.subTest(bundle=bundle.name):
                (bundle / 'PrivacyInfo.xcprivacy').unlink()
                with self.assertRaisesRegex(RuntimeError, 'missing PrivacyInfo.xcprivacy'):
                    self.check()
                (bundle / 'PrivacyInfo.xcprivacy').write_bytes(b'manifest')

    def test_rejects_the_wrong_app_or_stale_language_data(self):
        (self.extension / 'en_US.pkdict').write_bytes(b'old data')
        with self.assertRaisesRegex(RuntimeError, 'stale keyboard data'):
            self.check()
        self.write_info(self.app, {'CFBundleIdentifier': 'com.isaacthoman.pulpo', 'CFBundleDisplayName': 'Pulpo'})
        with self.assertRaisesRegex(RuntimeError, 'other than Pulpo Keyboard'):
            self.check()


if __name__ == '__main__':
    unittest.main()
