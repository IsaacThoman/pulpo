#!/usr/bin/env python3
"""Install the bounded Kata runtime on the verified single-node k3s host.

Requires a prebuilt linux/amd64 binary and an explicit working Kata config.
Backs up every replaced file. Normal installation leaves existing workloads on
 their current RuntimeClass; selecting kata-pulpo-bounded is a separate rollout.
"""
import argparse
import datetime
import json
import os
from pathlib import Path
import shutil
import subprocess
import tomllib


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', required=True, type=Path)
    parser.add_argument('--kata-config', required=True, type=Path)
    parser.add_argument('--restart-k3s', action='store_true')
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error('run as root')
    kata = args.kata_config.read_text()
    config = tomllib.loads(kata)
    if 'qemu' not in config.get('hypervisor', {}):
        parser.error('requires the verified runtime-rs QEMU configuration')
    shim = Path('/opt/kata/runtime-rs/bin/containerd-shim-kata-v2')
    if not shim.is_file() or not args.binary.is_file():
        parser.error('Kata shim or snapshotter binary is missing')
    subprocess.run(['mkfs.erofs', '--help'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(['modprobe', 'erofs'], check=True)
    available = shutil.disk_usage('/var/lib').free
    if available < 80 * 1024**3:
        parser.error('at least 80 GiB free required before installation')
    backup = Path('/var/backups/pulpo-workspace-storage') / datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup.mkdir(parents=True, mode=0o700)
    records = []

    def write(path, content, mode=0o644):
        dest = Path(path)
        if dest.is_symlink():
            raise RuntimeError(f'refusing to replace symlink: {dest}')
        exists = dest.exists()
        if exists:
            target = backup / str(dest).lstrip('/')
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(dest, target)
        records.append({'path': str(dest), 'existed': exists})
        (backup / 'files.json').write_text(json.dumps(records, indent=2))
        dest.parent.mkdir(parents=True, exist_ok=True)
        temporary = dest.with_name(dest.name + '.installing')
        temporary.write_bytes(content if isinstance(content, bytes) else content.encode())
        temporary.chmod(mode)
        temporary.replace(dest)

    write('/usr/local/libexec/pulpo-snapshotter', args.binary.read_bytes(), 0o755)
    write('/etc/pulpo/workspace-storage/kata.toml', kata)
    write('/etc/modules-load.d/pulpo-storage.conf', 'erofs\n')
    write('/etc/systemd/system/pulpo-workspace-storage.service', '''[Unit]
Description=Pulpo bounded workspace snapshotter
After=local-fs.target
Before=k3s.service
RequiresMountsFor=/var/lib/pulpo-workspace-storage

[Service]
Type=simple
ExecStart=/usr/local/libexec/pulpo-snapshotter --root /var/lib/pulpo-workspace-storage --socket /run/pulpo-workspace-storage/snapshotter.sock --disk-bytes 21474836480 --sandbox-parent sha256:1021ef88c7974bfff89c5a0ec4fd3160daac6c48a075f74cff721f85dd104e68 --budget-bytes 137438953472 --headroom-bytes 42949672960
Restart=on-failure
RestartSec=3
RuntimeDirectory=pulpo-workspace-storage
RuntimeDirectoryMode=0700
StateDirectory=pulpo-workspace-storage
StateDirectoryMode=0700
UMask=0077
CPUQuota=100%
MemoryMax=1G
# Needs host /proc to account for deleted disks still held by QEMU, and mount
# privileges for upstream image commit/cleanup. Do not hide host process state.

[Install]
WantedBy=multi-user.target
''')
    write('/var/lib/rancher/k3s/agent/etc/containerd/config-v3.toml.d/50-pulpo-storage.toml', '''[proxy_plugins.pulpo-bounded]
  type = "snapshot"
  address = "/run/pulpo-workspace-storage/snapshotter.sock"
  platform = "linux/amd64"
  [proxy_plugins.pulpo-bounded.exports]
    root = "/var/lib/pulpo-workspace-storage"
[plugins."io.containerd.service.v1.diff-service"]
  default = ["erofs", "walking"]
[plugins."io.containerd.cri.v1.runtime".containerd.runtimes.kata-pulpo-bounded]
  runtime_type = "io.containerd.kata.v2"
  runtime_path = "/opt/kata/runtime-rs/bin/containerd-shim-kata-v2"
  snapshotter = "pulpo-bounded"
  privileged_without_host_devices = true
  pod_annotations = []
  container_annotations = []
  [plugins."io.containerd.cri.v1.runtime".containerd.runtimes.kata-pulpo-bounded.options]
    ConfigPath = "/etc/pulpo/workspace-storage/kata.toml"
[plugins."io.containerd.cri.v1.images".runtime_platforms.kata-pulpo-bounded]
  platform = "linux/amd64"
  snapshotter = "pulpo-bounded"
''')
    # Preserve the existing Pulpo RuntimeClass during the migration. This node's
    # earlier kata-deploy installation left no persistent runtime registration.
    write('/var/lib/rancher/k3s/agent/etc/containerd/config-v3.toml.d/49-pulpo-legacy-kata.toml', '''[plugins."io.containerd.cri.v1.runtime".containerd.runtimes.kata-qemu-runtime-rs]
  runtime_type = "io.containerd.kata.v2"
  runtime_path = "/opt/kata/runtime-rs/bin/containerd-shim-kata-v2"
  snapshotter = "overlayfs"
  [plugins."io.containerd.cri.v1.runtime".containerd.runtimes.kata-qemu-runtime-rs.options]
    ConfigPath = "/etc/pulpo/workspace-storage/kata.toml"
''')
    write('/var/lib/rancher/k3s/agent/etc/kubelet.conf.d/50-pulpo-storage.conf', '''apiVersion: kubelet.config.k8s.io/v1beta1
kind: KubeletConfiguration
containerLogMaxSize: 10Mi
containerLogMaxFiles: 3
containerLogMonitorInterval: 3s
containerLogMaxWorkers: 6
systemReserved:
  ephemeral-storage: 40Gi
''')
    write('/etc/systemd/journald.conf.d/50-pulpo-storage.conf', '''[Journal]
SystemMaxUse=512M
RuntimeMaxUse=128M
''')
    subprocess.run(['systemctl', 'daemon-reload'], check=True)
    subprocess.run(['systemctl', 'enable', 'pulpo-workspace-storage'], check=True)
    subprocess.run(['systemctl', 'restart', 'pulpo-workspace-storage'], check=True)
    subprocess.run(['systemctl', 'restart', 'systemd-journald'], check=True)
    if args.restart_k3s:
        subprocess.run(['systemctl', 'restart', 'k3s'], check=True)
    print(f'Backup: {backup}')
    print('Select kata-pulpo-bounded only after Kubernetes canary and startup checks pass.')


if __name__ == '__main__':
    main()
