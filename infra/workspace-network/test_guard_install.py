"""Guard installer rollback, cached CNI cleanup, and confirmation regressions."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import guard

spec = importlib.util.spec_from_file_location('guard_installer', Path(__file__).with_name('install-guard.py'))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class GuardInstallerTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        self.calls = []
        self.guard_tables = False
        self.active = self.enabled = False
        self.watch_active = self.watch_enabled = False
        self.failure = None
        self.previous_reloads = 0
        replacements = {name: root / name for name in [
            'BACKUPS', 'ACTIVE_CNI', 'CUSTOM_CNI', 'BINARY', 'CNI_BINARY', 'UNIT', 'K3S_UNIT', 'K3S_CONFIG',
            'WATCH_UNIT', 'RECONCILE_UNIT']}
        patches = [patch.object(installer, name, path) for name, path in replacements.items()]
        patches += [patch.object(guard, name, root / name) for name in ['CONFIG', 'DISABLED', 'STATE']]
        patches += [patch.object(installer.os, 'geteuid', return_value=0),
                    patch.object(installer, 'run', side_effect=self.command),
                    patch.object(installer.subprocess, 'run', side_effect=self.command),
                    patch.object(guard, 'run', side_effect=self.output),
                    patch.object(guard, 'adopt', return_value={'id': {'host': 'veth-test'}}),
                    patch.object(guard, 'alive', return_value=True),
                    patch.object(installer, 'load_previous_guard', side_effect=self.previous_guard),
                    patch.object(guard, 'apply', side_effect=self.apply),
                    contextlib.redirect_stdout(io.StringIO())]
        for patcher in patches:
            patcher.__enter__()
            self.addCleanup(patcher.__exit__, None, None, None)
        self.original = json.dumps({'name': 'cbr0', 'cniVersion': '1.0.0',
                                    'plugins': [{'type': 'flannel', 'delegate': {'hairpinMode': True}},
                                                {'type': 'portmap', 'capabilities': {'portMappings': True}}]})
        installer.ACTIVE_CNI.write_text(self.original)

    def output(self, *args):
        if args[:3] == ('ip', '-j', 'addr'):
            return json.dumps([{'addr_info': [{'family': 'inet', 'local': '10.42.0.1'},
                                              {'family': 'inet6', 'scope': 'link', 'local': 'fe80::1'}]}])
        if args[:3] == ('ip', '-j', 'link'):
            return json.dumps([{'ifname': 'veth-test'}])
        if args[0] == guard.NFT and self.guard_tables:
            return 'guard table'
        raise RuntimeError('unexpected read command: ' + repr(args))

    def apply(self, entries, config, check=False):
        if check:
            return
        if self.failure == 'apply':
            raise RuntimeError('nft failed')
        self.guard_tables = True

    def previous_guard(self):
        self.previous_reloads += 1
        return guard

    def command(self, *args, **kwargs):
        argv = list(args[0]) if isinstance(args[0], list) else list(args)
        self.calls.append(argv)
        code, output, error = 0, '', ''
        if argv[0] == guard.NFT:
            if argv[1] == 'list':
                if self.guard_tables:
                    output = 'previous guard table\n'
                else:
                    code, error = 1, 'No such file or directory'
            elif argv[1:3] == ['-f', '-']:
                self.guard_tables = 'previous guard table' in kwargs['input']
        if argv[0] == 'systemctl':
            watched = len(argv) > 2 and argv[-1] == installer.WATCH
            if argv[1] == 'is-enabled':
                code = 0 if (self.watch_enabled if watched else self.enabled) else 1
            elif argv[1] == 'is-active':
                code = 0 if (self.watch_active if watched else self.active) else 3
            elif argv[1] == 'enable':
                if watched:
                    self.watch_enabled = True
                else:
                    self.enabled = True
            elif argv[1] == 'disable':
                if not (installer.WATCH_UNIT if watched else installer.UNIT).exists():
                    raise RuntimeError('systemctl cannot disable a removed unit')
                if watched:
                    self.watch_enabled = False
                else:
                    self.enabled = False
            elif argv[1:3] == ['restart', installer.SERVICE]:
                if self.failure == 'service':
                    raise RuntimeError('service start failed')
                self.active = True
            elif argv[1:3] == ['stop', installer.SERVICE]:
                self.active = False
            elif argv[1:3] == ['start', installer.WATCH]:
                self.watch_active = True
            elif argv[1:3] == ['stop', installer.WATCH]:
                self.watch_active = False
        if code and kwargs.get('check'):
            raise subprocess.CalledProcessError(code, argv, output, error)
        return subprocess.CompletedProcess(argv, code, output, error)

    def install(self):
        with patch('sys.argv', ['install-guard.py']):
            installer.main()
        return next(installer.BACKUPS.glob('*/state.json')).parent

    def invoke(self, command, backup):
        with patch('sys.argv', ['install-guard.py', command, str(backup)]):
            installer.main()

    def assert_restored(self):
        self.assertEqual(installer.ACTIVE_CNI.read_text(), self.original)
        self.assertFalse(self.guard_tables)
        self.assertFalse(self.enabled)
        self.assertFalse(self.active)
        self.assertFalse(self.watch_active)
        self.assertFalse(self.watch_enabled)
        self.assertTrue(guard.DISABLED.exists())
        # Cached new CNI configurations remain deletable after rollback.
        self.assertTrue(installer.BINARY.exists())
        self.assertTrue(installer.CNI_BINARY.exists())
        self.assertFalse(guard.CONFIG.exists())
        self.assertFalse(installer.K3S_CONFIG.exists())

    def test_install_preserves_existing_cni_plugins_and_never_restarts_k3s(self):
        backup = self.install()
        config = json.loads(installer.ACTIVE_CNI.read_text())
        self.assertEqual(config['plugins'][:-1], json.loads(self.original)['plugins'])
        self.assertEqual(config['plugins'][-1]['type'], 'pulpo-workspace-guard')
        self.assertTrue(self.guard_tables and self.active and self.enabled)
        self.assertFalse(any(call[:3] == ['systemctl', 'restart', 'k3s'] for call in self.calls))
        self.assertFalse((backup / 'confirmed').exists())

    def test_initial_rollback_restores_cni_and_retains_disabled_cleanup_binary(self):
        backup = self.install()
        self.invoke('--auto-rollback', backup)
        self.assert_restored()
        self.assertTrue((backup / 'rolled-back').exists())
        before = list(self.calls)
        self.invoke('--auto-rollback', backup)
        self.assertEqual(self.calls, before)

    def test_confirmed_installation_is_immune_to_delayed_automatic_rollback(self):
        backup = self.install()
        self.invoke('--confirm', backup)
        before = list(self.calls)
        self.invoke('--auto-rollback', backup)
        self.assertEqual(self.calls, before)
        self.assertTrue(self.guard_tables and self.active)
        self.invoke('--rollback', backup)
        self.assert_restored()

    def test_old_confirmed_timer_does_not_interfere_with_a_new_pending_installation(self):
        backup = self.install()
        self.invoke('--confirm', backup)
        newer = installer.BACKUPS / 'newer'
        newer.mkdir()
        (newer / 'state.json').write_text('{}')
        before = list(self.calls)
        self.invoke('--auto-rollback', backup)
        self.assertEqual(self.calls, before)

    def test_pending_installation_blocks_a_second_install(self):
        self.install()
        before = list(self.calls)
        with self.assertRaisesRegex(ValueError, 'pending installation'):
            self.install()
        self.assertEqual(self.calls, before)

    def test_failed_rule_installation_restores_prior_files(self):
        self.failure = 'apply'
        with self.assertRaisesRegex(RuntimeError, 'nft failed'):
            self.install()
        self.assert_restored()

    def test_failed_service_start_rolls_back_immediately(self):
        self.failure = 'service'
        with self.assertRaisesRegex(RuntimeError, 'service start failed'):
            self.install()
        self.assert_restored()

    def test_failure_before_unit_creation_completes_rollback(self):
        original_write = installer.write

        def fail_configuration(path, data, mode=0o644):
            if path == guard.CONFIG:
                raise OSError('configuration write failed')
            return original_write(path, data, mode)

        with patch.object(installer, 'write', side_effect=fail_configuration):
            with self.assertRaisesRegex(OSError, 'configuration write failed'):
                self.install()
        self.assert_restored()
        self.assertEqual(installer.pending(), [])

    def test_upgrade_rollback_preserves_new_pods_and_does_not_resurrect_deleted_ones(self):
        first = self.install()
        self.invoke('--confirm', first)
        with patch('sys.argv', ['install-guard.py']):
            installer.main()
        second = next(path for path in installer.pending() if path != first)
        # A successful CNI ADD followed by DEL of the old pod after the backup.
        guard.atomic_json(guard.STATE / 'endpoints.json', {'new:eth0': {'host': 'veth-new'}})
        with patch.object(guard, 'adopt', return_value={'new:eth0': {'host': 'veth-new'}}):
            self.invoke('--auto-rollback', second)
        entries = json.loads((guard.STATE / 'endpoints.json').read_text())
        self.assertIn('new:eth0', entries)
        self.assertNotIn('id', entries)
        self.assertEqual(self.previous_reloads, 1)
        self.assertTrue(self.guard_tables)
        self.assertFalse(guard.DISABLED.exists())
        self.assertTrue(self.watch_active and self.watch_enabled)

    def test_watcher_starts_before_handoff_and_recovers_an_arbitrarily_late_old_add(self):
        original_write = installer.write

        def observe_handoff(path, data, mode=0o644):
            if path == installer.ACTIVE_CNI:
                self.assertTrue(self.watch_active)
            return original_write(path, data, mode)

        with patch.object(installer, 'write', side_effect=observe_handoff):
            self.install()
        # Complete an old, unguarded ADD after installation and its final
        # service reload. The cache-change service invokes this same command.
        self.assertNotIn('late:eth0', json.loads((guard.STATE / 'endpoints.json').read_text()))
        with patch.object(guard, 'adopt', return_value={'late:eth0': {'host': 'veth-late'}}), \
                patch.object(guard, 'read_config', return_value=json.loads(guard.CONFIG.read_text())), \
                patch('sys.argv', ['guard', 'reload']):
            guard.main()
        self.assertIn('late:eth0', json.loads((guard.STATE / 'endpoints.json').read_text()))


if __name__ == '__main__':
    unittest.main()
