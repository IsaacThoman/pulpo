# Storage verification — September 6, 2026

Verified on `pulpo-agents` using a separate test containerd socket/state root.
The production controller and old warm workspace remained running during the
initial saturation tests.

- Five concurrent 256 MiB Kata disks each rejected writes with ENOSPC at
  229,179,392 data bytes (filesystem/journal overhead occupies the remainder).
  A sixth VM emitted all 15 one-second responsiveness probes.
- The existing Pulpo workspace image ran as UID 1000; passwordless sudo obtained
  guest root. `/`, `/workspace`, `/tmp` and `/home/agent` reported the same disk.
- A deleted-but-open file exhausted only its guest filesystem and released its
  space when closed. Creating tiny files reached ENOSPC at 65,517 files.
  Writing a sparse 1 TiB logical file stopped at the physical disk boundary.
  Normal writes worked after cleanup.
- Initial six allocation tests passed: concurrent budget enforcement, restart/remount
  preservation, incomplete allocation/symlink refusal, host headroom refusal,
  deleted-open backing disk retention, and Kata ext4 mount descriptor handling.
- A Kubernetes canary passed the daemon startup guard with the full 20 GiB disk.
  Allocating 19 GiB and then attempting another 2 GiB returned ENOSPC; cleanup
  restored writes. Controller and original warm pod remained Ready.
- Verified effective kubelet settings: 10 MiB logs, three files, three-second
  monitoring, six rotation workers, and 40 GiB system storage reservation.

Issues discovered and corrected during testing:

- Passing `mkfs/ext4` directly to Kata caused a memory-backed upper fallback.
- Cached pause-image compressed content had been garbage-collected; explicitly
  pulling it into the new snapshotter repaired conversion.
- Kubernetes rejects a log-monitor interval below three seconds. The initial
  one-second setting briefly interrupted the API during the configuration test;
  it was corrected to three seconds and the node returned Ready.
- Kubernetes creates a separate pause sandbox snapshot. It receives a pinned
  128 MiB allowance rather than wasting another 20 GiB per workspace.

The production rollout results follow below.

Controller integration in a separate Kubernetes namespace:

- The updated controller rejected a requested 50 GiB allowance, created and
  claimed a bounded workspace, and executed a command through the normal
  controller → daemon API. Guest sudo worked and the writable filesystem
  reported 20,957,446,144 filesystem bytes on its 20 GiB virtual block device.
- Confirmed the pause sandbox uses 134,217,728 bytes while the workspace uses
  21,474,836,480 bytes. A seventh allocation regression test covers containerd's
  namespaced parent keys, which otherwise defeat exact pause-chain matching.

## Production rollout

PR #486 merged into dev as `a10481f2c65077b44a754be4cf9eed47675cb401`.
The controller VM runs the tested controller build from source `e4b3e452` and
`PULPO_RUNTIME_CLASS=kata-pulpo-bounded`, with a six-Pod ceiling. Old unclaimed
OverlayFS warm capacity was replaced. No active user lease needed termination.

The real HTTPS controller API passed its health check, claimed a new bounded
workspace, executed guest-root and filesystem checks through the daemon, and
released the verification lease. All checked writable paths reported
20,957,446,144 filesystem bytes within the 20 GiB virtual disk. The new warm pod
and controller were Ready. A separate controller restart test recovered both
leases and preserved the file written before restart; configured Pod capacity
rejected an additional workspace.

The host snapshotter service has a 128 GiB aggregate writable budget, a 40 GiB
free-space floor, and a 128 MiB reservation for the pinned pause sandbox. The
small-disk, multi-VM test services and test namespace are no longer needed for
normal operation. Test disks are not part of the production allocation pool.

### Pending registry promotion

The live controller image is temporarily
`docker.io/library/pulpo-workspace-controller:storage-e4b3e452`, imported for the
authorized VM rollout. Its OCI index digest is
`sha256:5520b91965035e89f1172de690ad9b90ca0a2ee5ab5b774728ec969d99350dbb`.
A root-only archive is retained at
`/var/backups/pulpo-workspace-storage/images/controller-storage-e4b3e452.tar`.
The previous deployment is backed up at
`/var/backups/pulpo-workspace-storage/controller-before-storage.json`.

This archive is a recovery fallback, not a registry credential. The GHCR
controller package remains private and Kubernetes still needs a durable,
read-only pull credential (or explicitly approved public package visibility).
Resolve that before the main-branch registry deployment. The existing deployment
workflow verifies an actual Kubernetes pull before replacing this healthy
controller. No broad personal GitHub token was installed on the node.
