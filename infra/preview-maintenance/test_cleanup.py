import copy
import unittest
from datetime import datetime, timezone
from unittest.mock import patch
from types import SimpleNamespace
import cleanup

PARENT = 'lge7s5gv4obek4lo30319ph4'
REPO = 'IsaacThoman/pulpo'


def volume(pr=529):
    return {'Name': f'{PARENT}_postgres-data-pr-{pr}', 'Labels': {'com.docker.compose.project': PARENT}}


def container(pr=529):
    return {'Id': 'immutable-id', 'Name': f'/postgres-{PARENT}-pr-{pr}',
            'Config': {'Labels': {'com.docker.compose.project': PARENT, 'coolify.applicationId': '38', 'coolify.pullRequestId': str(pr)}},
            'Mounts': [{'Type': 'volume', 'Name': volume(pr)['Name'], 'Destination': '/var/lib/postgresql/data'}]}


def pull():
    return {'number': 529, 'state': 'closed', 'closed_at': '2026-09-01T00:00:00Z',
            'base': {'ref': 'dev', 'repo': {'full_name': REPO}}, 'head': {'repo': {'full_name': REPO}}}


class CleanupSafetyTests(unittest.TestCase):
    def test_persistent_and_foreign_volume_names_never_match(self):
        for name in [f'{PARENT}_postgres-data', 'production_postgres-data-pr-529',
                     f'{PARENT}_postgres-data-pr-529-extra', f'{PARENT}_postgres-data-pr-0',
                     f'{PARENT}_unexpected-pr-529']:
            self.assertIsNone(cleanup.volume_pr(name, PARENT))

    def test_persistent_and_production_containers_are_ignored(self):
        c = container(); c['Name'] = f'/postgres-{PARENT}-123456'
        prod = copy.deepcopy(c); prod['Name'] = '/pulpo-production-infrastructure-postgres-1'
        self.assertEqual(cleanup.plan(PARENT, 38, [c, prod], []), {})

    def test_closed_preview_and_orphan_volume_are_selected(self):
        groups = cleanup.plan(PARENT, 38, [container()], [volume(), volume(530)])
        self.assertEqual(set(groups), {529, 530})
        self.assertEqual(groups[530]['containers'], [])

    def test_wrong_container_or_volume_ownership_fails_closed(self):
        c = container(); c['Config']['Labels']['coolify.pullRequestId'] = '530'
        with self.assertRaises(ValueError): cleanup.plan(PARENT, 38, [c], [volume()])
        v = volume(); v['Labels'] = {}
        with self.assertRaises(ValueError): cleanup.plan(PARENT, 38, [], [v])

    def test_shared_volume_blocks_deletion(self):
        other = container(); other['Name'] = '/production-api'; other['Id'] = 'other'
        with self.assertRaises(ValueError): cleanup.plan(PARENT, 38, [container(), other], [volume()])

    def test_persistent_mount_blocks_preview_deletion(self):
        c = container(); c['Mounts'][0]['Name'] = f'{PARENT}_postgres-data'
        with self.assertRaises(ValueError): cleanup.plan(PARENT, 38, [c], [volume()])

    def test_arbitrary_bind_mount_blocks_preview_deletion(self):
        c = container(); c['Mounts'] = [{'Type': 'bind', 'Source': '/data/production', 'Destination': '/data'}]
        with self.assertRaises(ValueError): cleanup.plan(PARENT, 38, [c], [])

    def test_open_fork_main_and_unknown_prs_are_preserved(self):
        variants = []
        for field, value in [('state', 'open'), ('closed_at', None), ('number', 530)]:
            p = pull(); p[field] = value; variants.append(p)
        p = pull(); p['base']['ref'] = 'main'; variants.append(p)
        p = pull(); p['head']['repo'] = {'full_name': 'someone/pulpo'}; variants.append(p)
        p = pull(); p['head']['repo'] = None; variants.append(p)
        for p in variants: self.assertFalse(cleanup.closed_pr(p, 529, REPO, 300))

    def test_grace_period(self):
        self.assertFalse(cleanup.closed_pr(pull(), 529, REPO, 300, datetime(2026, 9, 1, 0, 1, tzinfo=timezone.utc)))
        self.assertTrue(cleanup.closed_pr(pull(), 529, REPO, 300, datetime(2026, 9, 1, 0, 6, tzinfo=timezone.utc)))

    def args(self, apply=True):
        return SimpleNamespace(parent=PARENT, application_id=38, repository=REPO,
                               protected=[], pr=None, grace_seconds=300, apply=apply)

    @patch('cleanup.github_pr', return_value=pull())
    @patch('cleanup.inspect_all', side_effect=lambda kind: [container()] if kind == 'container' else [volume()])
    @patch('cleanup.docker')
    def test_apply_removes_exact_container_and_never_forces_volume(self, docker, *_):
        cleanup.sweep(self.args())
        self.assertEqual(docker.call_args_list, [unittest.mock.call('rm', '-f', '-v', 'immutable-id'), unittest.mock.call('volume', 'rm', volume()['Name'])])

    @patch('cleanup.github_pr', return_value=pull())
    @patch('cleanup.inspect_all', side_effect=lambda kind: [container()] if kind == 'container' else [volume()])
    @patch('cleanup.docker')
    def test_dry_run_never_mutates(self, docker, *_):
        cleanup.sweep(self.args(False)); docker.assert_not_called()

    @patch('cleanup.github_pr', side_effect=cleanup.urllib.error.URLError('unavailable'))
    @patch('cleanup.inspect_all', side_effect=lambda kind: [container()] if kind == 'container' else [volume()])
    @patch('cleanup.docker')
    def test_github_failure_never_mutates(self, docker, *_):
        with self.assertRaises(RuntimeError): cleanup.sweep(self.args())
        docker.assert_not_called()

    @patch('cleanup.github_pr', side_effect=[pull(), {**pull(), 'state': 'open'}])
    @patch('cleanup.inspect_all', side_effect=lambda kind: [container()] if kind == 'container' else [volume()])
    @patch('cleanup.docker')
    def test_reopened_pr_is_kept_at_final_check(self, docker, *_):
        cleanup.sweep(self.args()); docker.assert_not_called()


if __name__ == '__main__': unittest.main()
