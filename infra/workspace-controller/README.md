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

`.github/workflows/workspace-controller.yml` tests and builds relevant pull
requests. Only pushes or manual dispatches on `main` publish the controller to
`ghcr.io/<lowercase-repository-owner>/pulpo-workspace-controller`. Each published
commit gets a `sha-<commit>` tag; deployments use the registry's immutable digest
recorded in the workflow summary. PRs and dispatches on other branches neither
publish nor deploy. Production rollouts are not cancelled by newer runs or PRs.

The deploy job is opt-in: it runs only when `WORKSPACE_CONTROLLER_RUNNER` names
a self-hosted GitHub Actions runner. The runner needs Python 3 and Kubernetes
access to read/patch the Deployment and create/watch/delete Jobs and read Pods
in the target namespace. Containerd access and local image imports are no longer
used. Kubernetes must be able to pull the image independently of the CI runner.

| Repository variable                       | Default                                        | Purpose                                     |
| ----------------------------------------- | ---------------------------------------------- | ------------------------------------------- |
| `WORKSPACE_CONTROLLER_RUNNER`             | none                                           | Runner label; setting it enables deployment |
| `WORKSPACE_CONTROLLER_KUBECTL_COMMAND`    | `kubectl`                                      | Kubernetes command available to the runner  |
| `WORKSPACE_CONTROLLER_NAMESPACE`          | `pulpo-workspaces`                             | Target namespace                            |
| `WORKSPACE_CONTROLLER_DEPLOYMENT`         | `pulpo-workspace-controller`                   | Target Deployment                           |
| `WORKSPACE_CONTROLLER_CONTAINER_NAME`     | `controller`                                   | Container updated in the Deployment         |

The old `WORKSPACE_CONTROLLER_CONTAINERD_COMMAND` and
`WORKSPACE_CONTROLLER_IMAGE_REPOSITORY` variables are unused and can be removed.
Keep published controller digests referenced by running deployments and rollback
versions; registry retention must not delete them.

### Registry access and migration

GHCR packages are private on first publication. Either explicitly make the
controller package public, or provision a durable read-only registry credential
as an `imagePullSecret` on the Deployment or its ServiceAccount. Use a credential
with `read:packages` and package access; do not use a workflow's short-lived
`GITHUB_TOKEN` as the cluster credential. Refer to the
[GitHub Container Registry documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
and [Kubernetes pull-secret documentation](https://kubernetes.io/docs/tasks/configure-pod-container/pull-image-private-registry/).

Before changing the Deployment, the deploy script runs a short-lived Kubernetes
Job using the new digest, `imagePullPolicy: Always`, the controller's service
account/pull-secret references, and its scheduling settings. The Job only starts
Node and exits; it does not start another controller or mount controller secrets.
A failed pull or scheduling timeout leaves the existing Deployment unchanged
and fails the workflow. The Job has a deadline, a cleanup TTL, and explicit
cleanup. Always-pull verifies registry access even if layers are cached; a full
empty-cache recovery drill is still required on a disposable node.

On the first publication the deploy job may fail until package visibility or
cluster pull credentials are configured. Configure access and rerun the failed
deploy job; do not work around this failure by importing the image locally.

If the image pulls but the controller fails readiness, the rollout fails and the
new desired image remains visible for diagnosis. To roll back, run the same
deploy script with `IMAGE_REF` set to a retained, known-good registry digest and
the same namespace/Deployment settings. Rollback also requires a successful
pull check; it must not depend on a surviving node cache.

For an existing installation, also apply the PriorityClass and controller
resource reservations from `kubernetes.yaml`, after substituting both real image
digests and preserving deployment-specific TLS, networking, and settings.
**Automatic deployment updates only the controller image and pull policy.** It
does not apply the example manifest or overwrite live configuration. The custom
priority is non-preempting; it helps scheduling/eviction order without terminating
other pods to make room. Resource values are starting budgets to tune against
observed controller load, not a guarantee against disk exhaustion.

See [workspace storage isolation and recovery](storage-isolation.md) for the
remaining infrastructure work, rollout order, and acceptance tests. The current
workspace `ephemeral-storage` limit is an eviction threshold, not a hard quota.

For local development, leave agent mode disabled and use the fake controller
in server integration tests. A full local run requires a kind or k3d cluster
with an available sandbox runtime; ordinary Docker Compose does not mount the
Docker socket and does not start workspaces.
