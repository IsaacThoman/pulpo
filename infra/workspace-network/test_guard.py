"""CNI lifecycle and identity validation; kernel packet checks are in verify_l2.py."""
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('workspace_guard', Path(__file__).with_name('guard.py'))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class GuardTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.config = {'network': 'cbr0', 'bridge': 'cni0', 'namespace': 'pulpo-workspaces',
                       'gateway': '10.42.0.1', 'hostIPv6': 'fe80::1', 'proxyService': '10.43.47.50'}
        self.args = {'K8S_POD_NAMESPACE': 'pulpo-workspaces', 'K8S_POD_NAME': 'pulpo-workspace-a'}
        self.result = {'cniVersion': '1.0.0', 'interfaces': [
            {'name': 'cni0', 'mac': '02:00:00:00:00:01'},
            {'name': 'veth-test', 'mac': '02:00:00:00:00:02'},
            {'name': 'eth0', 'mac': '02:00:00:00:00:03', 'sandbox': '/test/netns'}],
            'ips': [{'address': '10.42.0.2/24', 'gateway': '10.42.0.1', 'interface': 2}]}
        net = self.root / 'net'
        (net / 'cni0').mkdir(parents=True)
        (net / 'veth-test').mkdir()
        (net / 'veth-test' / 'master').symlink_to(net / 'cni0')
        (net / 'veth-test' / 'ifindex').write_text('123')
        self.stdout = io.StringIO()
        for patcher in [patch.object(guard, 'NET', net), patch.object(guard, 'STATE', self.root / 'state'),
                        patch.object(guard, 'CONFIG', self.root / 'config.json'),
                        patch.object(guard, 'DISABLED', self.root / 'disabled'),
                        contextlib.redirect_stdout(self.stdout)]:
            patcher.__enter__()
            self.addCleanup(patcher.__exit__, None, None, None)
        guard.CONFIG.write_text(json.dumps(self.config))
        self.env = {'CNI_COMMAND': 'ADD', 'CNI_CONTAINERID': 'test-container', 'CNI_IFNAME': 'eth0',
                    'CNI_ARGS': ';'.join(k + '=' + v for k, v in self.args.items())}

    def cni(self, command, result=None):
        request = {'name': 'cbr0', 'cniVersion': '1.0.0', 'prevResult': result or self.result}
        with patch.dict(os.environ, {**self.env, 'CNI_COMMAND': command}), \
                patch('sys.stdin', io.StringIO(json.dumps(request))), \
                patch.object(guard, 'read_config', return_value=self.config):
            guard.main()

    def test_add_returns_the_unchanged_chain_result_only_after_enforcement(self):
        def applied(entries, config):
            self.assertEqual(self.stdout.getvalue(), '')
            self.assertEqual(entries['test-container:eth0']['role'], 'workspace')
        with patch.object(guard, 'apply', side_effect=applied):
            self.cni('ADD')
        self.assertEqual(json.loads(self.stdout.getvalue()), self.result)
        self.assertIn('test-container:eth0', guard.load(self.config))

    def test_failed_firewall_add_does_not_report_success_or_persist_identity(self):
        with patch.object(guard, 'apply', side_effect=RuntimeError('kernel rejected transaction')):
            with self.assertRaises(RuntimeError):
                self.cni('ADD')
        self.assertEqual(self.stdout.getvalue(), '')
        self.assertEqual(guard.load(self.config), {})

    def test_deleted_and_reused_interface_does_not_inherit_old_identity(self):
        with patch.object(guard, 'apply'):
            self.cni('ADD')
        (guard.NET / 'veth-test' / 'ifindex').write_text('124')
        self.assertEqual(guard.load(self.config), {})
        with patch.object(guard, 'run'):
            with self.assertRaisesRegex(ValueError, 'identity is missing'):
                self.cni('CHECK')

    def test_del_is_idempotent_even_after_veth_disappears(self):
        with patch.object(guard, 'apply'):
            self.cni('ADD')
            (guard.NET / 'veth-test' / 'ifindex').unlink()
            self.cni('DEL')
            self.cni('DEL')
        self.assertEqual(guard.load(self.config), {})

    def test_missing_identity_cannot_become_a_trusted_endpoint(self):
        with self.assertRaisesRegex(ValueError, 'identity is required'):
            guard.endpoint(self.result, {}, 'id', 'eth0', self.config)
        self.assertEqual(guard.role('pulpo-workspaces', 'unknown-pod', self.config), 'workspace')

    def test_unexpected_address_families_and_interfaces_are_rejected(self):
        for change in ['ipv6', 'extra-ip', 'missing-interface', 'other-bridge', 'bad-mac']:
            with self.subTest(change=change):
                result = copy.deepcopy(self.result)
                if change == 'ipv6':
                    result['ips'][0]['address'] = 'fd00::2/64'
                elif change == 'extra-ip':
                    result['ips'].append(dict(result['ips'][0]))
                elif change == 'missing-interface':
                    result['interfaces'][2]['name'] = 'other'
                elif change == 'other-bridge':
                    result['interfaces'][0]['name'] = 'other'
                else:
                    result['interfaces'][2]['mac'] = 'invalid'
                with self.assertRaises(ValueError):
                    guard.endpoint(result, self.args, 'id', 'eth0', self.config)

    def test_check_fails_when_enforcement_tables_are_lost(self):
        with patch.object(guard, 'apply'):
            self.cni('ADD')
        with patch.object(guard, 'run', side_effect=RuntimeError('table missing')):
            with self.assertRaises(RuntimeError):
                self.cni('CHECK')

    def test_check_detects_partial_rule_loss_in_an_existing_table(self):
        with patch.object(guard, 'apply'):
            self.cni('ADD')
        guard.atomic_json(guard.STATE / 'enforcement.json', ['original rules'])
        with patch.object(guard, 'snapshot', return_value=['changed rules']):
            with self.assertRaisesRegex(ValueError, 'rules have changed'):
                self.cni('CHECK')

    def test_explicit_rollback_marker_allows_cached_cni_cleanup(self):
        guard.CONFIG.unlink()
        guard.DISABLED.touch()
        with patch.object(guard, 'apply') as apply:
            self.cni('ADD')
            self.cni('DEL')
            self.cni('DEL')
        apply.assert_not_called()
        self.assertEqual(json.loads(self.stdout.getvalue()), self.result)

    def test_missing_configuration_does_not_implicitly_disable_enforcement(self):
        guard.CONFIG.unlink()
        with patch.dict(os.environ, self.env), patch('sys.stdin', io.StringIO(json.dumps({
                'name': 'cbr0', 'cniVersion': '1.0.0', 'prevResult': self.result}))):
            with self.assertRaises(FileNotFoundError):
                guard.main()


if __name__ == '__main__':
    unittest.main()
