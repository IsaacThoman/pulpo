import base64
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("upload-ios-testflight.sh")
CREDENTIALS = {
    "APP_STORE_CONNECT_API_ISSUER_ID": "issuer",
    "APP_STORE_CONNECT_API_KEY_ID": "KEY123",
    "APP_STORE_CONNECT_API_PRIVATE_KEY": "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----",
    "IOS_DEVELOPMENT_CERTIFICATE_P12_BASE64": base64.b64encode(b"certificate").decode(),
    "IOS_DEVELOPMENT_CERTIFICATE_PASSWORD": "certificate-password",
}


class TestFlightUploadTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.runner_temp = self.root / "runner"
        self.runner_temp.mkdir()
        self.trace = self.root / "trace"
        self.stub("openssl", 'echo keychain-password\n')
        self.stub("security", (
            'echo "security $*" >> "$TRACE"\n'
            'if [[ "$1" == find-identity && -z "${NO_IDENTITY:-}" ]]; then\n'
            '  echo \'  1) ABC "Apple Development: Pulpo CI (PX72AL9366)"\'\n'
            'fi\n'
        ))
        self.stub("xcodebuild", (
            'echo "xcodebuild $*" >> "$TRACE"\n'
            'while [[ $# -gt 0 ]]; do\n'
            '  case "$1" in\n'
            '    -authenticationKeyPath) cp "$2" "$CAPTURE/AuthKey.p8"; shift ;;\n'
            '    -archivePath) archive="$2"; shift ;;\n'
            '    -exportOptionsPlist) cp "$2" "$CAPTURE/ExportOptions.plist"; shift ;;\n'
            '    archive) [[ -z "${FAIL_ARCHIVE:-}" ]] || exit 65; mkdir -p "$archive" ;;\n'
            '  esac\n'
            '  shift\n'
            'done\n'
        ))
        self.capture = self.root / "capture"
        self.capture.mkdir()

    def stub(self, name, body):
        path = self.bin / name
        path.write_text("#!/usr/bin/env bash\nset -eu\n" + body)
        path.chmod(0o755)

    def run_upload(self, *arguments, **environment):
        result = subprocess.run(
            ["bash", str(SCRIPT), *arguments],
            env={**os.environ, **CREDENTIALS, "PULPO_APP_VERSION": "0.159.0",
                 "PULPO_IOS_BUILD_NUMBER": "1760000000", "RUNNER_TEMP": str(self.runner_temp),
                 "PATH": str(self.bin) + os.pathsep + os.environ["PATH"],
                 "TRACE": str(self.trace), "CAPTURE": str(self.capture), **environment},
            capture_output=True, text=True,
        )
        events = self.trace.read_text().splitlines() if self.trace.exists() else []
        return result, events

    def xcodebuild_calls(self, events):
        return [event.split(" ")[1:] for event in events if event.startswith("xcodebuild ")]

    def test_archives_and_uploads_with_the_selected_project_and_release_version(self):
        result, events = self.run_upload("--", "-workspace", "ios/Pulpo.xcworkspace", "-scheme", "Pulpo")
        self.assertEqual(result.returncode, 0, result.stderr)
        archive, export = self.xcodebuild_calls(events)
        work = archive[archive.index("-archivePath") + 1].removesuffix("/App.xcarchive")
        authentication = [
            "-allowProvisioningUpdates",
            "-authenticationKeyPath", f"{work}/AuthKey_KEY123.p8",
            "-authenticationKeyID", "KEY123",
            "-authenticationKeyIssuerID", "issuer",
        ]
        self.assertEqual(archive, [
            "-workspace", "ios/Pulpo.xcworkspace", "-scheme", "Pulpo",
            "-configuration", "Release", "-destination", "generic/platform=iOS",
            "-archivePath", f"{work}/App.xcarchive", *authentication,
            "DEVELOPMENT_TEAM=PX72AL9366", "MARKETING_VERSION=0.159.0",
            "CURRENT_PROJECT_VERSION=1760000000", "archive",
        ])
        self.assertEqual(export, [
            "-exportArchive", "-archivePath", f"{work}/App.xcarchive",
            "-exportOptionsPlist", f"{work}/ExportOptions.plist", *authentication,
        ])
        with (self.capture / "ExportOptions.plist").open("rb") as stream:
            self.assertEqual(plistlib.load(stream), {
                "method": "app-store-connect", "destination": "upload", "signingStyle": "automatic",
                "teamID": "PX72AL9366", "manageAppVersionAndBuildNumber": False,
                "testFlightInternalTestingOnly": False,
            })
        self.assertEqual((self.capture / "AuthKey.p8").read_text(), CREDENTIALS["APP_STORE_CONNECT_API_PRIVATE_KEY"])
        self.assertIn(f"security delete-keychain {work}/pulpo-signing.keychain-db", events)
        self.assertEqual(list(self.runner_temp.iterdir()), [])

    def test_validator_runs_on_the_archive_and_can_stop_the_upload(self):
        self.stub("validate", 'echo "validate $1" >> "$TRACE"\n[[ -z "${REJECT:-}" ]]\n')
        validator = str(self.bin / "validate")
        selection = ["--", "-project", "PulpoKeyboard.xcodeproj", "-scheme", "PulpoKeyboard"]

        result, events = self.run_upload("--validate", validator, *selection)
        self.assertEqual(result.returncode, 0, result.stderr)
        archive_call = self.xcodebuild_calls(events)[0]
        archive_path = archive_call[archive_call.index("-archivePath") + 1]
        self.assertEqual([event.split(" ")[0] for event in events if not event.startswith("security")],
                         ["xcodebuild", "validate", "xcodebuild"])
        self.assertIn(f"validate {archive_path}", events)

        self.trace.unlink()
        (self.capture / "ExportOptions.plist").unlink()
        result, events = self.run_upload("--validate", validator, *selection, REJECT="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len(self.xcodebuild_calls(events)), 1)
        self.assertFalse((self.capture / "ExportOptions.plist").exists())
        self.assertEqual(list(self.runner_temp.iterdir()), [])

    def test_missing_secret_fails_before_touching_the_keychain(self):
        result, events = self.run_upload("--", "-scheme", "Pulpo", IOS_DEVELOPMENT_CERTIFICATE_PASSWORD="")
        self.assertEqual(result.returncode, 1)
        self.assertIn("IOS_DEVELOPMENT_CERTIFICATE_PASSWORD GitHub environment secret is not configured", result.stderr)
        self.assertEqual(events, [])

    def test_missing_signing_identity_or_failed_archive_never_uploads(self):
        for environment in ({"NO_IDENTITY": "1"}, {"FAIL_ARCHIVE": "1"}):
            with self.subTest(environment=environment):
                if self.trace.exists():
                    self.trace.unlink()
                result, events = self.run_upload("--", "-scheme", "Pulpo", **environment)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(any("-exportArchive" in call for call in self.xcodebuild_calls(events)))
                self.assertTrue(any(event.startswith("security delete-keychain") for event in events))
                self.assertEqual(list(self.runner_temp.iterdir()), [])

    def test_requires_an_xcodebuild_selection(self):
        result, events = self.run_upload()
        self.assertEqual(result.returncode, 2)
        self.assertEqual(events, [])


if __name__ == "__main__":
    unittest.main()
