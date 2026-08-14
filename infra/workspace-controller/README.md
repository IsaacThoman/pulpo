# Pulpo workspace controller

This service is deployed inside the Kubernetes cluster and is the only Pulpo
component with permission to create, claim, and delete workspace pods. The
Pulpo worker calls it over a private authenticated endpoint.

## Multiple Pulpo instances

One controller can serve multiple independent Pulpo deployments. Every
authenticated request includes an `x-pulpo-instance-id` header. The controller
stores that id as a pod annotation plus a hash label, reconstructs it after a
restart, and only lists, proxies, or releases leases owned by that instance.

Pulpo resolves the id from `PULPO_INSTANCE_ID`, then Coolify's
`SERVICE_FQDN_WEB` or `COOLIFY_FQDN`, and finally the `PUBLIC_URL` hostname.
Set `PULPO_INSTANCE_ID` explicitly outside platforms that provide stable
deployment FQDN metadata.

For a rolling upgrade, authenticated clients that do not yet send the header
are placed in the legacy `default` ownership scope.

Warm pods remain unowned until claimed. Pools are shared by immutable workspace
specification, and the effective target is the largest capacity requested for
that specification. A preview configured with `warmCapacity: 0` therefore
cannot remove production's compatible warm pool.

`maxActiveWorkspaces` is enforced per Pulpo instance. Set
`PULPO_MAX_ACTIVE_WORKSPACES_TOTAL` on the controller for a cluster-wide hard
limit. The example manifest defaults it to 100.

Before provisioning, current Pulpo workers reserve capacity through
`POST /v1/capacity-reservations`, then pass the returned reservation id to
`POST /v1/leases`. Unconsumed reservations expire after 30 seconds and may be
released early with `DELETE /v1/capacity-reservations/:id`. The legacy lease
request without a reservation remains supported so the controller and workers
can be upgraded independently.

The bearer token authenticates access to the controller, while the instance id
provides operational ownership. Deployments sharing the same token are in the
same trust domain because a holder can forge the header. Use separate controller
credentials or a trusted proxy if instance identity must be a security boundary.

## Deployment

The controller is designed to run inside the Kubernetes cluster that hosts the
workspace pods. Running it elsewhere is possible, but requires network access
to the Kubernetes API and credentials with the equivalent RBAC permissions.
It should remain on a private network and should not have a public Ingress.

The cluster needs a sandboxed `RuntimeClass`; the example manifest uses `kata`.
Build and publish both the controller and workspace images, replace the image
and digest placeholders in `kubernetes.yaml`, and then apply the manifest.

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

## Optional automatic deployment

`.github/workflows/workspace-controller.yml` always builds the controller on
relevant pushes. Its deploy job is opt-in: it runs only when the repository
variable `WORKSPACE_CONTROLLER_RUNNER` names a self-hosted GitHub Actions
runner. The runner must have access to the cluster and its container runtime.

| Repository variable                       | Default                                        | Purpose                                     |
| ----------------------------------------- | ---------------------------------------------- | ------------------------------------------- |
| `WORKSPACE_CONTROLLER_RUNNER`             | none                                           | Runner label; setting it enables deployment |
| `WORKSPACE_CONTROLLER_KUBECTL_COMMAND`    | `kubectl`                                      | Kubernetes command available to the runner  |
| `WORKSPACE_CONTROLLER_CONTAINERD_COMMAND` | `ctr`                                          | Containerd command available to the runner  |
| `WORKSPACE_CONTROLLER_NAMESPACE`          | `pulpo-workspaces`                             | Target namespace                            |
| `WORKSPACE_CONTROLLER_DEPLOYMENT`         | `pulpo-workspace-controller`                   | Target Deployment                           |
| `WORKSPACE_CONTROLLER_CONTAINER_NAME`     | `controller`                                   | Container updated in the Deployment         |
| `WORKSPACE_CONTROLLER_IMAGE_REPOSITORY`   | `docker.io/library/pulpo-workspace-controller` | Local image name used for commit tags       |

The workflow transfers an OCI image artifact to the runner and imports it
directly into containerd, avoiding registry credentials. This is intended for a
single-node cluster. In a multi-node cluster, publish the image to a registry or
import it on every node where the controller can be scheduled.

For local development, leave agent mode disabled and use the fake controller
in server integration tests. A full local run requires a kind or k3d cluster
with an available sandbox runtime; ordinary Docker Compose does not mount the
Docker socket and does not start workspaces.
