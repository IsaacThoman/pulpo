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
pulpo icon upload ./acme.svg --name Acme --mode monochrome
pulpo model test acme-model "Reply with a short greeting" --no-agent --preset reasoning=off
```

Use `pulpo help` or `pulpo <command> --help` for the complete command reference.

Model create and update files may configure chat preset and choice icons with any
canonical [Lucide](https://lucide.dev/icons/) name. Discover available names with
`pulpo model icons`, or filter them locally with a query such as
`pulpo model icons camera`. Invalid names are rejected before the model request is
sent. Add `--json` for stable `{ "name": "..." }` rows in scripts.

Test a newly configured model with `pulpo model test <model-id> [prompt...]`.
The command requires exactly one of `--agent` or `--no-agent`, plus one explicit
`--preset <preset-id>=<choice-id>` for every preset exposed by the model. It
does not silently apply preset defaults. For example:

```bash
pulpo model test acme-model "Investigate the failing build" \
  --agent \
  --preset reasoning=high \
  --preset web-search=enabled

git diff | pulpo model test acme-model \
  --no-agent \
  --preset reasoning=off \
  --preset web-search=disabled
```

Model tests stream assistant text to stdout and use temporary chats by default.
Pass `--keep` to retain the test in normal chat history, `--no-stream` to wait
for the completed text, `--json` for one final result, or `--jsonl` for the
replayable response event stream. Model testing requires a user session created
by `pulpo auth login`; management tokens cannot access user chat endpoints.

Speech models have a separate catalog from chat models. Create an editable preset
using an existing provider connection (this only prints JSON; it does not create
the model or contact the provider):

```bash
pulpo provider list
pulpo speech-model preset read-aloud --provider "$PROVIDER_ID" > speech.json
# Edit speech.json, including enabled, voices, capabilities, limits, and billing.
pulpo speech-model create --file speech.json
pulpo speech-model list
pulpo --json speech-model get read-aloud > speech.json
# Edit the exported model, keeping its ID unchanged.
pulpo speech-model update read-aloud --file speech.json
```

Create and update accept a **complete model document**, including display name,
provider connection ID, upstream model ID, enabled status, ordering, voice
IDs/labels and default voice, instruction/speed capabilities and range, character
and token limits, MP3/WAV response format, SSE support, and billing configuration.
Update replaces the configuration; use `get` first to preserve existing values.
The preset starts disabled with billing off. Set `billUsers` and choose
`billingUnit: "tokens"`, `"characters"`, or `"duration"`. Rates are integer USD
microdollars: `inputPriceMicros`/`outputPriceMicros` per million respective tokens,
`characterPriceMicros` per 1,000 Unicode characters, or `minutePriceMicros` per
audio minute. Token billing requires SSE usage support. Credentials remain in
the referenced provider connection.

Manage each voice's optional sample independently:

```bash
pulpo speech-model preview upload read-aloud coral ./coral.wav
pulpo speech-model preview download read-aloud coral --output ./coral-preview.wav
pulpo --yes speech-model preview delete read-aloud coral
pulpo --yes speech-model delete read-aloud
```

Uploading again replaces that voice's clip. MP3 and WAV files must be nonempty,
at most 5 MiB, and no longer than 30 seconds; the server validates the audio.
Deleting a preview leaves its voice configured. Model updates retain clips for
unchanged voice IDs and remove clips for deleted voices. Model deletion removes
its clips. Listening to an uploaded sample does not generate speech or incur
generation charges.

Speech catalog and preview commands use `/api/management/v1/speech-models` and
require a current administrator with `catalog:read` for reads/downloads or
`catalog:write` for mutations. Older servers without the `speechModels`
capability report that an upgrade is required. User preferences continue to use
`pulpo settings get account.speech`, `pulpo settings set account.speech.modelId
read-aloud`, and settings export/apply; configure per-model `voice`, `instructions`,
and `speed` in `account.speech.models` with account read/write scopes. No database
migration is needed for these CLI commands.

The major command groups are `context`, `auth`, `token`, `instance`, `settings`,
`provider`, `lab`, `icon`, `model`, `speech-model`, `user`, `usage`, `audit`, `workspace`, `banner`,
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

### Voxtral, cloned voices, and watermarks

Use `speech-model preset --adapter mistral` for the Voxtral preset. The
`provider-voices`, `provider-sample`, `clone`, `watermark`, `test-voice`, and
`cleanup` subcommands manage provider discovery, private reference uploads,
repair, looping watermark settings, synthesized previews, and retryable cleanup.
See [the speech administration guide](../../docs/speech.md) for complete commands,
upload limits, billing behavior, and FFmpeg setup.
