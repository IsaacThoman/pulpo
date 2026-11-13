# Agent workspaces on K3s

Agent mode gives a model a disposable Linux machine to run commands, write code, and
work with files. This page sets up the machine that hosts those workspaces. It is an
optional addition to a [self-hosted Pulpo installation](self-hosting.md); chat works
without it.

## How it fits together

```
Pulpo server (Docker Compose)        Workspace machine (K3s)

  worker ─── HTTPS :30443 ─────────► workspace controller
             bearer token                │ creates, assigns, deletes
                                         ▼
                                     workspace pods, one small VM each
                                         │ may connect only to
                                         ▼
                                     egress proxy ───► public internet
```

- Each workspace is a Kubernetes pod that [Kata Containers](https://katacontainers.io)
  runs as its own small virtual machine, so code a model runs does not share a kernel
  with the host or with other workspaces.
- The **workspace controller** is the only component allowed to create and delete
  workspace pods. Pulpo's worker calls it over HTTPS with a shared token.
- Workspaces get no DNS and can reach only the **egress proxy**, which resolves names
  itself and refuses private, loopback, and link-local addresses.
- The model loop and your provider API keys stay on the Pulpo server. Nothing in a
  workspace holds a Pulpo or provider credential.

One cluster can serve several Pulpo installations. Each one identifies itself by the
host name of its `PUBLIC_URL`, and only sees its own workspaces.

## Requirements

- A **dedicated** x86-64 machine or VM running Ubuntu 24.04. It runs code chosen by a
  model, and the host firewall rules in [Hardening](#hardening) apply to every pod on
  it, so do not share it with the Pulpo server or other services.
- Hardware virtualization. `/dev/kvm` must exist. In a VM, turn on nested
  virtualization in the hypervisor.
- Capacity for the workspaces you want to run at once. By default each one gets 2 CPU
  cores, 2 GiB of memory, and up to 20 GiB of disk, plus about 0.25 core and 320 MiB
  of overhead for its VM. One idle workspace is kept warm. 4 cores, 8 GB of RAM, and
  100 GB of disk is a reasonable start.
- The Pulpo server must be able to reach this machine on TCP port 30443. Nothing else
  needs to reach it. Keep it on a private network.
- A model that supports tool calling.

These steps follow the configuration of the cluster behind Pulpo's hosted service:
Ubuntu 24.04, K3s v1.36.2+k3s1, and Kata Containers 4.0.0 with the `qemu-runtime-rs`
runtime. Use those versions unless you are prepared to test others.

The controller and egress proxy images are published for x86-64 only. On ARM64, build
them from `infra/workspace-controller/Dockerfile` and
`infra/workspace-egress/proxy/Dockerfile`.

## 1. Check virtualization

```sh
ls -l /dev/kvm
```

If the device is missing, enable virtualization in the firmware, or nested
virtualization for the VM, before going further.

## 2. Install K3s

```sh
sudo mkdir -p /etc/rancher/k3s
sudo tee /etc/rancher/k3s/config.yaml >/dev/null <<'EOF'
write-kubeconfig-mode: "0640"
secrets-encryption: true
disable:
  - traefik
  - servicelb
  - local-storage
EOF

curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION=v1.36.2+k3s1 sh -
sudo k3s kubectl get nodes
```

The node should report `Ready` within a minute. The disabled components are an ingress
controller, a load balancer, and a volume provisioner; workspaces use none of them.

## 3. Install Kata Containers

Install [Helm](https://helm.sh/docs/intro/install/), then create `kata-values.yaml`:

```yaml
deploymentMode: job
k8sDistribution: k3s
shims:
  disableAll: true
  qemu-runtime-rs:
    enabled: true
runtimeClasses:
  enabled: true
  createDefault: true
  defaultName: kata
node-feature-discovery:
  enabled: true
job:
  nodeSelectorExpressions: []
```

`deploymentMode: job` installs Kata once instead of leaving a privileged installer
running on the node. `nodeSelectorExpressions: []` lets the installer use a
single-node cluster, whose only node is also the control plane.

```sh
sudo helm install kata-deploy \
  oci://ghcr.io/kata-containers/kata-deploy-charts/kata-deploy \
  --version 4.0.0 \
  --namespace kata-system --create-namespace \
  --kubeconfig /etc/rancher/k3s/k3s.yaml \
  -f kata-values.yaml
```

The installer labels the node when it is done. Wait until this prints the node:

```sh
sudo k3s kubectl get nodes -l katacontainers.io/kata-runtime=true
```

Then confirm that a pod really runs in a VM:

```sh
sudo k3s kubectl run kata-check --image=busybox:1.37 --restart=Never \
  --overrides='{"spec":{"runtimeClassName":"kata"}}' -- uname -r
sudo k3s kubectl wait pod/kata-check --timeout=120s \
  --for=jsonpath='{.status.phase}'=Succeeded
sudo k3s kubectl logs kata-check
sudo k3s kubectl delete pod kata-check
uname -r
```

The pod's kernel version differs from the host's, because the pod has its own kernel.
If the two match, or the pod never starts, Kata is not working; do not continue.

## 4. Choose the images

Workspaces use three images. Pulpo requires each to be pinned by digest, so that a
workspace can never start from an image that changed after you chose it.

| Image | Tag to use |
| --- | --- |
| `ghcr.io/isaacthoman/pulpo-agent-workspace` | Your Pulpo version, for example `0.180.2`. |
| `ghcr.io/isaacthoman/pulpo-workspace-controller` | The newest `sha-<commit>` tag on its [package page](https://github.com/IsaacThoman/pulpo/pkgs/container/pulpo-workspace-controller). |
| `ghcr.io/isaacthoman/pulpo-workspace-egress-proxy` | The newest `sha-<commit>` tag on its [package page](https://github.com/IsaacThoman/pulpo/pkgs/container/pulpo-workspace-egress-proxy). |

Pull each one and record its digest. Replace the three tags with the ones you chose:

```sh
resolve() {
  sudo k3s crictl pull "$1" >/dev/null &&
    sudo k3s crictl inspecti -o go-template \
      --template '{{index .status.repoDigests 0}}' "$1"
}

WORKSPACE_IMAGE=$(resolve ghcr.io/isaacthoman/pulpo-agent-workspace:0.180.2)
CONTROLLER_IMAGE=$(resolve ghcr.io/isaacthoman/pulpo-workspace-controller:sha-fdee4cf0ac278f8c7a2399c217288fbfbeea49d4)
PROXY_IMAGE=$(resolve ghcr.io/isaacthoman/pulpo-workspace-egress-proxy:sha-4f4a3e2104c6563682df409466a06c733903fb90)

echo "$WORKSPACE_IMAGE"
echo "$CONTROLLER_IMAGE"
echo "$PROXY_IMAGE"
```

Each line should end in `@sha256:` and 64 hexadecimal characters. Keep the workspace
line; you will paste it into Pulpo in step 7.

To add tools to the workspace image, build your own from it as described in the
[workspace image README](https://github.com/IsaacThoman/pulpo/blob/main/infra/workspace-image/README.md).
Pulpo accepts only images hosted on `ghcr.io`.

## 5. Create the secrets

The controller needs a token that Pulpo will present, and a TLS certificate.

```sh
sudo k3s kubectl create namespace pulpo-workspaces

CONTROLLER_TOKEN=$(openssl rand -hex 32)
sudo k3s kubectl -n pulpo-workspaces create secret generic \
  pulpo-workspace-controller-auth --from-literal=token="$CONTROLLER_TOKEN"
echo "$CONTROLLER_TOKEN"
```

Save the token for step 7.

The certificate comes from a private certificate authority that you create here and
that Pulpo is told to trust. Set `NODE_NAME` and `NODE_IP` to the name and address the
Pulpo server will use to reach this machine:

```sh
NODE_NAME=workspaces.internal.example.com
NODE_IP=10.0.0.20

openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
  -days 3650 -subj "/CN=Pulpo Workspace Controller CA" \
  -keyout ca.key -out ca.crt

openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
  -subj "/CN=pulpo-workspace-controller.pulpo-workspaces.svc" \
  -keyout controller.key -out controller.csr

printf 'subjectAltName=DNS:%s,IP:%s,DNS:pulpo-workspace-controller.pulpo-workspaces.svc,DNS:pulpo-workspace-controller.pulpo-workspaces.svc.cluster.local\nextendedKeyUsage=serverAuth\n' \
  "$NODE_NAME" "$NODE_IP" > controller.ext

openssl x509 -req -in controller.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -days 825 -extfile controller.ext -out controller.crt

sudo k3s kubectl -n pulpo-workspaces create secret tls \
  pulpo-workspace-controller-tls --cert=controller.crt --key=controller.key

base64 -w0 ca.crt; echo
```

The last command prints the authority's certificate as one line. Save it for step 7.
Store `ca.key` somewhere safe and off this machine: you need it to renew the
controller certificate, which is valid for 825 days.

## 6. Deploy the controller

Download the manifest and fill in the images from step 4:

```sh
curl -fsSLO https://raw.githubusercontent.com/IsaacThoman/pulpo/main/infra/workspace-controller/kubernetes.yaml

sed -i \
  -e "s|ghcr.io/your-org/pulpo-workspace-controller@sha256:REPLACE_WITH_CONTROLLER_DIGEST|$CONTROLLER_IMAGE|" \
  -e "s|ghcr.io/your-org/pulpo-agent-workspace@sha256:REPLACE_WITH_WORKSPACE_DIGEST|$WORKSPACE_IMAGE|" \
  -e "s|ghcr.io/your-org/pulpo-workspace-egress-proxy@sha256:REPLACE_WITH_PROXY_DIGEST|$PROXY_IMAGE|" \
  -e "s|value: kata-pulpo-bounded|value: kata|" \
  kubernetes.yaml

grep -n "REPLACE_WITH\|your-org" kubernetes.yaml
```

The `grep` prints nothing once all three images are filled in. The fourth substitution
selects the standard `kata` runtime; `kata-pulpo-bounded` is the hardened runtime
described under [Hardening](#hardening).

Next, make the controller reachable from the Pulpo server. In `kubernetes.yaml`, find
the `Service` named `pulpo-workspace-controller` and add the two marked lines:

```yaml
spec:
  type: NodePort          # add
  selector:
    app.kubernetes.io/name: pulpo-workspace-controller
  ports:
    - name: https-internal
      port: 8786
      targetPort: http
      nodePort: 30443     # add
```

Apply it and wait for both deployments:

```sh
sudo k3s kubectl apply -f kubernetes.yaml
sudo k3s kubectl -n pulpo-workspaces rollout status deploy/pulpo-workspace-controller
sudo k3s kubectl -n pulpo-workspaces rollout status deploy/pulpo-workspace-egress-proxy
sudo k3s kubectl -n pulpo-workspaces get pods
```

Shortly afterwards a pod named `pulpo-workspace-…` appears and becomes `Running`. That
is the warm workspace.

Restrict port 30443 to the Pulpo server's address with your network firewall or cloud
security group. The token protects the controller, but there is no reason to expose it
further.

## 7. Connect Pulpo

On the Pulpo server, add the controller to `.env`. The host in the URL must be the
`NODE_NAME` or `NODE_IP` you put in the certificate:

```dotenv
WORKSPACE_CONTROLLER_URL=https://workspaces.internal.example.com:30443
WORKSPACE_CONTROLLER_TOKEN=<token from step 5>
WORKSPACE_CONTROLLER_CA_CERT_BASE64=<one-line certificate from step 5>
```

Apply the change:

```sh
docker compose up -d
docker compose restart web
```

Then, in Pulpo:

1. Open **Admin panel → Settings → Agent**. The bottom of the **Pi agent mode** section
   should read **Workspace controller is healthy**.
2. Paste the workspace image reference from step 4 into **Immutable workspace image**.
   Use the same reference the controller was deployed with, so that the warm workspace
   matches what Pulpo asks for.
3. Turn on **Enable agent mode** and save.
4. Under **Admin panel → Models**, edit each model that should be able to use a
   workspace and turn on **Enable Pi agent mode**.

Start a new chat with one of those models, switch on **Agent** in the composer, and
ask it to run `uname -a`. **Admin panel → Usage → Workspaces** lists active workspaces,
and on the workspace machine `sudo k3s kubectl -n pulpo-workspaces get pods` shows the
pod behind each one.

## Hardening

After the steps above, every workspace is its own VM and its network access is limited
by Kubernetes policy to the egress proxy. Testing on the reference cluster found gaps
that policy alone does not close. Install the following before you let people you do
not fully trust use agent mode. Each bundle has its own instructions, verification
scripts, and rollback, and each was verified only on a single-node K3s cluster with the
default flannel network and address ranges, on Ubuntu 24.04, over IPv4.

| Gap in the basic setup | Fix |
| --- | --- |
| K3s lets pods ping the node, your LAN, and each other before policies are evaluated, and IPv6 link-local traffic bypasses the IPv4 policies. A workspace's root user can also forge another machine's source address. | [Workspace network isolation](https://github.com/IsaacThoman/pulpo/blob/main/infra/workspace-network/README.md): host firewall rules and a network plugin that binds each pod to its own address. |
| Agent traffic leaves through your own internet connection and carries your IP address. Kubernetes policy and the proxy's address checks are the only things keeping pod traffic off your LAN. | [Workspace egress](https://github.com/IsaacThoman/pulpo/blob/main/infra/workspace-egress/README.md): routes all pod traffic into a WireGuard tunnel with a kill switch. |
| The 20 GiB disk limit is enforced by evicting a pod after it exceeds the limit, so a workspace can fill the node's disk first. | [Bounded workspace storage](https://github.com/IsaacThoman/pulpo/blob/main/infra/workspace-storage/README.md): gives each workspace a fixed-size disk. It provides the `kata-pulpo-bounded` runtime. |

Also keep this machine on a network segment that cannot reach your other systems. The
host rules protect against the paths that were tested; an outer firewall protects
against the ones nobody has thought of.

## Limits and settings

| Where | Setting | Default | Meaning |
| --- | --- | --- | --- |
| `kubernetes.yaml` | `PULPO_MAX_WORKSPACE_PODS` | `6` | Workspace pods the cluster will run at once, including warm and terminating ones. Size it to the machine. |
| `kubernetes.yaml` | `PULPO_MAX_ACTIVE_WORKSPACES_TOTAL` | `100` | Assigned workspaces across every Pulpo installation using this cluster. |
| `kubernetes.yaml` | `PULPO_WARM_CAPACITY` | `1` | Idle workspaces kept ready when Pulpo requests none. |
| Pulpo, **Settings → Agent** | **Maximum active workspaces** | `3` | Workspaces this Pulpo installation may hold at once. |
| Pulpo, **Settings → Agent** | **Warm workspaces** | `1` | Idle workspaces kept ready so a chat starts without waiting. |
| Pulpo, **Settings → Agent** | **CPU**, **Memory**, **Ephemeral disk** | 2 cores, 2048 MiB, 20 GiB | Size of each workspace. |
| Pulpo, **Settings → Agent** | **Idle timeout**, **Hard timeout** | 30 minutes, 4 hours | When an unused or long-lived workspace is deleted. |

A workspace is deleted when it times out. Files a model should keep belong in Pulpo's
Files, which the agent can read and write.

## Updating

- **Workspace image.** Resolve the new tag to a digest as in step 4, replace the
  `PULPO_WORKSPACE_IMAGE` value in `kubernetes.yaml`, apply it, and paste the same
  reference into **Immutable workspace image** in Pulpo. Running workspaces keep the
  image they started with.
- **Controller and proxy.** Replace their image references in `kubernetes.yaml` and
  apply it.
- **K3s and Kata.** Upgrade deliberately and repeat the `kata-check` test from step 3
  afterwards. The hardening bundles are tied to the versions listed in their READMEs.

## Troubleshooting

```sh
sudo k3s kubectl -n pulpo-workspaces get pods
sudo k3s kubectl -n pulpo-workspaces logs deploy/pulpo-workspace-controller
sudo k3s kubectl -n pulpo-workspaces logs deploy/pulpo-workspace-egress-proxy
```

| Symptom | Cause and fix |
| --- | --- |
| **Controller URL and token are not configured in deployment secrets** | The settings are missing from `.env`, or the change was not applied. |
| **Workspace controller is unavailable**, or a certificate error | The host in `WORKSPACE_CONTROLLER_URL` is not one of the names in the certificate, the certificate line is incomplete, or port 30443 is blocked. From the Pulpo server, `curl --cacert ca.crt https://<host>:30443/healthz` should answer. |
| The controller pod does not start | `sudo k3s kubectl -n pulpo-workspaces describe pod <name>` shows the reason. A missing secret from step 5 and a wrong image reference are the usual ones. |
| Workspace pods stay `Pending` | The node is out of CPU or memory, or the Kata node label from step 3 is missing. `describe pod` shows which. |
| Workspace pods fail to start | KVM is unavailable. Repeat the checks in steps 1 and 3. |
| Agent chats wait a long time before they start | **Maximum active workspaces** or `PULPO_MAX_WORKSPACE_PODS` is reached, so the chat is queued for a free workspace. |
| The agent cannot reach the internet | Check the egress proxy's log. It records every request it allows or refuses. |
