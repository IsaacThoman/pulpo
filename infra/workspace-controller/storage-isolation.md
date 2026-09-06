# Workspace storage isolation and recovery

## Failure being addressed

On September 5, 2026, concurrent production workspaces exhausted the shared
250 GiB node filesystem. At 19:57:11 UTC Kubernetes evicted the controller for
ephemeral-storage pressure. At 19:57:13 it garbage-collected the controller's
locally imported image. The replacement could not pull that unpublished image
and remained in `ImagePullBackOff` after free disk space recovered.

The surviving workspaces mounted their root filesystem through `virtiofs`;
`/`, `/workspace`, and `/tmp` reported the host filesystem's capacity. Their
20 GiB Kubernetes `ephemeral-storage` limits caused eviction after excess usage
was observed, not write-time rejection at 20 GiB. Several concurrent writers
could fill the host before eviction. An agent seeing a large `df` value therefore
does not have a dedicated disk of that size.

Registry publication, a pre-deployment pull check, controller reservations, and
priority address recovery and reduce controller eviction risk. **They do not
establish hard workspace storage isolation.** The implemented host integration is described below. Saturation tests must use
verified bounded disks and an explicit aggregate budget.

## Implemented storage boundary

The implementation uses fixed-size ext4 disk images on the existing VM, exposed
through Kata and containerd's EROFS snapshotter. A host snapshotter adapter
preallocates disks before startup, enforces a shared writable budget and a host
free-space floor, and reconstructs reservations from surviving files and open
descriptors after restart. No new hypervisor disk is required.

See [workspace storage installation](../workspace-storage/README.md) for the
runtime configuration, capacity accounting, migration/rollback steps, limitations,
and [measured verification](../workspace-storage/verification.md).

The controller recovery changes remain necessary: durable registry publication,
pull checks, resource reservations and priority. They do not replace the storage
boundary. Keep private GHCR credentials durable and scoped to read-only package
access; do not use an administrator's broad GitHub token in the cluster.

A separate management node or dedicated physical storage can further isolate
hardware, host-service and I/O failures. Those are optional availability changes,
not prerequisites for enforcing each workspace's writable disk size.
