# Live network verification — September 17, 2026

Target: `pulpo-agents` (`192.168.8.198`), Ubuntu 24.04, K3s 1.36.2+k3s1,
nftables 1.0.9, `kata-pulpo-bounded`. The existing workspace used
`10.42.0.101`. Diagnostic workspaces used `10.42.0.102`, then `10.42.0.103`.
They used the same pinned image, startup guard, 1 CPU/1 GiB resources and
20 GiB writable storage as the existing workspace. They had new daemon tokens,
no user data/lease annotations, a diagnostic state label and a 30-minute deadline.

## Findings and change

The live `pulpo-workspace-public-egress` policy already matched the repository.
Its generation remained `1`, resource version `1035`, throughout this work.
K3s had installed it into per-pod firewall chains, and private IPv4 TCP/UDP
probes hit the policy's rejection rule.

Two gaps were reproduced before changing the host:

- K3s's common chain explicitly accepted ICMP echo requests before pod policy
  evaluation. LAN, node, controller and peer IPv4 ping all succeeded.
- IPv6 link-local peer ping, TCP and UDP succeeded despite the IPv4 pod policy.
  Both pods could also ping the host's bridge link-local address.

Installed the dedicated `inet pulpo_workspace_network` table, its enabled
systemd service and the K3s startup drop-in described in `README.md`. The table
blocks pod echo requests and new pod IPv6 application flows. IPv4 TCP/UDP policy
and the controller deployment were preserved.

## Results

The complete verifier ran against two workspaces before installation, after
installation, and after restarting/reloading the firewall service and replacing
the diagnostic workspace with one at a new IP. Each complete run passed all
46 expectations: 38 workspace checks, 6 host positive controls and 2 controller
HTTP health checks. The baseline expected ping and IPv6 application connectivity
to succeed; the protected runs expected those same paths to be blocked.

| Check, in both workspace directions where applicable | Before | Protected / new pod |
| --- | --- | --- |
| IPv4 ping to LAN `192.168.8.69`, node, controller and peer | Reachable | Blocked |
| IPv6 link-local ping to peer and host bridge | Reachable | Blocked |
| Peer IPv6 TCP and UDP with real listeners | Reachable | Blocked |
| Peer IPv4 TCP 8787 and UDP echo listener | Blocked | Blocked |
| LAN TCP 80/443; node SSH/API; controller pod/NodePort TCP | Blocked | Blocked |
| Cluster DNS over UDP/TCP 53 | Working | Working |
| Public HTTPS download with TLS verification | Working | Working |
| Controller → each workspace `/healthz` | HTTP 200 | HTTP 200 |
| Host → each workspace IPv4 UDP and IPv6 TCP/UDP controls | Working | Working |

After the first protected run, the new table recorded 8 IPv4 echo drops,
4 IPv6 echo drops and 6 other IPv6 packet drops. The checks therefore exercised
the new rules, rather than merely timing out against unreachable destinations.
UDP/TCP listeners had host-side positive controls; controller health requests
confirmed both daemons were reachable from their permitted source.

The recreated diagnostic pod received `10.42.0.103` and a new IPv6 link-local
address. It required no firewall edit. Host SSH remained available throughout.
`systemd-analyze verify` accepted the firewall service and K3s unit/drop-in.
The firewall service is enabled at boot; the parsed K3s unit contains the
non-optional `nft -f /etc/pulpo/workspace-network/rules.nft` startup precheck.
K3s retained PID `1002` and its September 13 startup time during firewall
service restart/reload. No host reboot or K3s restart was performed.

The installation was confirmed and its rollback timer cancelled (zero matching
timers remained). Both diagnostic pod records were deleted; host filesystem
usage returned to its pre-test level of 63 GiB used / 176 GiB available. The
original workspace remained Ready with zero restarts. No packages or persistent
files were installed inside it.

The deployment bundle and runbook are retained at
`/usr/local/share/pulpo-workspace-network/` on the host. Byte comparisons matched
all three installed configuration files to the bundle. Only the summarized
results are retained in Git; raw probe output and ephemeral pod specifications
are not included.

## Recovery and remaining validation

The pre-installation table/file state is retained on the host at:

```text
/var/backups/pulpo-workspace-network/20260917T152429251096Z
```

Use the rollback procedure in `README.md` with that path to restore the original
behavior. A host reboot/K3s restart still needs a maintenance-window verification;
service restart/reload and startup configuration were checked here. The external
VLAN/router firewall was not changed. Multi-node and routed IPv6 topologies need
their own validation before rollout.
