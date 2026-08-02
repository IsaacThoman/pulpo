# Pulpo workspace controller

This service is deployed inside the Kubernetes cluster and is the only Pulpo
component with permission to create, claim, and delete workspace pods. The
Pulpo worker calls it over a private authenticated endpoint.

## Deployment topology

| Piece | Where | How it deploys |
| --- | --- | --- |
| Pulpo web/api/worker | Coolify on `bee` | Coolify watches `main` |
| Workspace controller | k3s on `pulpo-agents` | GitHub Actions → self-hosted runner |
| Workspace pods (Kata) | k3s on `pulpo-agents` | Created by the controller |

The controller **cannot** run as a normal Coolify Docker app: it needs in-cluster
Kubernetes RBAC to create Kata sandbox pods. Auto-deploy is handled by
`.github/workflows/workspace-controller.yml`, which builds the image on GitHub
hosted runners and rolls it out via the `pulpo-agents` self-hosted runner
(`ctr import` + `kubectl set image`).

`warmCapacity: 0` is supported: the controller cold-starts a workspace pod on
demand when the warm pool is empty.

Create the authentication secret before applying the manifest:

```bash
kubectl create namespace pulpo-workspaces
kubectl -n pulpo-workspaces create secret generic pulpo-workspace-controller-auth \
  --from-literal=token="$(openssl rand -hex 32)"
```

Create a TLS secret for the internal service name as well (normally from your
cluster issuer or internal CA):

```bash
kubectl -n pulpo-workspaces create secret tls pulpo-workspace-controller-tls \
  --cert=controller.crt --key=controller.key
```

Configure Pulpo with an `https://` controller URL and ensure its container
trusts the issuing CA. Plain HTTP is accepted only when the controller is
started explicitly with `PULPO_ALLOW_INSECURE_HTTP=true` for local kind/k3d
development.

Replace both immutable digest placeholders in `kubernetes.yaml`, confirm the
cluster has a `kata` RuntimeClass, and apply the manifest. Do not expose the
controller or workspace daemon with a public Ingress.

For local development, leave agent mode disabled and use the fake controller
in server integration tests. A full local run requires a kind or k3d cluster
with an available sandbox runtime; ordinary Docker Compose does not mount the
Docker socket and does not start workspaces.
