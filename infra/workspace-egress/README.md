# Workspace egress: tunnel and proxy

Workspaces must never reach the LAN, the host or each other. This bundle builds
on the [Kubernetes policy](../workspace-controller/kubernetes.yaml) and the
[host ICMP/IPv6 table](../workspace-network/README.md) with two independent layers:

1. **Egress tunnel (host).** Every pod-initiated flow to a non-cluster address
   is policy-routed into a WireGuard tunnel (`wg-pulpo`), e.g. ProtonVPN, Mullvad
   or a VPS you control. The pod routing path contains no LAN route at all, and
   an nftables kill switch drops pod traffic that would leave any other way,
   including when the tunnel is down. Host traffic (SSH, K3s, image pulls, the
   WireGuard handshake itself) keeps using the normal uplink.
2. **Egress proxy (cluster).** Workspaces get no DNS and may only connect to a
   [Smokescreen](https://github.com/stripe/smokescreen) proxy. Smokescreen
   resolves names itself and refuses private, CGNAT, loopback, link-local and
   other special-purpose addresses *after* resolution, which defeats DNS
   rebinding (`evil.example → 192.168.8.1`). Its log records every request.

```
workspace ──► smokescreen pod ──► cni0 ──► [mark] ──► table 7420 ──► wg-pulpo ──► internet
   │ (no DNS, NetworkPolicy:          kill switch: pod egress to any interface
   │  proxy:4750 only)                other than wg-pulpo/cni0 is dropped
   └──✗ LAN, host, peers, DNS
```

## Files

| File | Installed to | Purpose |
| --- | --- | --- |
| `egress.nft` | `/etc/pulpo/workspace-egress/egress.nft` | `inet pulpo_workspace_egress`: flow marking, kill switch, masquerade, MSS clamp |
| `pulpo-workspace-egress` | `/usr/local/sbin/pulpo-workspace-egress` | `apply`, `route-up`, `remove`, `status` |
| `pulpo-workspace-egress.service` | `/etc/systemd/system/` | Applies rules at boot, before K3s and the tunnel |
| `k3s-egress.conf` | `/etc/systemd/system/k3s.service.d/51-pulpo-egress.conf` | Reapplies on every K3s start; failure blocks K3s |
| `wg-pulpo.conf.example` | `/etc/wireguard/wg-pulpo.conf` | Tunnel template (`Table = off`) |
| `proxy/Dockerfile` | image | Smokescreen at a pinned commit, distroless, non-root |

The proxy's ConfigMap, Deployment, fixed-IP Service and NetworkPolicies are in
[`kubernetes.yaml`](../workspace-controller/kubernetes.yaml). The controller adds
`HTTP(S)_PROXY`, `NO_PROXY`, `NODE_USE_ENV_PROXY=1`, `dnsPolicy: None` and a
loopback-only nameserver to workspace pods when `PULPO_WORKSPACE_EGRESS_PROXY_URL`
is set. Warm pods created with a different proxy setting are replaced.

## How the routing works

- `prerouting` (mangle priority, before kube-proxy DNAT) sets connection mark
  `0x01000000` on new flows from `cni0` whose destination is outside the pod and
  service ranges, and copies it to the packet mark for that flow's outbound packets.
- `ip rule 7420: fwmark 0x01000000/0x01000000 lookup 7420`. Table 7420 has a single
  route, `default dev wg-pulpo`, added by the tunnel's `PostUp`.
- `ip rule 7421: fwmark 0x01000000/0x01000000 unreachable`. When the tunnel is down
  table 7420 is empty, lookup falls through to this rule, never to the main table.
- `forward` drops pod-initiated traffic to any interface other than `cni0` or
  `wg-pulpo`, private/special destinations inside the tunnel, non-TCP/UDP and
  IPv6. This holds even if the ip rules are missing.
- Pod-to-host destinations are delivered locally (the local routing table is
  consulted first) and remain subject to the existing NetworkPolicy.
- Replies to connections opened from outside the pod network (backend →
  controller NodePort, kubelet probes) are never marked, so they leave normally.
- TCP MSS is clamped to 1380 in both directions because flannel's pod MTU (1450)
  exceeds the tunnel MTU (1420). Adjust both if you change the tunnel MTU.

All pods on the node are affected, not just workspaces. That is intended for a
dedicated workspace node: the controller only talks to the API server and pods,
and image pulls are performed by containerd on the host. CoreDNS can no longer
forward to a LAN resolver; workspaces don't use it and Smokescreen uses public
resolvers through the tunnel. To keep CoreDNS forwarding working for other pods,
point K3s at public resolvers (`resolv-conf: /etc/pulpo/resolv.conf` in
`/etc/rancher/k3s/config.yaml`, containing e.g. `nameserver 1.1.1.1`), which
requires a K3s restart.

Validated assumptions: single node, flannel on `cni0`, pods `10.42.0.0/16`,
services `10.43.0.0/16`, IPv4-only. Multi-node (flannel VXLAN would be dropped
by the kill switch), other CNIs or other ranges need edits and another review.

## Choosing a tunnel

Any WireGuard endpoint works. Consumer VPNs (ProtonVPN, Mullvad) are easy, hide
your home IP and keep agent traffic off your connection's reputation, but their
shared exit IPs are often blocked or CAPTCHA'd by Cloudflare, Google and some
package registries, and automated multi-user traffic may conflict with their
terms. A small VPS running WireGuard gives you a clean, dedicated exit IP; only the
`[Peer]` section changes.

For ProtonVPN: Account → WireGuard → create a Linux config (NetShield optional).
Copy `PrivateKey`, `Address`, `PublicKey` and `Endpoint` into the template.
Drop the `DNS` line and any IPv6 address or `::/0` entry. Keep `Table = off`.

## Install

Requires root, WireGuard tools (`apt install wireguard-tools`), nftables, systemd
and the [workspace-network](../workspace-network/README.md) table already installed.
Nothing here changes host-originated traffic, so it cannot lock you out of SSH.
Expect a short outage of workspace internet access while you cut over.

```sh
sudo install -D -m 0644 egress.nft /etc/pulpo/workspace-egress/egress.nft
sudo install -m 0755 pulpo-workspace-egress /usr/local/sbin/pulpo-workspace-egress
sudo install -m 0644 pulpo-workspace-egress.service /etc/systemd/system/
sudo install -D -m 0644 k3s-egress.conf /etc/systemd/system/k3s.service.d/51-pulpo-egress.conf
sudo install -m 0600 wg-pulpo.conf.example /etc/wireguard/wg-pulpo.conf
sudoedit /etc/wireguard/wg-pulpo.conf      # fill in your provider's values

sudo nft --check -f /etc/pulpo/workspace-egress/egress.nft
sudo systemctl daemon-reload
sudo systemctl enable --now pulpo-workspace-egress.service
sudo systemctl enable --now wg-quick@wg-pulpo.service
sudo pulpo-workspace-egress status
sudo wg show wg-pulpo                       # recent handshake, rx/tx growing
```

Then deploy the proxy and the controller change:

1. Build and publish `proxy/Dockerfile` (CI does this from `main`) and put its
   digest in the `pulpo-workspace-egress-proxy` Deployment.
2. Check `10.43.47.50` is unused and inside your service CIDR, or pick another
   address and change both the Service `clusterIP` and
   `PULPO_WORKSPACE_EGRESS_PROXY_URL`.
3. `kubectl apply -f kubernetes.yaml`. Workspaces lose direct egress and DNS as soon
   as the NetworkPolicy updates; the controller rollout recreates warm pods with
   the proxy settings. Existing claimed workspaces keep running without proxy
   variables, so they have no internet until they are replaced.
4. Rebuild the workspace image. It keeps proxy variables across `sudo` so
   `sudo apt-get` works.

## Verify

```sh
# Exit IP seen by the internet: must be the tunnel provider's, not yours
kubectl -n pulpo-workspaces exec WORKSPACE -- curl -s https://ifconfig.me

# Kill switch: stop the tunnel, workspace requests must fail, not fall back
sudo systemctl stop wg-quick@wg-pulpo
kubectl -n pulpo-workspaces exec WORKSPACE -- curl -sS -m 10 https://example.com   # fails
sudo systemctl start wg-quick@wg-pulpo

# Full isolation suite (see ../workspace-network/README.md)
sudo python3 ../workspace-network/verify.py --pods WORKSPACE_A WORKSPACE_B \
  --node-ip 192.168.8.198 --lan-ip 192.168.8.69 --egress proxy
```

In proxy mode the verifier also expects cluster DNS and direct internet to be
blocked, a proxied public HTTPS download to succeed, and the proxy to refuse
every LAN, host, controller and peer endpoint.

Watch counters with `sudo nft list table inet pulpo_workspace_egress`; the kill
switch counters should stay at zero in normal operation. Smokescreen logs every
decision: `kubectl -n pulpo-workspaces logs deploy/pulpo-workspace-egress-proxy`.

## Rollback

```sh
sudo systemctl disable --now wg-quick@wg-pulpo.service pulpo-workspace-egress.service
sudo rm /etc/systemd/system/k3s.service.d/51-pulpo-egress.conf
sudo systemctl daemon-reload
sudo pulpo-workspace-egress remove
```

Stopping the service alone leaves the kill switch in place, so pods have no
internet rather than LAN-routed internet. Restoring direct workspace egress also
requires reapplying the previous NetworkPolicy and removing
`PULPO_WORKSPACE_EGRESS_PROXY_URL` from the controller.
