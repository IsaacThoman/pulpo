# Management CLI

`@isaacthoman/pulpo` is the Node.js 22+ operator client for contexts, scoped automation tokens, settings, catalog resources, users, usage and audit data, workspaces, banners, exports, and backups.

## Install and sign in

```bash
npm install --global @isaacthoman/pulpo
pulpo context add production --url https://pulpo.example.com
pulpo auth login --email admin@example.com
```

## Automate safely

Use `--json` for scripting and `--yes` only when a command must run without confirmation.

```bash
pulpo settings export --output pulpo-settings.json
pulpo --yes settings apply --file pulpo-settings.json
```

`PULPO_CONTEXT`, `PULPO_URL`, and `PULPO_TOKEN` override stored configuration. Secrets in JSON input can be read from the environment:

```json
{
  "apiKey": { "fromEnv": "PROVIDER_API_KEY" }
}
```

The CLI deliberately does not expose restore or deployment mutation. See the [complete CLI reference](https://github.com/IsaacThoman/pulpo/blob/main/apps/cli/README.md) for credential storage and command details.
