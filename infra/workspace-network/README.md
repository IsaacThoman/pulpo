# Workspace network isolation

Pulpo's Kubernetes policy lives in
[`../workspace-controller/kubernetes.yaml`](../workspace-controller/kubernetes.yaml).
On the verified K3s node it is installed and enforced, but K3s's kube-router
policy engine inserts an ICMP echo-request ACCEPT rule before individual pod
policies. Workspaces could consequently ping the LAN, node and other pods.
Standard Kubernetes NetworkPolicy does not guarantee ICMP filtering. Live tests
also found that IPv6 link-local TCP/UDP bypassed this IPv4-only policy engine.

This directory adds persistent host protection for these gaps. It does
not replace the Kubernetes policy or the external VLAN firewall.

See [live verification results](verification.md). A copy of this deployment
bundle is retained on `pulpo-agents` at
`/usr/local/share/pulpo-workspace-network/` for local administration.

## Scope

- `rules.nft` blocks pod-initiated IPv4 and IPv6 **echo requests** in the host's
  INPUT and FORWARD paths, before K3s's filter chains. It preserves echo replies,
  ICMP errors, IPv6 neighbor solicitation/advertisement and path MTU discovery.
- New pod-initiated IPv6 flows are denied because this cluster only has IPv4
  application policies. Established/related IPv6 replies and the listed ICMPv6
  errors/neighbor-discovery messages are preserved. Host-initiated IPv6 TCP/UDP
  positive controls verify replies still work. IPv6 application egress must not
  be enabled without a policy engine and rules that actually isolate it.
- All IPv4 pods in `10.42.0.0/16` are covered, including future allocations.
  Traffic entering through the local `cni0` bridge is also covered regardless
  of source address, including IPv6 link-local traffic. There is no per-pod IP
  list to update or reconciliation delay at pod creation.
- This deliberately applies to controller and system pods too, and blocks
  initiating ping to public destinations as well as private destinations.
  Host-originated administrative traffic is unaffected.
- IPv4 TCP and UDP continue through the existing Kubernetes rules: workspace egress
  allows cluster DNS on UDP/TCP 53 and public IPv4 TCP 80/443, excluding the listed
  private/special ranges. Workspace ingress permits controller TCP 8787 and
  the network implementation's node exceptions. Reply traffic is stateful.
- The verified deployment uses IPv4 pod addressing on a single node. IPv6
  link-local paths are tested separately; routed IPv6/dual-stack, additional
  CNIs/bridges, hostNetwork workloads and additional nodes require another
  review. For routed IPv6 pods, add their source ranges as well as the local
  bridge match before enabling that topology.

This closes the verified ICMP/IPv6 paths, not a complete audit of every IP protocol,
source-spoofing behavior, tunnel, service NAT path or tenant isolation boundary.
Successful DNS/HTTPS tests and blocked peer TCP/UDP tests complement it.

## Install

Requires root, Python 3, systemd, nftables, K3s, the `cni0` bridge and the pod
range above. Inspect and adjust the range/bridge before using on another node.
The verified system uses Ubuntu 24.04, nftables 1.0.9 and K3s 1.36.2+k3s1.

Copy this directory to the host, then run:

```sh
sudo python3 install.py
```

The installer first checks nft syntax against the host kernel. It backs up only
the files and table it owns under `/var/backups/pulpo-workspace-network/`, arms
a ten-minute automatic rollback, then installs:

| File | Purpose |
| --- | --- |
| `/etc/pulpo/workspace-network/rules.nft` | Dedicated `inet pulpo_workspace_network` table |
| `/etc/systemd/system/pulpo-workspace-network.service` | Enabled at boot; atomic start/reload |
| `/etc/systemd/system/k3s.service.d/50-pulpo-network.conf` | Orders the firewall before K3s and reloads rules on every K3s start |

The K3s `ExecStartPre` fails startup if the rules cannot load. The installer does
not restart K3s, reboot the host, enable Ubuntu's generic `nftables.service`, or
flush KUBE/FLANNEL tables. Stopping the dedicated service leaves its rules in
place; restarting it replaces only its own table in one transaction. Reloading
resets its counters without creating an unprotected interval.

Run the verification below and check a fresh SSH connection. Then run the exact
`--confirm BACKUP_PATH` command printed by the installer to cancel rollback.
For slower testing, select `--rollback-seconds 1200` before installation. Do not
leave the rollback timer armed after a successful deployment. The timer is a
transient systemd timer; it is not a substitute for recovery access across a
host reboot. Complete confirmation before rebooting.

Review loaded rules and persistence with:

```sh
sudo nft list table inet pulpo_workspace_network
sudo systemctl is-enabled pulpo-workspace-network.service
sudo systemctl is-active pulpo-workspace-network.service
sudo systemctl cat k3s.service
sudo systemctl restart pulpo-workspace-network.service
sudo systemctl reload pulpo-workspace-network.service
```

Re-run the connectivity checks after the firewall service restart/reload.
An actual K3s restart and machine reboot are separate operational checks: during
a maintenance window, confirm the table is present and repeat the probes after
each. A service reload alone does not prove that a machine reboot was tested.

## Connectivity verification

Use two ready, disposable workspaces with the same image, bounded Kata runtime,
startup guard and network-policy label as production. They must be scheduled
on the node running the verifier. One existing workspace can also be used;
the probes do not read its files or alter its configuration. Reserve capacity
before creating a diagnostic pod; it still consumes a 20 GiB backing disk and
counts toward the six-pod cap. Use `pulpo.dev/state: network-check`, no lease or
instance annotations, a new daemon token, an `activeDeadlineSeconds` limit and
an explicit cleanup plan so the controller cannot hand the pod to a user.

```sh
sudo python3 verify.py --pods WORKSPACE_A WORKSPACE_B \
  --node-ip 192.168.8.198 --lan-ip 192.168.8.69
```

The verifier uses the existing Python runtime, without installing ping or other
packages. It checks both directions for peer ICMP/TCP/UDP, LAN and host ping,
IPv6 link-local ping/TCP/UDP, selected private TCP endpoints, cluster UDP/TCP DNS,
public HTTPS downloads, and actual controller-to-workspace HTTP health checks.
Temporary UDP echo listeners expire after 45 seconds, even if the SSH session
is interrupted. A host-side positive control verifies those listeners really
answer; check the K3s rejection counters as well to distinguish filtering from
an absent service. The script exits nonzero if an expectation fails.

Before first installation, use `--expect-ping allowed --expect-ipv6 allowed` to
demonstrate reachable ICMP and IPv6 destinations. Without that baseline, a timeout alone does not establish
that a rule blocked a reachable endpoint. IPv6 tests should fail visibly if a
previously reachable link-local destination becomes reachable again after the
rule is installed. Recreating the diagnostic pod and repeating probes confirms
new addresses are covered without editing the firewall.

Delete only diagnostic pods created for the test, then verify their records and
storage allocations are reclaimed. Never delete a user's workspace for QA.

## Rollback

Before confirmation the timer restores the previous table/files automatically.
Manual rollback uses the installer preserved in that installation's backup:

```sh
sudo python3 /var/backups/pulpo-workspace-network/TIMESTAMP/install.py \
  --rollback /var/backups/pulpo-workspace-network/TIMESTAMP
```

Rollback restores just Pulpo's dedicated table/files and the service's original
enabled/active state. On first installation it removes that table and its files,
returning to the previous K3s behavior where ping and IPv6 link-local application
connections are permitted. It never flushes
the full ruleset or stops K3s.

## External network boundary

The VLAN gateway should deny connections from the workspace network to LAN and
management networks except explicitly required services, for IPv4 and IPv6.
That is configured outside this host. A shared workspace VLAN does not isolate
pods within a node or VLAN; retain and test host/Kubernetes enforcement.

References: [Kubernetes NetworkPolicy protocol limitations](https://kubernetes.io/docs/concepts/services-networking/network-policies/#network-traffic-filtering),
[K3s network policy controller](https://docs.k3s.io/networking/networking-services#network-policy-controller),
[nftables chain ordering and verdicts](https://netfilter.org/projects/nftables/manpage.html).
