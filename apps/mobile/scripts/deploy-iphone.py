#!/usr/bin/env python3
"""Deploy the invoking worktree from one persistent, serialized build directory."""

import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


def remove(path):
    if path.is_symlink() or path.is_file():
        path.unlink()
    elif path.is_dir():
        shutil.rmtree(path)


def write_json(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value))
    temporary.replace(path)


def source_files(source):
    output = subprocess.check_output(
        ['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd=source,
    )
    paths = {os.fsdecode(name) for name in output.split(b'\0') if name}
    # Expo loads these ignored files too. Never inherit another worktree's environment.
    for directory in (source, source / 'apps/mobile'):
        paths.update(str(path.relative_to(source)) for path in directory.glob('.env*') if path.is_file())
    return sorted(name for name in paths if (source / name).is_file() or (source / name).is_symlink())


def sync_source(source, checkout, manifest):
    names = source_files(source)
    previous = json.loads(manifest.read_text()) if manifest.exists() else []
    if any(Path(name).is_absolute() or '..' in Path(name).parts for name in previous):
        raise RuntimeError('Invalid source snapshot manifest')
    # Record new files before copying so an interrupted sync can still remove them later.
    write_json(manifest, sorted(set(previous) | set(names)))
    for name in sorted(set(previous) - set(names), reverse=True):
        # An interrupted directory-to-symlink change can leave old child entries.
        # Those children no longer belong to the snapshot; do not follow the link.
        if not any((checkout / parent).is_symlink() for parent in Path(name).parents):
            remove(checkout / name)
    for name in names:
        original, target = source / name, checkout / name
        for parent in reversed(target.relative_to(checkout).parents):
            directory = checkout / parent
            if directory.is_symlink() or directory.is_file():
                remove(directory)
            directory.mkdir(exist_ok=True)
        if original.is_symlink():
            if target.is_symlink() and os.readlink(original) == os.readlink(target):
                continue
            remove(target)
            target.symlink_to(os.readlink(original))
        elif not target.is_symlink() and target.is_file() and original.read_bytes() == target.read_bytes():
            # Different worktrees have different mtimes. Keep warm build inputs unchanged.
            mode = original.stat().st_mode & 0o777
            if target.stat().st_mode & 0o777 != mode:
                target.chmod(mode)
        else:
            remove(target)
            shutil.copy2(original, target)
    write_json(manifest, names)
    return names


def input_hash(checkout, names, extra):
    digest = hashlib.sha256(extra.encode())
    for name in sorted(names):
        digest.update(name.encode() + b'\0')
        digest.update((checkout / name).read_bytes() + b'\0')
    return digest.hexdigest()


def refresh(stamp, fingerprint, ready, action):
    if ready and stamp.exists() and stamp.read_text() == fingerprint:
        return
    # A failed refresh must not leave a stamp that could validate a partial build later.
    stamp.unlink(missing_ok=True)
    action()
    stamp.write_text(fingerprint)


def deploy(source, root, log, lock_fd):
    checkout = root / 'checkout'
    checkout.mkdir(exist_ok=True)
    names = sync_source(source, checkout, root / 'source-files.json')
    mobile = checkout / 'apps/mobile'
    configuration = os.environ.get('PULPO_IOS_CONFIGURATION', 'Release')
    environment = dict(os.environ)
    environment['EXPO_PUBLIC_DEFAULT_INSTANCE_URL'] = os.environ.get('PULPO_INSTANCE_URL', 'https://pulpo.baby')
    environment['CI'] = '1'
    environment.setdefault('NODE_ENV', 'production' if configuration == 'Release' else 'development')
    # npm invokes us inside the source workspace. Child tools must see the stable checkout.
    environment['PWD'] = str(mobile)
    environment['INIT_CWD'] = str(checkout)

    def run(arguments, cwd=mobile, capture=False):
        print('+ ' + ' '.join(arguments), file=log, flush=True)
        return subprocess.run(
            arguments, cwd=cwd, env=dict(environment, PWD=str(cwd)), check=True, text=True,
            stdout=subprocess.PIPE if capture else log, stderr=log,
            # Keep the lock held if this process is killed while a build child survives.
            pass_fds=(lock_fd,),
        ).stdout

    dependency_files = [name for name in names if Path(name).name in ('package.json', 'package-lock.json', '.npmrc')]
    versions = run(['node', '--version'], capture=True) + run(['npm', '--version'], capture=True)
    dependencies = input_hash(checkout, dependency_files, versions)
    refresh(
        root / 'dependencies.sha256', dependencies,
        (checkout / 'node_modules/.package-lock.json').exists(),
        lambda: run(['npm', 'ci', '--include=dev', '--no-audit', '--no-fund'], cwd=checkout),
    )
    # Workspace packages expose dist/. Build the snapshot, never copy stale outputs.
    for package in ('contracts', 'client-core'):
        remove(checkout / 'packages' / package / 'dist')
        run(['npm', 'run', 'build', '-w', '@pulpo/' + package], cwd=checkout)

    fingerprint = run(['node', 'scripts/iphone-native-fingerprint.cjs'], capture=True).strip()
    if len(fingerprint) != 40 or any(character not in '0123456789abcdef' for character in fingerprint):
        raise RuntimeError('Expo did not return a valid native fingerprint')
    # Include the dependency hash even for changes outside Expo's native dependency graph.
    refresh(
        root / 'native.sha256', dependencies + ':' + fingerprint,
        (mobile / 'ios/Podfile').exists() and (mobile / 'ios/Pods/Manifest.lock').exists(),
        lambda: run(['npx', '--no-install', 'expo', 'prebuild', '--clean', '--platform', 'ios']),
    )
    device = os.environ.get('PULPO_IOS_DEVICE', 'Isaac iphone')
    run(['npx', '--no-install', 'expo', 'run:ios', '--device', device,
         '--configuration', configuration, '--no-bundler'])
    run(['xcrun', 'devicectl', 'device', 'process', 'launch', '--device', device, 'com.isaacthoman.pulpo'])


def main():
    source = Path(__file__).resolve().parents[3]
    root = Path(os.environ.get('PULPO_IOS_BUILD_ROOT', '~/.cache/pulpo/iphone-build')).expanduser().resolve()
    if root == source or source in root.parents or root in source.parents:
        raise RuntimeError('The iPhone build directory must be separate from the source checkout')
    root.mkdir(parents=True, exist_ok=True)
    print(f'Deploying Pulpo from {root / "checkout"}. Waiting for the deployment lock…', flush=True)
    # Never unlink the lock: waiters and new callers must lock the same inode.
    with (root / 'deploy.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        marker = root / '.pulpo-iphone-build'
        if not marker.exists():
            if any(path.name != 'deploy.lock' for path in root.iterdir()):
                raise RuntimeError(f'Refusing to reuse an unrecognized nonempty build directory: {root}')
            marker.touch()
        log_path = Path(os.environ.get('PULPO_IOS_DEPLOY_LOG', '/tmp/pulpo-ios-deploy.log')).expanduser()
        # Open only after acquiring the lock, so queued deployments cannot truncate the active log.
        try:
            with log_path.open('w') as log:
                deploy(source, root, log, lock.fileno())
        except (Exception, KeyboardInterrupt) as error:
            print(f'Deployment failed: {error}. Full log: {log_path}', file=sys.stderr)
            if log_path.exists():
                print('Last 80 log lines:', file=sys.stderr)
                print(''.join(log_path.read_text(errors='replace').splitlines(keepends=True)[-80:]), file=sys.stderr)
            return error.returncode if isinstance(error, subprocess.CalledProcessError) else 1
    print(f'Deployed and launched Pulpo {os.environ.get("PULPO_IOS_CONFIGURATION", "Release")} '
          f'on {os.environ.get("PULPO_IOS_DEVICE", "Isaac iphone")}.')
    print(f'Full log: {log_path}')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        sys.exit(str(error))
