import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class ProductionDeploymentTests(unittest.TestCase):
    def run_deployment(self, fail_on="", duplicate=False, remove_orphans=False):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            shutil.copy(Path(__file__).with_name("deploy-production.sh"), root)
            (root / "coolify").write_text(
                '#!/bin/bash\nset -eu\n'
                'if [[ "$2" == "get" ]]; then\n'
                '  echo \'{"build_pack":"dockerfile","health_check_enabled":true}\'\n'
                'else\n'
                '  echo "[{\\"key\\":\\"COMPOSE_REMOVE_ORPHANS\\",\\"value\\":\\"$ORPHANS\\"}]"\n'
                'fi\n'
            )
            (root / "coolify").chmod(0o755)
            (root / "curl").write_text(
                '#!/bin/bash\nset -eu\n'
                'echo "[{\\"key\\":\\"COMPOSE_REMOVE_ORPHANS\\",\\"value\\":\\"$ORPHANS\\"}]"\n'
            )
            (root / "curl").chmod(0o755)
            (root / "deploy-coolify-commit.sh").write_text(
                '#!/bin/bash\nset -eu\n'
                'echo "deploy $COOLIFY_APP_UUID $1" >> "$TRACE"\n'
                'echo "deployment_uuid=$COOLIFY_APP_UUID" >> "$GITHUB_OUTPUT"\n'
            )
            (root / "wait-coolify-deployment.sh").write_text(
                '#!/bin/bash\nset -eu\n'
                'echo "wait $1" >> "$TRACE"\n'
                '[[ "$1" != "$FAIL_ON" ]]\n'
            )
            trace = root / "trace"
            result = subprocess.run(
                ["bash", str(root / "deploy-production.sh"), "a" * 40],
                env={**os.environ, "COOLIFY_APP_UUID": "api",
                     "COOLIFY_URL": "https://coolify.example.invalid", "COOLIFY_TOKEN": "test-token",
                     "COOLIFY_WORKER_APP_UUID": "api" if duplicate else "worker",
                     "COOLIFY_WEB_APP_UUID": "web", "FAIL_ON": fail_on,
                     "ORPHANS": "1" if remove_orphans else "false",
                     "PATH": str(root) + os.pathsep + os.environ["PATH"],
                     "TRACE": str(trace)}, capture_output=True, text=True,
            )
            return result.returncode, trace.read_text().splitlines() if trace.exists() else []

    def test_rolls_out_one_release_in_dependency_order(self):
        status, events = self.run_deployment()
        self.assertEqual(status, 0)
        self.assertEqual(events, [event for name in ["api", "worker", "web"]
                                 for event in [f"deploy {name} {'a' * 40}", f"wait {name}"]])

    def test_failed_migration_or_api_health_prevents_worker_and_web_deploy(self):
        status, events = self.run_deployment(fail_on="api")
        self.assertNotEqual(status, 0)
        self.assertEqual(events, [f"deploy api {'a' * 40}", "wait api"])

    def test_failed_worker_prevents_frontend_deploy(self):
        status, events = self.run_deployment(fail_on="worker")
        self.assertNotEqual(status, 0)
        self.assertEqual(events[-1], "wait worker")
        self.assertFalse(any("deploy web" in event for event in events))

    def test_rejects_accidental_shared_application_ids_before_deploying(self):
        status, events = self.run_deployment(duplicate=True)
        self.assertNotEqual(status, 0)
        self.assertEqual(events, [])

    def test_rejects_orphan_removal_before_deploying(self):
        status, events = self.run_deployment(remove_orphans=True)
        self.assertNotEqual(status, 0)
        self.assertEqual(events, [])


if __name__ == "__main__":
    unittest.main()
