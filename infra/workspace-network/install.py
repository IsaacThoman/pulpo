#!/usr/bin/env python3
"""Install pod ICMP/IPv6 isolation without restarting K3s or replacing its rules.

Run on the Linux K3s node with the adjacent .nft, .service, and .conf files.
Leaves a timed rollback armed until a separate --confirm after verification.
"""
import argparse
import datetime
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

SERVICE = 'pulpo-workspace-network.service'
TABLE = 'pulpo_workspace_network'
BACKUPS = Path('/var/backups/pulpo-workspace-network')
FILES = {
    'rules.nft': '/etc/pulpo/workspace-network/rules.nft',
    'pulpo-workspace-network.service': '/etc/systemd/system/' + SERVICE,
    'k3s-network.conf': '/etc/systemd/system/k3s.service.d/50-pulpo-network.conf',
}


def run(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)


def backup_path(value):
    path = Path(value).resolve()
    if path.parent != BACKUPS or not (path / 'state.json').is_file():
        raise ValueError('expected an installation backup under ' + str(BACKUPS))
    return path


def rollback(backup):
    state = json.loads((backup / 'state.json').read_text())
    if (backup / 'rolled-back').exists():
        print('This installation has already been rolled back:', backup)
        return
    subprocess.run(['systemctl', 'stop', state['timer'] + '.timer'], capture_output=True)
    # Replace only our table, in one transaction. No KUBE/FLANNEL tables touched.
    restore = f'add table inet {TABLE}\ndelete table inet {TABLE}\n'
    restore += (backup / 'previous.nft').read_text()
    run('/usr/sbin/nft', '-f', '-', input=restore)
    if not state['enabled']:
        run('systemctl', 'disable', SERVICE)
    # Do this while the unit file still exists. It has no ExecStop.
    if not state['active']:
        run('systemctl', 'stop', SERVICE)
    for dest, existed in state['files'].items():
        path = Path(dest)
        if existed:
            shutil.copy2(backup / dest.lstrip('/'), path)
        else:
            path.unlink(missing_ok=True)
    run('systemctl', 'daemon-reload')
    (backup / 'rolled-back').touch()
    print('Restored network configuration from', backup)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--confirm', type=backup_path)
    group.add_argument('--rollback', type=backup_path)
    parser.add_argument('--rollback-seconds', type=int, default=600)
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error('run as root')
    if args.rollback:
        rollback(args.rollback)
        return
    if args.confirm:
        backup = args.confirm
        state = json.loads((backup / 'state.json').read_text())
        if (backup / 'rolled-back').exists():
            parser.error('rollback already ran; reinstall and reverify')
        run('systemctl', 'is-active', SERVICE)
        run('/usr/sbin/nft', 'list', 'table', 'inet', TABLE, stdout=subprocess.DEVNULL)
        run('systemctl', 'stop', state['timer'] + '.timer')
        if (backup / 'rolled-back').exists():
            parser.error('rollback ran during confirmation; reinstall and reverify')
        (backup / 'confirmed').touch()
        print('Confirmed installation; rollback timer cancelled:', backup)
        return
    if args.rollback_seconds < 60:
        parser.error('rollback window must be at least 60 seconds')
    source = Path(__file__).resolve().parent
    for name, dest in FILES.items():
        if not (source / name).is_file():
            parser.error('missing ' + name)
        if Path(dest).is_symlink():
            parser.error('refusing to replace symlink: ' + dest)
    # Validate against the current kernel before modifying persistent files.
    run('/usr/sbin/nft', '--check', '-f', str(source / 'rules.nft'))
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = BACKUPS / stamp
    backup.mkdir(parents=True, mode=0o700)
    old = subprocess.run(['/usr/sbin/nft', 'list', 'table', 'inet', TABLE], text=True, capture_output=True)
    if old.returncode and 'No such file or directory' not in old.stderr:
        raise RuntimeError(old.stderr)
    (backup / 'previous.nft').write_text(old.stdout)
    state = {
        'timer': 'pulpo-network-rollback-' + stamp.lower(),
        'enabled': subprocess.run(['systemctl', 'is-enabled', '--quiet', SERVICE]).returncode == 0,
        'active': subprocess.run(['systemctl', 'is-active', '--quiet', SERVICE]).returncode == 0,
        'files': {},
    }
    for dest in FILES.values():
        path = Path(dest)
        state['files'][dest] = path.exists()
        if path.exists():
            saved = backup / dest.lstrip('/')
            saved.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, saved)
    (backup / 'state.json').write_text(json.dumps(state, indent=2) + '\n')
    shutil.copy2(__file__, backup / 'install.py')
    run('systemd-run', '--unit=' + state['timer'], '--on-active=' + str(args.rollback_seconds) + 's',
        sys.executable, str(backup / 'install.py'), '--rollback', str(backup))
    try:
        for name, dest in FILES.items():
            path = Path(dest)
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_name(path.name + '.installing')
            temporary.write_bytes((source / name).read_bytes())
            temporary.chmod(0o644)
            temporary.replace(path)
        run('systemctl', 'daemon-reload')
        run('systemctl', 'enable', SERVICE)
        run('systemctl', 'restart', SERVICE)
        run('systemctl', 'is-active', SERVICE)
    except BaseException:
        rollback(backup)
        run('systemctl', 'stop', state['timer'] + '.timer')
        raise
    print('Backup:', backup)
    print(f'Rollback remains armed for {args.rollback_seconds} seconds. After verification:')
    print(f'sudo python3 {backup}/install.py --confirm {backup}')


if __name__ == '__main__':
    main()
