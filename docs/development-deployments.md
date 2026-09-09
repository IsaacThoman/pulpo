# Persistent development and disposable previews

Development uses the same release boundaries as production: one infrastructure
application and independent API, worker, and web Dockerfile applications.
`deploy/compose.development-infra.yaml` runs in **Raw Docker Compose Deployment**
mode with auto-deploy and previews disabled. Its custom build command is `true`.
It is changed only during deliberate infrastructure maintenance, never by CI.

The infrastructure mounts existing external volumes. `PULPO_DATA_PREFIX` is the
original dev resource UUID; keep its database/S3 credentials, `ENCRYPTION_KEY`,
`PULPO_INSTANCE_ID`, and object volume. `PULPO_S3_DATA_VOLUME` names the original
S3 gateway volume (including a legacy anonymous volume if migrating). Missing
volumes cause startup to fail instead of silently creating an empty database.
Never run old and new PostgreSQL containers on the same volume simultaneously.

API and worker use `pulpo-dev-postgres`, `pulpo-dev-redis`, `pulpo-dev-ollama`, and
`pulpo-dev-seaweed-s3` on the `coolify` network. Both mount the original object
volume at `/app/data/objects`, with the Coolify storage preview suffix disabled.
Use the `production-api`, `production-worker`, and `production-web` Dockerfile
targets, readiness routing, and shutdown budgets described in
[production deployments](production-deployments.md). These targets describe
runtime roles and are also appropriate for persistent development.

## CI configuration

Repository variables:

- `COOLIFY_PULPO_DEV_APP_UUID`: persistent development API
- `COOLIFY_PULPO_DEV_WORKER_APP_UUID`: persistent development worker
- `COOLIFY_PULPO_DEV_WEB_APP_UUID`: persistent development web
- `COOLIFY_PULPO_PREVIEW_APP_UUID`: separate preview-only Compose parent
- `COOLIFY_PULPO_PREVIEW_MAINTENANCE_APP_UUID`: trusted maintenance application
- `COOLIFY_PULPO_PREVIEW_MAINTENANCE_TASK_UUID`: its cleanup scheduled task

A push to dev deploys API (including migrations), worker, then web at the same
commit using the shared deployment-order script. Set `COMPOSE_REMOVE_ORPHANS=false`
at build time and runtime on all three applications. Disable independent Git
push auto-deploy. CI checks require a Dockerfile deployment and health checks.

The preview-only parent follows `dev` and `compose.yaml`, has Git push auto-deploy
disabled and PR previews enabled, and has **no base deployment**. Never deploy
that parent without a PR number. Its preview URL template is
`pulpo-dev-pr-{{pr_id}}.deathgrips.org`. Preview credentials and bootstrap settings
remain separate from persistent dev. Local development still uses `compose.yaml`.

## Targeted cleanup

Disable **Delete Unused Volumes** in the host's Coolify Docker Cleanup settings.
Keep scheduled image/build-cache cleanup. A Docker volume being unreferenced is
not sufficient evidence that its data is disposable; external Compose volumes
are also vulnerable to host-wide pruning.

The maintenance application runs trusted code from
`infra/preview-maintenance/cleanup.py`. Build its Dockerfile from the repository
root, or embed that exact reviewed script into a custom Dockerfile. It needs the
Docker socket at `/var/run/docker.sock` and a private host directory mounted at
`/maintenance`. It has no public domain/listener and no PR or Git auto-deploy.
Docker socket access is administrative: never build this application from PR code.

Create an enabled Coolify scheduled task every 15 minutes:

```sh
python3 /opt/pulpo/cleanup.py --parent PREVIEW_UUID --application-id PREVIEW_NUMERIC_ID --apply --grace-seconds 0
```

The command must fit Coolify's 255-character scheduled-task command column.
Without `--apply`, the script prints a dry-run plan. It uses a filesystem lock to
serialize manual and scheduled runs. GitHub's public API needs no token for this
public repository; API failures/rate limits preserve data and fail the task.
An optional read-only `GITHUB_TOKEN` can increase the rate limit.

For stale Coolify record cleanup, set `COOLIFY_CLEANUP_CONFIG` to a root-readable
JSON file in `/maintenance` containing `url`, `token`, and `parent_uuid`. This file
is deployment recovery material, never a repository artifact. Its parent must
match the cleanup command. Metadata deletion happens after exact Docker cleanup.

Deletion requires all of the following:

- An exact allowlisted service/volume name with the configured parent UUID and
  positive `-pr-N` suffix; persistent names never qualify.
- Matching Compose project and container application/PR ownership labels.
- A closed PR targeting `dev` from this repository, checked again just before deletion.
- No unexpected persistent/bind mounts and no volumes shared outside that PR.

Containers are removed by immutable ID. Named volumes are removed individually,
without force; Docker refuses deletion if a concurrent container attaches one.
Attached legacy anonymous S3 volumes are removed with their verified container.
Unattributable anonymous orphan volumes are preserved for manual investigation.
New previews explicitly name the S3 gateway volume to prevent that ambiguity.
Images are reclaimed by the existing host image cleanup.

On PR close, CI requests Coolify preview deletion and then runs this same trusted
maintenance task, waiting for success. The periodic task handles missed/failed
close events, including named volumes whose containers are already gone.
Failed tasks are visible in Coolify's execution history and fail the CI cleanup job.

## Migration and recovery

Save private copies of rendered Compose, runtime environment, container/mount
metadata, and a fresh database dump before moving infrastructure. Stop only the
non-PR dev containers, then start the external-volume infrastructure and verify
its mounts before starting the application roles. Keep the old container metadata
and backups until recovery has been verified. The old resource can become the
preview-only parent after its base containers are removed; its base volumes stay
mounted by the new infrastructure and cannot match the preview cleanup selector.

Check database counts and the original instance identity after cutover, then
check `/health`, `/ready`, and the frontend on `dev.pulpo.baby`. Verify production
health and mounts were unaffected. Keep encrypted offsite backups and perform
restore drills as described in [backups](backups.md).
