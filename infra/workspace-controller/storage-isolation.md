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
establish hard workspace storage isolation.** That requires the infrastructure
changes below. Do not repeat disk-exhaustion tests on the shared production node.

## Rollout order

1. Recover the currently unavailable controller if still necessary. The original
   image archive was present at
   `/home/isaac/actions-runner/_work/pulpo/pulpo/deploy/controller.tar.gz` on
   `pulpo-agents`. Verify its image ID against the previous controller image ID
   before reimporting it into containerd's `k8s.io` namespace and restoring the
   exact tag referenced by the Deployment. This is temporary incident recovery,
   not the new deployment mechanism. Confirm one ready controller endpoint and
   successful workspace provisioning. Treat evicted workspace files as lost.
2. Merge the repository changes through `dev` to `main` to publish the durable
   controller image. Configure GHCR visibility or durable cluster pull
   credentials, then run the guarded deployment. Apply the manifest's resource
   reservations and PriorityClass separately while preserving live settings.
   Keep the controller a singleton: multiple replicas require leader election
   and shared lease/capacity coordination first.
3. Provision an isolated test worker and a dedicated workspace storage pool.
   Inspect the hypervisor, free LVM extents, and physical backing before choosing
   devices. Do not resize, format, or repurpose a mounted production filesystem
   as part of the application deployment.
4. Implement and verify host-enforced workspace disk limits on that worker.
   Only advertise a workspace as storage-isolated after the tests below pass.
5. Drain active production workspaces during a maintenance window. Stop admitting
   new work, let leases finish or explicitly expire them, switch the runtime and
   node placement, and recreate matching warm capacity. Existing pods retain
   their original storage arrangement; changing a RuntimeClass does not migrate
   their filesystems. Re-enable admission only after provisioning checks pass.

## Hard storage boundary

For a workspace with a writable OS and passwordless sudo, prefer a bounded
block-backed root filesystem. Investigate Kata's direct block-device support
with containerd's devmapper snapshotter on the installed Kata/k3s versions. A
separate volume mounted only at `/workspace` leaves writes to `/tmp`, `/home`,
and package installations unbounded; it is insufficient for this workload.

The design must enforce a maximum on **every** writable path outside the guest's
control. Include root filesystem/image overhead when defining total disk size
and the usable allowance presented to users. Memory-backed filesystems need
their own memory limits. If filesystem project quotas are used instead of block
devices, the host must actually set and enforce byte and inode limits for each
workspace's writable layer; Kubernetes quota accounting alone does not do this.

Keep the workspace pool separate from the host OS, Kubernetes state, and
controller image/log storage. Admission must atomically reserve backing capacity
for active, starting, and warm workspaces across all Pulpo instances. Include
base images, snapshots, pool metadata, and operational headroom. Release space
reservations only after storage deletion is confirmed, and reconstruct them
after restarts. A failed reservation must queue or reject provisioning.

Thin disks must not overcommit the pool: five 20 GiB allocations must all be able
to fill at once without exhausting the pool, including its metadata. Disk size
configuration without this admission rule merely moves the shared failure to
the thin pool. Fail closed when backing-space accounting is unavailable.

For stronger availability, put the controller and Kubernetes control plane on a
management node where workspace pods cannot schedule. Preserve the controller's
private reachability and RBAC. Restrict workspace placement through the
RuntimeClass/node labels so a scheduling fallback cannot land on management
storage. Do not add a second controller replica as an availability shortcut.

## Other host resource limits

- Configure kubelet container-log size/count limits on workspace nodes and host
  log rotation/retention. Host-side stdout/stderr logs remain shared storage even
  with bounded guest disks. Exercise log flooding to measure rotation overshoot.
- Reserve node capacity for Kubernetes and OS processes; monitor bytes and
  inodes on the host and workspace pools, including thin-pool metadata.
- Apply and validate disk I/O throttling using a backend supported by the chosen
  runtime so concurrent writers cannot starve the controller or other workspaces.
- Alert on absent controller endpoints, sustained failed image pulls, node disk
  pressure, backing-pool headroom, and repeated workspace storage failures. Route
  notifications through an agreed monitoring destination outside this node.

These require node/runtime and monitoring configuration. Neither tighter polling
nor a smaller `emptyDir.sizeLimit` substitutes for hard storage enforcement.

## Acceptance tests on an isolated worker

1. Fill a workspace past its allowance through `/workspace`, `/tmp`, the home
   directory, and the writable OS, including as guest root. Verify writes fail
   at the bound and host free space remains protected. Test many small files,
   sparse-file allocation, and deleted-but-open files as well as sequential writes.
2. Run five writers concurrently while a sixth workspace executes normal tools.
   Each writer must hit its own bound. The sixth workspace, controller health,
   and Kubernetes API must remain responsive; host storage must not exhaust.
3. Exhaust reservable pool capacity. Further cold starts and warm replenishment
   must queue/reject before allocation. Test concurrent claims, controller/node
   restarts, failed creation, delayed deletion, and reservation reconstruction.
4. Flood stdout/stderr and saturate disk I/O. Verify bounded host log growth,
   useful tool latency in another workspace, and controller availability.
5. On a disposable node with no cached controller layers, pull the published
   digest using the cluster credentials and start the controller. Remove registry
   access and confirm a proposed upgrade fails its pull check before replacing
   a healthy controller. Restore access and verify deployment succeeds.
6. Delete/recreate workspace pods and confirm backing storage is reclaimed and
   the new workspace cannot access an earlier lease's files.

Record measured limits, overshoot, host/pool headroom, and recovery times before
production migration. A passing image build or Kubernetes dry-run is not evidence
that the storage boundary is enforced.

## References

- [Kubernetes local ephemeral storage](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/#local-ephemeral-storage)
- [Kata storage architecture](https://github.com/kata-containers/kata-containers/blob/main/docs/design/architecture/storage.md)
- [Containerd devmapper configuration](https://github.com/containerd/containerd/blob/main/docs/snapshotters/devmapper.md)
- [Kubernetes node-pressure eviction](https://kubernetes.io/docs/concepts/scheduling-eviction/node-pressure-eviction/)
