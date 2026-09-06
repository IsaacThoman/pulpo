#!/usr/bin/env python3
"""Bounded six-VM saturation test against a separate test containerd socket.

Run as root on the controller VM after configuring a TEST snapshotter with
256 MiB disks and <=2 GiB total budget. Never points at the k3s production socket.
"""
import concurrent.futures
import json
import subprocess

ADDRESS = '/run/pulpo-storage-test/containerd.sock'
IMAGE = 'docker.io/library/alpine@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce'
BASE = ['k3s', 'ctr', '--address', ADDRESS, 'run', '--rm', '--snapshotter', 'pulpo-bounded',
        '--runtime', '/opt/kata/runtime-rs/bin/containerd-shim-kata-v2',
        '--runtime-config-path', '/var/lib/pulpo-storage-test/kata.toml', IMAGE]


def run(worker):
    check = 'test "$(cat /sys/class/block/sda/size)" -eq 524288 || exit 70; '
    if worker == 5:
        command = 'i=0; while [ "$i" -lt 15 ]; do echo responsive; i=$((i+1)); sleep 1; done'
    else:
        command = 'dd if=/dev/zero of=/fill bs=1M count=512; rc=$?; df -k /; test "$rc" -ne 0 && test -f /etc/alpine-release'
    result = subprocess.run(BASE + [f'pulpo-storage-fill-{worker}', 'sh', '-c', check + command],
                            capture_output=True, text=True, timeout=120)
    return dict(worker=worker, exit=result.returncode, out=result.stdout, err=result.stderr)


def main():
    before = subprocess.check_output(['df', '-B1', '/'], text=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
        results = list(executor.map(run, range(6)))
    print(json.dumps(dict(before=before, after=subprocess.check_output(['df', '-B1', '/'], text=True), results=results), indent=2))
    assert all(result['exit'] == 0 for result in results)
    assert all('No space left on device' in result['err'] for result in results[:5])
    assert results[5]['out'].count('responsive') == 15


if __name__ == '__main__':
    main()
