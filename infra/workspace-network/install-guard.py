#!/usr/bin/python3
"""Install the CNI identity guard without restarting K3s or user workspaces.

A separate confirmation cancels the timed rollback. On initial rollback the
CNI executable is intentionally retained, disabled, for cached CNI DEL calls.
"""
import argparse
import datetime
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import guard

BACKUPS = Path('/var/backups/pulpo-workspace-guard')
ACTIVE_CNI = Path('/var/lib/rancher/k3s/agent/etc/cni/net.d/10-flannel.conflist')
CUSTOM_CNI = Path('/etc/pulpo/workspace-network/guard.conflist')
BINARY = Path('/usr/local/sbin/pulpo-workspace-guard')
CNI_BINARY = Path('/var/lib/rancher/k3s/data/cni/pulpo-workspace-guard')
SERVICE = 'pulpo-workspace-guard.service'
UNIT = Path('/etc/systemd/system') / SERVICE
K3S_UNIT = Path('/etc/systemd/system/k3s.service.d/52-pulpo-guard.conf')
K3S_CONFIG = Path('/etc/rancher/k3s/config.yaml.d/52-pulpo-workspace-guard.yaml')
WATCH = 'pulpo-workspace-guard-reconcile.path'
RECONCILE = 'pulpo-workspace-guard-reconcile.service'
WATCH_UNIT = Path('/etc/systemd/system') / WATCH
RECONCILE_UNIT = Path('/etc/systemd/system') / RECONCILE


def run(*args, **kwargs):
    return subprocess.run(args, text=True, check=True, **kwargs)


def write(path, data, mode=0o644):
    if path.is_symlink():
        raise ValueError('refusing to replace symlink: ' + str(path))
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.installing')
    temporary.write_bytes(data.encode() if isinstance(data, str) else data)
    temporary.chmod(mode)
    temporary.replace(path)


def pending():
    return [path.parent for path in BACKUPS.glob('*/state.json')
            if not (path.parent / 'confirmed').exists()
            and not (path.parent / 'rolled-back').exists()]


def validated_backup(value):
    path = Path(value).resolve()
    if path.parent != BACKUPS or not (path / 'state.json').is_file():
        raise ValueError('expected a guard installation backup under ' + str(BACKUPS))
    return path


def load_previous_guard():
    # Rollback must use the restored implementation, not the renderer from the
    # version being rolled back. Loading it in-process preserves our CNI lock.
    loader = importlib.machinery.SourceFileLoader('pulpo_guard_rollback', str(BINARY))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    previous = importlib.util.module_from_spec(spec)
    loader.exec_module(previous)
    return previous


def reload_previous_guard():
    previous = load_previous_guard()
    config = previous.read_config()
    entries = previous.load(config)
    entries.update(previous.adopt(config))
    previous.apply(entries, config)
    previous.atomic_json(previous.STATE / 'endpoints.json', entries)


def restore(backup, automatic=False):
    if (backup / 'rolled-back').exists() or (automatic and (backup / 'confirmed').exists()):
        return
    state = json.loads((backup / 'state.json').read_text())
    run('systemctl', 'stop', state['timer'] + '.timer')
    # Pause cache-driven reloads before restoring code/configuration. The
    # watcher service may be waiting for this lock; stopping it is safe.
    if WATCH_UNIT.exists():
        run('systemctl', 'stop', WATCH)
        if not state.get('watchEnabled', False):
            run('systemctl', 'disable', WATCH)
    if RECONCILE_UNIT.exists():
        run('systemctl', 'stop', RECONCILE)
    # Disable/stop while the unit file still exists. Removing it first makes
    # systemctl disable fail on an initial installation's rollback.
    if not state['enabled'] and UNIT.exists():
        run('systemctl', 'disable', SERVICE)
    if not state['active'] and UNIT.exists():
        subprocess.run(['systemctl', 'stop', SERVICE], check=False, capture_output=True)
    # Cached libcni configurations may still invoke this binary on DEL. Keep it
    # available; only the explicit root-owned rollback marker permits bypass.
    if not state['previousGuard']:
        write(guard.DISABLED, 'Installation rolled back; cached CNI cleanup only.\n', 0o600)
    for dest, existed in state['files'].items():
        path = Path(dest)
        # CNI ADD/DEL may have changed these ledgers since the upgrade began.
        # Restore the old code/configuration and regenerate its rules using
        # live identities instead of resurrecting the backup's pod inventory.
        if state['previousGuard'] and path in [guard.STATE / 'endpoints.json', guard.STATE / 'enforcement.json']:
            continue
        if existed:
            saved = backup / dest.lstrip('/')
            write(path, saved.read_bytes(), saved.stat().st_mode & 0o777)
        elif path not in [BINARY, CNI_BINARY, guard.DISABLED]:
            path.unlink(missing_ok=True)
    if state['previousGuard'] and not state['files'][str(guard.DISABLED)]:
        guard.DISABLED.unlink(missing_ok=True)
    rules = ''
    for family in ['bridge', 'inet']:
        rules += f'add table {family} {guard.TABLE}\ndelete table {family} {guard.TABLE}\n'
        rules += (backup / (family + '.nft')).read_text()
    if state['previousGuard']:
        try:
            reload_previous_guard()
        except BaseException:
            # Keep the previous security boundary if live reconciliation fails,
            # but do not report successful rollback or hide the failure.
            run(guard.NFT, '-f', '-', input=rules)
            raise
    else:
        run(guard.NFT, '-f', '-', input=rules)
    run('systemctl', 'daemon-reload')
    if state.get('watchActive', False):
        run('systemctl', 'start', WATCH)
    (backup / 'rolled-back').touch()
    print('Restored guard configuration:', backup)


def install(args):
    if pending():
        raise ValueError('confirm or roll back the pending installation first')
    if args.rollback_seconds < 60:
        raise ValueError('rollback window must be at least 60 seconds')
    config = json.loads(ACTIVE_CNI.read_text())
    if config['plugins'][0]['type'] != 'flannel' or config['cniVersion'] not in guard.VERSIONS:
        raise ValueError('expected the verified Flannel CNI configuration')
    if any(p['type'] == 'pulpo-workspace-guard' for p in config['plugins']):
        config['plugins'] = [p for p in config['plugins'] if p['type'] != 'pulpo-workspace-guard']
    config['plugins'].append({'type': 'pulpo-workspace-guard'})
    addresses = json.loads(guard.run('ip', '-j', 'addr', 'show', args.bridge))
    ipv4 = [a for link in addresses for a in link['addr_info'] if a['family'] == 'inet']
    ipv6 = [a for link in addresses for a in link['addr_info'] if a['family'] == 'inet6' and a['scope'] == 'link']
    if len(ipv4) != 1 or len(ipv6) != 1:
        raise ValueError('expected a single IPv4 gateway and link-local IPv6 address')
    settings = {'network': config['name'], 'bridge': args.bridge, 'namespace': 'pulpo-workspaces',
                'gateway': ipv4[0]['local'], 'hostIPv6': ipv6[0]['local'], 'proxyService': args.proxy_service}
    entries = guard.adopt(settings)
    # Refuse a partial adoption; unknown live ports would otherwise lose service.
    ports = json.loads(guard.run('ip', '-j', 'link', 'show', 'master', args.bridge))
    if {p['ifname'] for p in ports} != {e['host'] for e in entries.values()}:
        raise ValueError('bridge ports do not match the live CNI cache; retry after pod creation finishes')
    guard.apply(entries, settings, check=True)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup = BACKUPS / stamp
    backup.mkdir(parents=True, mode=0o700)
    files = [ACTIVE_CNI, CUSTOM_CNI, BINARY, CNI_BINARY, UNIT, K3S_UNIT, K3S_CONFIG, WATCH_UNIT, RECONCILE_UNIT,
             guard.CONFIG, guard.DISABLED, guard.STATE / 'endpoints.json', guard.STATE / 'enforcement.json']
    state = {'files': {}, 'timer': 'pulpo-guard-rollback-' + stamp.lower(),
             'enabled': subprocess.run(['systemctl', 'is-enabled', '--quiet', SERVICE], capture_output=True).returncode == 0,
             'active': subprocess.run(['systemctl', 'is-active', '--quiet', SERVICE], capture_output=True).returncode == 0,
             'watchEnabled': subprocess.run(['systemctl', 'is-enabled', '--quiet', WATCH], capture_output=True).returncode == 0,
             'watchActive': subprocess.run(['systemctl', 'is-active', '--quiet', WATCH], capture_output=True).returncode == 0,
             'previousGuard': guard.CONFIG.exists() and not guard.DISABLED.exists()}
    for path in files:
        if path.is_symlink():
            raise ValueError('refusing to replace symlink: ' + str(path))
        state['files'][str(path)] = path.exists()
        if path.exists():
            saved = backup / str(path).lstrip('/')
            saved.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, saved)
    for family in ['bridge', 'inet']:
        old = subprocess.run([guard.NFT, 'list', 'table', family, guard.TABLE], text=True, capture_output=True)
        if old.returncode and 'No such file or directory' not in old.stderr:
            raise RuntimeError(old.stderr)
        (backup / (family + '.nft')).write_text(old.stdout)
    (backup / 'state.json').write_text(json.dumps(state, indent=2))
    source = Path(__file__).resolve().parent
    for name in ['install-guard.py', 'guard.py']:
        shutil.copy2(source / name, backup / name)
    run('systemd-run', '--unit=' + state['timer'], '--on-active=' + str(args.rollback_seconds) + 's',
        sys.executable, str(backup / 'install-guard.py'), '--auto-rollback', str(backup))
    try:
        script = (source / 'guard.py').read_bytes()
        write(BINARY, script, 0o755)
        write(CNI_BINARY, script, 0o755)
        write(guard.CONFIG, json.dumps(settings, indent=2) + '\n', 0o600)
        write(CUSTOM_CNI, json.dumps(config, indent=2) + '\n')
        write(K3S_CONFIG, 'flannel-cni-conf: ' + str(CUSTOM_CNI) + '\n')
        write(UNIT, '[Unit]\nDescription=Pulpo workspace CNI identity guard\nAfter=local-fs.target\nBefore=k3s.service\n\n'
              '[Service]\nType=oneshot\nRemainAfterExit=yes\nExecStart=' + str(BINARY) + ' reload\nExecReload=' + str(BINARY) + ' reload\n\n'
              '[Install]\nWantedBy=multi-user.target\n')
        write(K3S_UNIT, '[Unit]\nWants=' + SERVICE + ' ' + WATCH + '\nAfter=' + SERVICE + ' ' + WATCH + '\n\n'
              '[Service]\nExecStartPre=' + str(BINARY) + ' reload\n')
        write(WATCH_UNIT, '[Unit]\nDescription=Reconcile late CNI workspace identities\n'
              'After=local-fs.target\nBefore=k3s.service\n\n'
              '[Path]\nPathChanged=' + str(guard.CACHE) + '\nUnit=' + RECONCILE + '\n'
              'TriggerLimitIntervalSec=0\n\n[Install]\nWantedBy=multi-user.target\n')
        write(RECONCILE_UNIT, '[Unit]\nDescription=Reconcile cached CNI identities\n'
              'StartLimitIntervalSec=0\nConditionPathExists=' + str(guard.CONFIG) + '\n'
              'ConditionPathExists=!' + str(guard.DISABLED) + '\n\n'
              '[Service]\nType=oneshot\nExecStart=' + str(BINARY) + ' reload\n'
              'TimeoutStartSec=30s\nRestart=on-failure\nRestartSec=1s\n')
        guard.DISABLED.unlink(missing_ok=True)
        run('systemctl', 'daemon-reload')
        run('systemctl', 'enable', SERVICE)
        run('systemctl', 'enable', WATCH)
        # Start watching before handing off the conflist. Old ADDs do not hold
        # our lock and may commit libcni caches arbitrarily late; their close/
        # rename events must trigger adoption after the final initial reload.
        run('systemctl', 'start', WATCH)
        # The CNI and installer share a lock. A new guarded ADD cannot return
        # until these tables and all identities have been committed atomically.
        write(ACTIVE_CNI, CUSTOM_CNI.read_bytes())
        guard.apply(entries, settings)
        guard.atomic_json(guard.STATE / 'endpoints.json', entries)
    except BaseException:
        restore(backup)
        raise
    print('Backup:', backup)
    print('Guard installed without restarting K3s. After live verification, confirm:')
    print(f'sudo python3 {backup}/install-guard.py --confirm {backup}')
    return backup


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--confirm', type=validated_backup)
    group.add_argument('--rollback', type=validated_backup)
    group.add_argument('--auto-rollback', type=validated_backup, help=argparse.SUPPRESS)
    parser.add_argument('--rollback-seconds', type=int, default=900)
    parser.add_argument('--bridge', default='cni0')
    parser.add_argument('--proxy-service', default='10.43.47.50')
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error('run as root')
    start_service = False
    with guard.locked():
        if args.auto_rollback and ((args.auto_rollback / 'confirmed').exists()
                                   or (args.auto_rollback / 'rolled-back').exists()):
            return
        chosen = args.confirm or args.rollback or args.auto_rollback
        if chosen and any(p != chosen for p in pending()):
            raise ValueError('resolve the pending installation first')
        if args.confirm:
            if (args.confirm / 'rolled-back').exists():
                raise ValueError('installation already rolled back')
            state = json.loads((args.confirm / 'state.json').read_text())
            for family in ['bridge', 'inet']:
                guard.run(guard.NFT, 'list', 'table', family, guard.TABLE)
            run('systemctl', 'is-active', SERVICE)
            run('systemctl', 'is-active', WATCH)
            run('systemctl', 'stop', state['timer'] + '.timer')
            (args.confirm / 'confirmed').touch()
            print('Confirmed; automatic rollback cancelled:', args.confirm)
        elif args.rollback or args.auto_rollback:
            restore(chosen, automatic=bool(args.auto_rollback))
        else:
            backup = install(args)
            start_service = True
    # The service takes the same guard lock; start it only after releasing ours.
    if start_service:
        try:
            run('systemctl', 'restart', SERVICE)
        except BaseException:
            with guard.locked():
                restore(backup)
            raise


if __name__ == '__main__':
    main()
