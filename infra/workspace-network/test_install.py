"""Installer lifecycle regressions; host commands are simulated, flock is real."""
import contextlib
import importlib.util
import io
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('network_install', Path(__file__).with_name('install.py'))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallerTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name).resolve()
        self.backups = root / 'backups'
        self.files = {name: str(root / 'installed' / name) for name in installer.FILES}
        self.table = ''
        self.active = False
        self.enabled = False
        self.calls = []
        self.hook = None
        for patcher in (
            patch.object(installer, 'BACKUPS', self.backups),
            patch.object(installer, 'FILES', self.files),
            patch.object(installer.os, 'geteuid', return_value=0),
            patch.object(installer.subprocess, 'run', side_effect=self.run_command),
            contextlib.redirect_stdout(io.StringIO()),
            contextlib.redirect_stderr(io.StringIO()),
        ):
            patcher.__enter__()
            self.addCleanup(patcher.__exit__, None, None, None)

    def run_command(self, argv, **kwargs):
        argv = tuple(argv)
        self.calls.append(argv)
        if self.hook:
            self.hook(argv)
        output, error, code = '', '', 0
        if argv[0] == '/usr/sbin/nft':
            if 'list' in argv:
                output = self.table
                if not output:
                    error, code = 'No such file or directory', 1
            elif argv[1:3] == ('-f', '-'):
                self.table = kwargs['input'].split('\n', 2)[2]
        elif argv[0] == 'systemctl':
            if argv[1] == 'is-active':
                code = 0 if self.active else 3
            elif argv[1] == 'is-enabled':
                code = 0 if self.enabled else 1
            elif argv[1] == 'enable':
                self.enabled = True
            elif argv[1] == 'disable':
                self.enabled = False
            elif argv[1] == 'restart':
                self.active = True
                self.table = Path(self.files['rules.nft']).read_text()
            elif argv[1:3] == ('stop', installer.SERVICE):
                self.active = False
        if code and kwargs.get('check'):
            raise subprocess.CalledProcessError(code, argv, output, error)
        return subprocess.CompletedProcess(argv, code, output, error)

    def install(self):
        installer.main([])
        return sorted(self.backups.glob('*/state.json'))[-1].parent

    def assert_protected(self):
        self.assertTrue(self.table)
        self.assertTrue(self.active)
        self.assertTrue(self.enabled)
        self.assertTrue(all(Path(path).exists() for path in self.files.values()))

    def assert_restored(self):
        self.assertEqual(self.table, '')
        self.assertFalse(self.active)
        self.assertFalse(self.enabled)
        self.assertFalse(any(Path(path).exists() for path in self.files.values()))

    def test_reinstall_rejected_until_pending_installation_is_resolved(self):
        backup = self.install()
        before = list(self.calls)
        with self.assertRaises(SystemExit) as error:
            installer.main([])
        self.assertEqual(error.exception.code, 2)
        self.assertEqual(self.calls, before)
        self.assertEqual(len(list(self.backups.glob('*/state.json'))), 1)
        installer.main(['--confirm', str(backup)])
        self.assertNotEqual(self.install(), backup)
        self.assert_protected()

    def test_legacy_pending_backup_also_blocks_reinstall(self):
        backup = self.backups / 'legacy'
        backup.mkdir(parents=True)
        (backup / 'state.json').write_text('{}')
        with self.assertRaises(SystemExit):
            installer.main([])
        self.assertEqual(self.calls, [])

    def test_old_timer_cannot_undo_a_new_installation(self):
        old = self.install()
        installer.main(['--confirm', str(old)])
        new = self.install()
        installer.main(['--confirm', str(new)])
        before = list(self.calls)
        installer.main(['--auto-rollback', str(old)])
        self.assertEqual(self.calls, before)
        self.assert_protected()
        self.assertTrue((new / 'confirmed').exists())

    def test_timer_invokes_confirmation_aware_rollback(self):
        backup = self.install()
        timer = next(call for call in self.calls if call[0] == 'systemd-run')
        self.assertEqual(timer[-2:], ('--auto-rollback', str(backup)))
        installer.main(list(timer[-2:]))
        self.assert_restored()
        self.assertTrue((backup / 'rolled-back').exists())
        before = list(self.calls)
        installer.main(list(timer[-2:]))
        self.assertEqual(self.calls, before)
        self.install()
        self.assert_protected()

    def test_explicit_rollback_still_works_after_confirmation(self):
        backup = self.install()
        installer.main(['--confirm', str(backup)])
        installer.main(['--rollback', str(backup)])
        self.assert_restored()

    def test_older_manual_rollback_cannot_overwrite_pending_installation(self):
        old = self.install()
        installer.main(['--confirm', str(old)])
        self.install()
        before = list(self.calls)
        with self.assertRaises(SystemExit):
            installer.main(['--rollback', str(old)])
        self.assertEqual(self.calls, before)
        self.assert_protected()

    def test_old_confirmation_cannot_report_success_for_pending_reinstall(self):
        old = self.install()
        installer.main(['--confirm', str(old)])
        new = self.install()
        before = list(self.calls)
        with self.assertRaises(SystemExit):
            installer.main(['--confirm', str(old)])
        self.assertEqual(self.calls, before)
        self.assertFalse((new / 'confirmed').exists())

    def test_rollback_restores_previous_configuration(self):
        for path in self.files.values():
            Path(path).parent.mkdir(parents=True, exist_ok=True)
            Path(path).write_text('previous file\n')
        self.table = 'previous table\n'
        self.active = self.enabled = True
        backup = self.install()
        installer.main(['--auto-rollback', str(backup)])
        self.assertEqual(self.table, 'previous table\n')
        self.assertTrue(self.active)
        self.assertTrue(self.enabled)
        for path in self.files.values():
            self.assertEqual(Path(path).read_text(), 'previous file\n')

    def race(self, first, second, pause_command):
        """Pause the lock owner inside a host command while a contender starts."""
        paused, release, contender_attempted = (threading.Event() for _ in range(3))
        second_done = threading.Event()
        errors = {}
        original_lock = installer.installation_lock

        @contextlib.contextmanager
        def observed_lock():
            if threading.current_thread().name == 'contender':
                contender_attempted.set()
            with original_lock():
                yield

        def hook(argv):
            if threading.current_thread().name == 'owner' and pause_command(argv):
                paused.set()
                if not release.wait(5):
                    raise RuntimeError('test coordination timed out')

        def invoke(name, args):
            try:
                installer.main(args)
            except BaseException as error:
                errors[name] = error
            finally:
                if name == 'contender':
                    second_done.set()

        self.hook = hook
        with patch.object(installer, 'installation_lock', observed_lock):
            owner = threading.Thread(target=invoke, args=('owner', first), name='owner')
            contender = threading.Thread(target=invoke, args=('contender', second), name='contender')
            owner.start()
            try:
                self.assertTrue(paused.wait(5))
                contender.start()
                self.assertTrue(contender_attempted.wait(5))
                self.assertFalse(second_done.wait(0.1), 'contender must wait for the lock owner')
            finally:
                release.set()
                owner.join(5)
                if contender.ident is not None:
                    contender.join(5)
            self.assertFalse(owner.is_alive())
            self.assertFalse(contender.is_alive())
        self.hook = None
        return errors

    def test_confirmation_wins_against_already_started_timer_callback(self):
        backup = self.install()
        errors = self.race(
            ['--confirm', str(backup)], ['--auto-rollback', str(backup)],
            lambda argv: argv[:2] == ('systemctl', 'stop'),
        )
        self.assertEqual(errors, {})
        self.assertTrue((backup / 'confirmed').exists())
        self.assertFalse((backup / 'rolled-back').exists())
        self.assert_protected()

    def test_confirmation_fails_when_rollback_wins(self):
        backup = self.install()
        errors = self.race(
            ['--auto-rollback', str(backup)], ['--confirm', str(backup)],
            lambda argv: argv[:3] == ('/usr/sbin/nft', '-f', '-'),
        )
        self.assertNotIn('owner', errors)
        self.assertIsInstance(errors.get('contender'), SystemExit)
        self.assertEqual(errors['contender'].code, 2)
        self.assertFalse((backup / 'confirmed').exists())
        self.assertTrue((backup / 'rolled-back').exists())
        self.assert_restored()

    def test_concurrent_installers_cannot_arm_two_timers(self):
        errors = self.race([], [], lambda argv: '--check' in argv)
        self.assertNotIn('owner', errors)
        self.assertIsInstance(errors.get('contender'), SystemExit)
        self.assertEqual(errors['contender'].code, 2)
        self.assertEqual(sum(call[0] == 'systemd-run' for call in self.calls), 1)
        self.assert_protected()


if __name__ == '__main__':
    unittest.main()
