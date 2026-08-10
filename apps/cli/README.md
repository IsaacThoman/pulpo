# Pulpo CLI

Operator-first command-line client for a Pulpo instance.

```bash
npm install --global @isaacthoman/pulpo
pulpo context add production --url https://pulpo.example.com
pulpo auth login --email admin@example.com
pulpo auth 2fa status
pulpo auth 2fa setup
pulpo auth 2fa confirm
pulpo settings export --output pulpo-settings.json
pulpo icon upload ./acme.png --name Acme --mode monochrome
```

Use `pulpo help` or `pulpo <command> --help` for the complete command reference.

Model create and update files may configure chat preset and choice icons with any
canonical [Lucide](https://lucide.dev/icons/) name. Discover available names with
`pulpo model icons`, or filter them locally with a query such as
`pulpo model icons camera`. Invalid names are rejected before the model request is
sent. Add `--json` for stable `{ "name": "..." }` rows in scripts.

The major command groups are `context`, `auth`, `token`, `instance`, `settings`,
`provider`, `lab`, `icon`, `model`, `user`, `usage`, `audit`, `workspace`, `banner`,
`job`, `export`, and `backup`. There is intentionally no restore command.

Human-readable tables are the default. `--json` reserves stdout for stable JSON;
errors remain on stderr, and noninteractive destructive commands require
`--yes`. Add `--verbose` to print method, path, status, and timing diagnostics
without printing authorization headers or request bodies.

Configuration precedence is command-line options, then `PULPO_CONTEXT` /
`PULPO_URL` / `PULPO_TOKEN`, then the current stored context. Context metadata
lives in the platform config directory. Session tokens use Keychain on macOS or
Secret Service on Linux when available, with a mode-`0600` file and warning as
the fallback. Passwords are read from a hidden prompt, stdin, or
`PULPO_PASSWORD`; no secret-bearing password/token option is accepted.
Authenticator and recovery codes use the hidden prompt or `PULPO_2FA_CODE`.
Enrollment secrets and recovery codes are printed only when created; store them
securely before continuing.

Settings exports use `apiVersion: pulpo.dev/management/v1` and carry an opaque
revision. `settings diff` exits with status 2 when changes exist. A stale
`settings apply` fails rather than overwriting a newer change. Use a marker such
as `{ "fromEnv": "KAGI_API_KEY" }` for a secret replacement or
`{ "clear": true }` to remove it.

Management token scopes are `account:read`, `account:write`, `instance:read`,
`instance:write`, `catalog:read`, `catalog:write`, `users:read`, `users:write`,
`usage:read`, `audit:read`, `operations:read`, and `operations:write`.
Administrator scopes continue to require the token owner's current administrator
role. Tokens are shown only once when created and only work below
`/api/management/v1`.

Deleting a model permanently reassigns its historical chats and usage to the
hidden `unknown model` placeholder while retaining recorded token and cost
totals. Active or queued model work must finish before deletion can proceed.
