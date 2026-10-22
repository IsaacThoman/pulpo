"""Exercise generated cache-watcher units with private files and unique unit names.

Requires root and host systemd. Never watches the real CNI cache, invokes the
production guard, or changes production units or firewall rules.
"""
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import time
import unittest

import test_guard_install as installer_tests


@unittest.skipUnless(os.geteuid() == 0 and Path('/run/systemd/system').is_dir(),
                     'requires root and host systemd')
class GuardSystemdTest(unittest.TestCase):
    def test_generated_watcher_recovers_late_and_subsequent_cache_writes(self):
        fixture = installer_tests.GuardInstallerTest()
        fixture.setUp()
        try:
            fixture.install()
            installer = installer_tests.installer
            path_text = installer.WATCH_UNIT.read_text()
            service_text = installer.RECONCILE_UNIT.read_text()
            original_cache = str(installer_tests.guard.CACHE)
            original_binary = str(installer.BINARY)
            original_service = installer.RECONCILE
        finally:
            fixture.doCleanups()

        with tempfile.TemporaryDirectory(prefix='pulpo-guard-watcher-qa-') as temporary:
            root = Path(temporary)
            cache = root / 'cache'
            cache.mkdir()
            output = root / 'observed.json'
            script = root / 'observe.py'
            script.write_text('from pathlib import Path\nimport json\n'
                              'cache=Path(' + repr(str(cache)) + ')\n'
                              'ids=sorted(json.loads(p.read_text())["id"] for p in cache.glob("*.json"))\n'
                              'Path(' + repr(str(output)) + ').write_text(json.dumps(ids))\n')
            name = 'pulpo-guard-watcher-qa-' + secrets.token_hex(5)
            path_unit = Path('/run/systemd/system') / (name + '.path')
            service_unit = path_unit.with_suffix('.service')
            # Keep the generated watch/retry/rate-limit semantics; replace only
            # the production cache/command and its production preconditions.
            path_text = path_text.replace(original_cache, str(cache)).replace(original_service, name + '.service')
            service_text = '\n'.join(line for line in service_text.splitlines()
                                     if not line.startswith('ConditionPathExists=')) + '\n'
            service_text = service_text.replace(original_binary + ' reload', sys.executable + ' ' + str(script))
            path_unit.write_text(path_text)
            service_unit.write_text(service_text)
            try:
                subprocess.run(['systemd-analyze', 'verify', str(path_unit), str(service_unit)], check=True)
                subprocess.run(['systemctl', 'daemon-reload'], check=True)
                subprocess.run(['systemctl', 'start', name + '.path'], check=True)
                for number in [1, 2]:
                    # The old ADD completes only after the watcher is active.
                    (cache / ('late-' + str(number) + '.json')).write_text(json.dumps({'id': number}))
                    deadline = time.monotonic() + 10
                    while time.monotonic() < deadline:
                        try:
                            observed = json.loads(output.read_text())
                        except (FileNotFoundError, json.JSONDecodeError):
                            observed = []
                        if observed == list(range(1, number + 1)):
                            break
                        time.sleep(0.1)
                    else:
                        self.fail('generated watcher missed a late cache write')
            finally:
                subprocess.run(['systemctl', 'stop', name + '.path', name + '.service'], check=True)
                path_unit.unlink(missing_ok=True)
                service_unit.unlink(missing_ok=True)
                subprocess.run(['systemctl', 'daemon-reload'], check=True)


if __name__ == '__main__':
    unittest.main()
