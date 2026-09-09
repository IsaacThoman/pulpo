#!/usr/bin/env python3
"""Delete only explicitly owned, closed Pulpo PR resources. Dry-run by default."""
import argparse
import fcntl
import json
import os
import re
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

SERVICES = {'object-storage-init', 'web', 'api', 'worker', 'postgres', 'redis',
            'ollama', 'seaweed-master', 'seaweed-volume', 'seaweed-filer', 'seaweed-s3'}
VOLUMES = {'postgres-data', 'redis-data', 'ollama-models', 'object-data',
           'seaweed-master-data', 'seaweed-volume-data', 'seaweed-filer-data', 'seaweed-s3-data'}


def docker(*args):
    return subprocess.check_output(['docker', *args], text=True).strip()


def inspect_all(kind):
    ids = docker(*(('ps', '-aq') if kind == 'container' else ('volume', 'ls', '-q'))).splitlines()
    return json.loads(docker(*(('inspect',) if kind == 'container' else ('volume', 'inspect')), *ids)) if ids else []


def volume_pr(name, parent):
    match = re.fullmatch(re.escape(parent) + r'_([a-z-]+)-pr-([1-9][0-9]*)', name)
    return int(match[2]) if match and match[1] in VOLUMES else None


def container_pr(container, parent, application_id):
    labels = container['Config'].get('Labels') or {}
    name = container['Name'].lstrip('/')
    match = re.fullmatch(r'([a-z-]+)-' + re.escape(parent) + r'-pr-([1-9][0-9]*)', name)
    if not match or match[1] not in SERVICES:
        return None
    pr = int(match[2])
    if (labels.get('com.docker.compose.project') != parent
            or labels.get('coolify.applicationId') != str(application_id)
            or labels.get('coolify.pullRequestId') != str(pr)):
        raise ValueError(f'Ownership labels disagree for {name}; refusing cleanup')
    return pr


def closed_pr(data, number, repository, grace_seconds, now=None):
    now = now or datetime.now(timezone.utc)
    if (data.get('number') != number or data.get('state') != 'closed'
            or data.get('base', {}).get('ref') != 'dev'
            or data.get('base', {}).get('repo', {}).get('full_name') != repository
            or (data.get('head', {}).get('repo') or {}).get('full_name') != repository
            or not data.get('closed_at')):
        return False
    return (now - datetime.fromisoformat(data['closed_at'].replace('Z', '+00:00'))).total_seconds() >= grace_seconds


def github_pr(repository, number):
    headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'pulpo-preview-maintenance'}
    if os.environ.get('GITHUB_TOKEN'):
        headers['Authorization'] = 'Bearer ' + os.environ['GITHUB_TOKEN']
    req = urllib.request.Request(f'https://api.github.com/repos/{repository}/pulls/{number}', headers=headers)
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)



def forget_preview(parent, number):
    """Remove stale Coolify metadata after exact Docker cleanup; 404 is idempotent."""
    config_path = os.environ.get('COOLIFY_CLEANUP_CONFIG')
    if not config_path:
        return
    config = json.loads(Path(config_path).read_text())
    if config['parent_uuid'] != parent:
        raise ValueError('Coolify metadata cleanup parent mismatch')
    req = urllib.request.Request(
        config['url'].rstrip('/') + f'/api/v1/applications/{parent}/previews/{number}',
        headers={'Authorization': 'Bearer ' + config['token'], 'Accept': 'application/json',
                 'User-Agent': 'pulpo-preview-maintenance'}, method='DELETE')
    try:
        with urllib.request.urlopen(req, timeout=60):
            pass
    except urllib.error.HTTPError as exc:
        if exc.code != 404:
            raise


def plan(parent, application_id, containers, volumes):
    groups = {}
    for c in containers:
        pr = container_pr(c, parent, application_id)
        if pr:
            groups.setdefault(pr, {'containers': [], 'volumes': []})['containers'].append(c)
    for v in volumes:
        pr = volume_pr(v['Name'], parent)
        if not pr:
            continue
        labels = v.get('Labels') or {}
        if labels.get('com.docker.compose.project') != parent:
            raise ValueError(f"Volume ownership disagrees for {v['Name']}; refusing cleanup")
        groups.setdefault(pr, {'containers': [], 'volumes': []})['volumes'].append(v)
    # Refuse an entire sweep if any candidate mounts persistent/unknown storage,
    # or if another environment references a candidate volume.
    for pr, group in groups.items():
        ids = {c['Id'] for c in group['containers']}
        names = {v['Name'] for v in group['volumes']} | {m['Name'] for c in group['containers'] for m in c.get('Mounts', []) if m['Type'] == 'volume'}
        for c in group['containers']:
            for m in c.get('Mounts', []):
                legacy_anonymous = (c['Name'].lstrip('/').startswith('seaweed-s3-')
                                    and m['Destination'] == '/data'
                                    and re.fullmatch(r'[a-f0-9]{64}', m.get('Name', '')))
                if m['Type'] != 'volume' or (volume_pr(m.get('Name', ''), parent) != pr and not legacy_anonymous):
                    raise ValueError(f"Unexpected mount on {c['Name']}; refusing cleanup")
        for c in containers:
            if c['Id'] not in ids and any(m.get('Name') in names for m in c.get('Mounts', [])):
                raise ValueError(f"Preview volume shared with {c['Name']}; refusing cleanup")
    return groups


def sweep(args):
    if not re.fullmatch(r'[a-z0-9]{20,32}', args.parent):
        raise ValueError('An explicit Coolify preview-parent UUID is required')
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', args.repository):
        raise ValueError('Invalid GitHub repository')
    if args.parent in args.protected:
        raise ValueError('Preview parent is a protected application')
    groups = plan(args.parent, args.application_id, inspect_all('container'), inspect_all('volume'))
    errors = []
    for number, group in sorted(groups.items()):
        if args.pr and number != args.pr:
            continue
        try:
            if not closed_pr(github_pr(args.repository, number), number, args.repository, args.grace_seconds):
                print(f'Keep PR #{number}: open, recently closed, or outside the trusted repository/base')
                continue
            print(json.dumps({'pr': number, 'apply': args.apply,
                              'containers': [c['Name'] for c in group['containers']],
                              'volumes': [v['Name'] for v in group['volumes']]}), flush=True)
            if not args.apply:
                continue
            # Re-read both ownership and references immediately before mutation.
            current = plan(args.parent, args.application_id, inspect_all('container'), inspect_all('volume')).get(number)
            if not current:
                continue
            if not closed_pr(github_pr(args.repository, number), number, args.repository, args.grace_seconds):
                continue
            for c in current['containers']:
                docker('rm', '-f', '-v', c['Id'])  # immutable IDs prevent replacement-name races
            for v in current['volumes']:
                # Never force volume deletion. Docker rejects a concurrently attached volume.
                docker('volume', 'rm', v['Name'])
            forget_preview(args.parent, number)
            print(f'Cleaned PR #{number}', flush=True)
        except (ValueError, subprocess.CalledProcessError, urllib.error.URLError) as exc:
            errors.append(number)
            print(f'PR #{number}: cleanup failed safely: {exc}', flush=True)
    if errors:
        raise RuntimeError(f'Cleanup incomplete for PRs {errors}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--parent', default=os.environ.get('PREVIEW_PARENT_UUID'), required=not os.environ.get('PREVIEW_PARENT_UUID'))
    parser.add_argument('--application-id', type=int, default=os.environ.get('PREVIEW_APPLICATION_ID'), required=not os.environ.get('PREVIEW_APPLICATION_ID'))
    parser.add_argument('--repository', default='IsaacThoman/pulpo')
    parser.add_argument('--protected', nargs='*', default=[])
    parser.add_argument('--pr', type=int)
    parser.add_argument('--grace-seconds', type=int, default=300)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--loop', action='store_true')
    args = parser.parse_args()
    Path('/maintenance').mkdir(exist_ok=True)
    while True:
        try:
            with open('/maintenance/cleanup.lock', 'w') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                sweep(args)
            Path('/maintenance/last-success').write_text(datetime.now(timezone.utc).isoformat())
        except BlockingIOError:
            print('Another cleanup is running; skipping', flush=True)
        except Exception as exc:
            print(f'Cleanup failed: {exc}', flush=True)
            if not args.loop:
                raise
        if not args.loop:
            break
        time.sleep(900)


if __name__ == '__main__':
    main()
