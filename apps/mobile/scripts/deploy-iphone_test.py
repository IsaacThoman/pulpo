#!/usr/bin/env python3
"""Exercise deployment orchestration with real Git worktrees and fake build tools."""

import fcntl
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest


SCRIPTS = Path(__file__).resolve().parent
FAKE_TOOL = '''#!/usr/bin/env python3
import hashlib, json, os, pathlib, sys, time
tool = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
cwd = pathlib.Path.cwd()
with open(os.environ['CALLS'], 'a') as calls:
    calls.write(json.dumps({'tool': tool, 'args': args, 'cwd': str(cwd)}) + '\\n')
if os.environ.get('HOLD_COMMAND') == tool + ' ' + ' '.join(args):
    pathlib.Path(os.environ['STARTED']).touch()
    while not pathlib.Path(os.environ['RELEASE']).exists():
        time.sleep(0.02)
if os.environ.get('FAIL_COMMAND') == tool + ' ' + ' '.join(args):
    print('intentional build failure')
    sys.exit(9)
if args == ['--version']:
    print('24.0.0')
elif tool == 'npm' and args[0] == 'ci':
    (cwd / 'node_modules').mkdir(exist_ok=True)
    (cwd / 'node_modules/.package-lock.json').write_text('{}')
elif tool == 'node':
    data = (cwd / 'app.config.ts').read_bytes() + os.environ['EXPO_PUBLIC_DEFAULT_INSTANCE_URL'].encode()
    print(hashlib.sha1(data).hexdigest())
elif tool == 'npx' and 'prebuild' in args:
    (cwd / 'ios/Pods').mkdir(parents=True, exist_ok=True)
    (cwd / 'ios/Podfile').write_text('generated')
    (cwd / 'ios/Pods/Manifest.lock').write_text('generated')
elif tool == 'npx' and 'run:ios' in args:
    (cwd / 'ios/build').mkdir(exist_ok=True)
    (cwd / 'ios/build/warm').write_text('compiled')
'''


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.source = self.directory / 'source worktree'
        self.source.mkdir()
        self.git('init', '-q')
        self.git('config', 'user.email', 'deploy-test@example.invalid')
        self.git('config', 'user.name', 'Deployment test')
        self.write('.gitignore', 'node_modules/\ndist/\napps/mobile/ios/\n.env*\n')
        self.write('package.json', '{"workspaces":["apps/*","packages/*"]}')
        self.write('package-lock.json', '{}')
        self.write('apps/mobile/package.json', '{"name":"@pulpo/mobile"}')
        self.write('apps/mobile/app.config.ts', 'native config')
        self.write('apps/mobile/screen.tsx', 'original source')
        self.write('apps/mobile/deleted.ts', 'remove me')
        for name in ('deploy-iphone.sh', 'deploy-iphone.py', 'iphone-native-fingerprint.cjs'):
            self.write('apps/mobile/scripts/' + name, (SCRIPTS / name).read_text())
        self.git('add', '.')
        self.git('commit', '-qm', 'test: seed deployment fixture')
        self.other = self.directory / 'another worktree'
        self.git('worktree', 'add', '-q', '--detach', str(self.other))
        binaries = self.directory / 'bin'
        binaries.mkdir()
        for tool in ('npm', 'npx', 'node', 'xcrun'):
            path = binaries / tool
            path.write_text(FAKE_TOOL)
            path.chmod(0o755)
        self.root = self.directory / 'stable build'
        self.checkout = self.root / 'checkout'
        self.calls = self.directory / 'calls.jsonl'
        self.log = self.directory / 'deploy.log'
        self.env = dict(os.environ, PATH=str(binaries) + os.pathsep + os.environ['PATH'],
                        PULPO_IOS_BUILD_ROOT=str(self.root), PULPO_IOS_DEPLOY_LOG=str(self.log),
                        CALLS=str(self.calls))

    def git(self, *args):
        return subprocess.run(['git', *args], cwd=self.source, check=True, capture_output=True)

    def write(self, name, content, source=None):
        path = (source or self.source) / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        return path

    def deploy(self, source=None, **environment):
        return subprocess.run(['bash', str((source or self.source) / 'apps/mobile/scripts/deploy-iphone.sh')],
                              env=dict(self.env, **environment), capture_output=True, text=True, timeout=20)

    def commands(self, tool, argument):
        return [call for call in map(json.loads, self.calls.read_text().splitlines())
                if call['tool'] == tool and argument in call['args']]

    def test_worktrees_share_outputs_and_sync_dirty_deleted_and_env_files(self):
        self.write('apps/mobile/screen.tsx', 'uncommitted edit')
        self.write('apps/mobile/new file.ts', 'untracked source')
        self.write('apps/mobile/.env.local', 'EXPO_PUBLIC_FIXTURE=one')
        self.write('apps/mobile/ios/should-not-copy', 'ignored native output')
        (self.source / 'apps/mobile/deleted.ts').unlink()
        result = self.deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.checkout / 'apps/mobile/screen.tsx').read_text(), 'uncommitted edit')
        self.assertTrue((self.checkout / 'apps/mobile/new file.ts').exists())
        self.assertTrue((self.checkout / 'apps/mobile/.env.local').exists())
        self.assertFalse((self.checkout / 'apps/mobile/deleted.ts').exists())
        self.assertFalse((self.checkout / 'apps/mobile/ios/should-not-copy').exists())
        self.assertFalse((self.checkout / '.git').exists())
        native_time = (self.checkout / 'apps/mobile/ios/Podfile').stat().st_mtime_ns
        config_time = (self.checkout / 'apps/mobile/app.config.ts').stat().st_mtime_ns
        os.utime(self.other / 'apps/mobile/app.config.ts', (1, 1))
        result = self.deploy(self.other)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.checkout / 'apps/mobile/screen.tsx').read_text(), 'original source')
        self.assertFalse((self.checkout / 'apps/mobile/new file.ts').exists())
        self.assertFalse((self.checkout / 'apps/mobile/.env.local').exists())
        self.assertTrue((self.checkout / 'apps/mobile/deleted.ts').exists())
        self.assertEqual((self.checkout / 'apps/mobile/app.config.ts').stat().st_mtime_ns, config_time)
        self.assertEqual((self.checkout / 'apps/mobile/ios/Podfile').stat().st_mtime_ns, native_time)
        self.assertEqual(len(self.commands('npm', 'ci')), 1)
        self.assertEqual(len(self.commands('npx', 'prebuild')), 1)
        self.assertEqual({call['cwd'] for call in self.commands('npx', 'run:ios')},
                         {str((self.checkout / 'apps/mobile').resolve())})

    def test_dependencies_native_config_and_environment_refresh(self):
        self.assertEqual(self.deploy().returncode, 0)
        self.write('package-lock.json', '{"changed":true}')
        self.assertEqual(self.deploy().returncode, 0)
        self.write('apps/mobile/app.config.ts', 'changed native config')
        self.assertEqual(self.deploy().returncode, 0)
        self.assertEqual(self.deploy(PULPO_INSTANCE_URL='https://example.test').returncode, 0)
        self.assertEqual(len(self.commands('npm', 'ci')), 2)
        self.assertEqual(len(self.commands('npx', 'prebuild')), 4)

    def test_failed_native_refresh_is_retried_even_after_reverting_source(self):
        self.assertEqual(self.deploy().returncode, 0)
        self.write('apps/mobile/app.config.ts', 'new native config')
        result = self.deploy(FAIL_COMMAND='npx --no-install expo prebuild --clean --platform ios')
        self.assertEqual(result.returncode, 9)
        self.assertIn('intentional build failure', result.stderr)
        self.assertFalse((self.root / 'native.sha256').exists())
        self.assertEqual(len(self.commands('xcrun', 'launch')), 1)
        self.assertEqual(self.deploy(self.other).returncode, 0)
        self.assertEqual(len(self.commands('npx', 'prebuild')), 3)

    def test_failed_dependency_install_is_retried(self):
        result = self.deploy(FAIL_COMMAND='npm ci --include=dev --no-audit --no-fund')
        self.assertEqual(result.returncode, 9)
        self.assertFalse((self.root / 'dependencies.sha256').exists())
        self.assertEqual(self.commands('xcrun', 'launch'), [])
        self.assertEqual(self.deploy().returncode, 0)

    def test_failed_build_does_not_launch_and_overrides_are_forwarded(self):
        command = 'npx --no-install expo run:ios --device Test phone --configuration Debug --no-bundler'
        result = self.deploy(PULPO_IOS_DEVICE='Test phone', PULPO_IOS_CONFIGURATION='Debug', FAIL_COMMAND=command)
        self.assertEqual(result.returncode, 9)
        self.assertIn('intentional build failure', result.stderr)
        self.assertEqual(self.commands('xcrun', 'launch'), [])

    def test_lock_blocks_sync_and_log_truncation_and_releases_after_exit(self):
        self.root.mkdir()
        self.log.write_text('active deployment log')
        with (self.root / 'deploy.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            process = subprocess.Popen(['bash', str(self.source / 'apps/mobile/scripts/deploy-iphone.sh')],
                                       env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                self.assertIn('Waiting for the deployment lock', process.stdout.readline())
                time.sleep(0.1)
                self.assertIsNone(process.poll())
                self.assertFalse(self.checkout.exists())
                self.assertEqual(self.log.read_text(), 'active deployment log')
                fcntl.flock(lock, fcntl.LOCK_UN)
                _, error = process.communicate(timeout=20)
                self.assertEqual(process.returncode, 0, error)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.communicate()
        self.assertEqual(self.deploy().returncode, 0)

    def test_refuses_existing_unmanaged_directory_and_source_overlap(self):
        self.root.mkdir()
        (self.root / 'valuable.txt').write_text('keep')
        self.assertNotEqual(self.deploy().returncode, 0)
        self.assertEqual((self.root / 'valuable.txt').read_text(), 'keep')
        self.assertNotEqual(self.deploy(PULPO_IOS_BUILD_ROOT=str(self.source)).returncode, 0)

    def test_surviving_build_child_keeps_lock_when_runner_is_killed(self):
        started, release = self.directory / 'started', self.directory / 'release'
        environment = dict(self.env, STARTED=str(started), RELEASE=str(release),
                           HOLD_COMMAND='npx --no-install expo run:ios --device Isaac iphone --configuration Release --no-bundler')
        process = subprocess.Popen(['bash', str(self.source / 'apps/mobile/scripts/deploy-iphone.sh')],
                                   env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            deadline = time.monotonic() + 20
            while not started.exists() and time.monotonic() < deadline:
                time.sleep(0.02)
            self.assertTrue(started.exists())
            process.kill()
            process.wait(timeout=5)
            with (self.root / 'deploy.lock').open('a') as lock:
                with self.assertRaises(BlockingIOError):
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                release.touch()
                deadline = time.monotonic() + 5
                while True:
                    try:
                        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        break
                    except BlockingIOError:
                        if time.monotonic() >= deadline:
                            self.fail('Lock was not released after the surviving build exited')
                        time.sleep(0.02)
        finally:
            release.touch()
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)


if __name__ == '__main__':
    unittest.main()
