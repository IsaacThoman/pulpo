<div align="center">

# Pulpo

A configurable self-hostable AI platform for the web and iOS.

![GitHub Tag](https://img.shields.io/github/v/tag/isaacthoman/pulpo)
![GitHub Checks](https://img.shields.io/github/check-runs/isaacthoman/pulpo/main)
</div>

![Web Screenshot](/assets/screenshot-1-fully-transparent.png)

## Self-host in a few minutes

Pulpo's supported single-host installation uses Docker Compose, Postgres,
Redis, and local attachment storage. It does not require a separate S3 service.

Prerequisites: Git, OpenSSL, and Docker with the Compose plugin.

```bash
git clone https://github.com/IsaacThoman/pulpo.git
cd pulpo
git checkout "$(git tag --list 'v*' --sort=-version:refname | head -n 1)"
./scripts/self-host-init.sh
docker compose -f compose.selfhost.yaml --env-file .env.selfhost up --build -d
```

Open [http://localhost:8080](http://localhost:8080), create the first
administrator, then add an OpenAI-compatible provider and at least one model in
the administration area. The first source build can take several minutes.

For an internet-facing installation, initialize with its final HTTPS URL:

```bash
./scripts/self-host-init.sh https://chat.example.com
```

Then place a TLS reverse proxy in front of `127.0.0.1:8080`. Read the
[self-hosting guide](https://help.pulpo.baby/self-hosting) before exposing the
instance; it covers configuration, providers, upgrades, backups, S3-compatible
storage, mobile clients, and troubleshooting.

## What is included

- Web and iOS clients with selectable Pulpo instances
- OpenAI-compatible model providers and configurable model catalogs
- Postgres-backed accounts, chats, usage, sharing, and administration
- Background generation through a durable Redis queue
- Local or S3-compatible attachment storage
- Optional isolated Kubernetes agent workspaces
- No developer analytics, advertising, or usage telemetry

## License

Pulpo is source-available under the [Pulpo Noncommercial License](./LICENSE.md).
Personal and qualifying noncommercial use is permitted. Use by a for-profit
company, commercial hosting, and Billing Features require separate written
permission as described in the license.

## Development

The existing `compose.yaml` stack is used for Pulpo development and managed
Coolify deployments. See [Pulpo for iPhone](./apps/mobile/README.md) for mobile
development and [Pulpo CLI](./apps/cli/README.md) for operator automation.
