# Bounded Kata workspace storage

`pulpo-snapshotter` wraps containerd v2.3.2's EROFS snapshotter over its standard
Unix-socket snapshot API. It allocates and formats a private ext4 disk before
returning a runnable workspace rootfs. Read-only image layers remain shared.
No new hypervisor disk, filesystem resize, or LVM partition is required.

## Enforced behavior

- A workspace has a 20 GiB virtual writable disk, including filesystem metadata.
  `/`, `/workspace`, `/tmp`, and `/home/agent` use its writable overlay layer.
- `fallocate` reserves backing blocks before startup. `mkfs.ext4` uses
  `nodiscard` and eager metadata initialization. Allocation/format failure does
  not return a usable rootfs. Published images are never reformatted on remount.
- A process lock and serialized snapshot lifecycle prevent concurrent allocation
  races. Files are the durable ledger, including incomplete files, pending
  cleanup, and deleted images still held open by a host process. The 128 GiB
  writable budget and 40 GiB free-space floor apply before every new allocation.
- Kata receives a prepared `ext4` mount. The tested runtime silently falls back
  to a memory upper when given an unprocessed `mkfs/ext4` mount; the adapter
  resolves that descriptor before task startup. Image extraction retains the
  descriptor that containerd's EROFS differ requires.
- The pinned pause image chain gets a separate 128 MiB disk. Kubernetes creates
  both a sandbox snapshot and a workspace snapshot per Pod; both count toward
  the budget. Other parents receive the full workspace allocation. Unknown pause
  versions consume 20 GiB and cannot bypass the budget.
- The controller caps total pending/running/terminating workspace pods at six
  and rejects unsupported requested disk sizes. The host allocator independently
  enforces the budget, including after a controller crash. Completed Pod records
  do not release physical storage reservations.
- A startup guard checks the filesystem capacity of the writable paths before
  importing the workspace daemon. Warm pods from a different runtime cannot be
  reused. The 21 GiB kubelet eviction threshold includes a 1 GiB log allowance;
  it does not enlarge the 20 GiB guest disk.

This enforces workspace writable storage. Host OS writes and image content
remain shared: log rotation, journal caps, image GC, operational headroom and
monitoring are still necessary. The free-space floor is an admission check,
not a partition that restricts arbitrary host administrators or other services.
It also does not guarantee physical capacity in a thin-provisioned hypervisor
storage pool outside this VM. Guest memory filesystems retain VM memory limits.

## Build and install

The verified node has k3s 1.36.2, containerd 2.3.2-k3s2, Kata runtime-rs 4.0.0
(commit `cf82bb35c80320178bf7570252fe75d6fb263209`), QEMU, Ubuntu 24.04 ext4 and
erofs-utils 1.7.1. Pin and retest runtime upgrades, especially discard handling.

```sh
cd infra/workspace-storage
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -o pulpo-snapshotter .
# Copy binary and install.py to the node; erofs-utils must already be installed.
sudo python3 install.py --binary ./pulpo-snapshotter \
  --kata-config /path/to/working/configuration-qemu-runtime-rs.toml
```

The installer backs up replaced files under `/var/backups/pulpo-workspace-storage`
and records previously absent files in `files.json`. It installs a systemd
snapshotter service and persistent containerd/kubelet configuration. Restart k3s
in a maintenance window (`--restart-k3s` does this explicitly). Kubelet 1.36
requires a log-monitor interval of at least **3 seconds**.

Pre-pull both the pinned sandbox image and the intended workspace image into the
new snapshotter. Cached OverlayFS images can lack original compressed layers
because of content GC; re-unpacking them into EROFS otherwise fails:

```sh
sudo k3s ctr -n k8s.io images pull --local --platform linux/amd64 \
  --snapshotter pulpo-bounded docker.io/rancher/mirrored-pause@sha256:74c4244427b7312c5b901fe0f67cbc53683d06f4f24c6faee65d4182bf0fa893
sudo k3s ctr -n k8s.io images pull --local --platform linux/amd64 \
  --snapshotter pulpo-bounded ghcr.io/OWNER/WORKSPACE@sha256:DIGEST
```

Confirm the runtime and snapshotter plugins report `ok`, then apply
`runtimeclass.yaml` and label only the verified node
`pulpo.dev/storage=bounded-erofs-v1`. Create a canary with the bounded
RuntimeClass and the controller's startup guard before selecting
`PULPO_RUNTIME_CLASS=kata-pulpo-bounded` in the controller. Existing pods retain
old storage; drain/recreate them rather than assuming a runtime change migrates
files. Keep the controller singleton.

Rollback: restore the controller's previous image/runtime settings, drain bounded
pods, restore files from the recorded backup (remove only files recorded as
previously absent), then restart k3s. Do not delete snapshotter data while any VM
uses it. Keep the snapshotter running until bounded pods and their snapshots are
fully removed.

## Verification

CI builds the service and runs real Linux ext4 allocation tests as root, including
concurrent admission, restart, insufficient headroom, cleanup and deleted-open
disk accounting. It does not emulate Kata.

`verify.py` targets only a separate test containerd at
`/run/pulpo-storage-test/containerd.sock`, with 256 MiB disks and a <=2 GiB budget.
Its five simultaneous writers must receive ENOSPC while a sixth VM remains
responsive. Do not change it to point at the production containerd socket.

See `verification.md` for the live test results and rollout status.
