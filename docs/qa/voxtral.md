# Voxtral and watermark validation

Validation used disposable PostgreSQL/Redis databases, private fixture blob storage,
the real Pulpo API/web application, and a local HTTP server implementing the Mistral
speech/voice wire protocol. Reference and watermark uploads were synthesized test
signals. No production provider resources or application data were modified.

## Automated coverage

- Mistral JSON/base64 generation, private binding selection, no invented token
  usage, binary provider samples, pagination (including reduced page sizes),
  malformed/oversized responses, missing voices, and cancellation.
- Real FFmpeg decoding of all advertised formats; 3–30 second reference limits;
  rejection of malformed audio and unsupported playlist inputs; audible watermark
  energy, volume ratios, phase continuity across chunks, no WAV tail, MP3 output
  with bounded codec padding, peak limiting, active/queued cancellation, and
  temporary-file cleanup.
- Real PostgreSQL voice creation/repair, private asset isolation, user/admin
  authorization, failed replacement rollback, concurrent edits, deferred provider
  cleanup, shared references, disabled drafts, billing before/after mixing failure,
  and watermarked user previews. Existing accounting coverage checks rollback and
  funding behavior.
- Full PostgreSQL backup round trips preserve references, watermarks, previews,
  checksums, stable IDs, and provider bindings. A real legacy archive without an
  adapter, private assets, or cleanup table also restores successfully. These tests
  require separately named disposable databases and are enabled in CI.
- Admin component uploads/settings, provider import without overwriting labels,
  CLI argument/body/binary handling, management role/scope checks, web/mobile
  duration-header propagation, bounded prefetch, and playback disposal. Existing
  long-message, Unicode, unavailable-selection, and stop/lifecycle tests remain
  part of the full suite.

## Browser and CLI checks

The real admin editor was used to save an empty disabled Voxtral draft, load and
preview provider voices, import a voice, name and clone it, upload a watermark,
verify its disabled/15% defaults, enable it, change its level, synthesize a separate
user preview, play a mixed sample, and stop playback. The clone kept its original
local ID and exposed the private reference controls only in administration.
Unsupported OpenAI controls were absent. The editor fit both the normal desktop
viewport and a 390px viewport without horizontal overflow. No browser console
errors were observed.

The built CLI was exercised against the same API using real scoped management
tokens: discovery, provider sample/reference downloads, repair, watermark upload
and configuration, mixed preview generation, and read-only upload denial passed.
This caught and fixed a middleware-ordering issue: asset scope checks must run
after management token authentication, in `preHandler`.

A separate full backup of the browser-created assets was restored through the
actual backup service. All three audio objects were verified byte-for-byte using
SHA-256, with remapped private keys and unchanged voice/provider IDs.

## Repeating database checks

Use disposable databases named exactly `pulpo_speech_test` and
`pulpo_speech_backup_test`; the tests reject other database names. Apply migrations
to each first. The backup test truncates its database.

```sh
PULPO_SPEECH_POSTGRES_TEST=1 npm run test -w @pulpo/server -- \
  src/speech/assets.postgres.test.ts src/speech/billing.postgres.test.ts
PULPO_SPEECH_BACKUP_POSTGRES_TEST=1 npm run test -w @pulpo/server -- \
  src/speech/backup.postgres.test.ts
```

Set `DATABASE_URL` to the corresponding disposable database for each command.
The asset and backup tests use fixture storage/provider responses; FFmpeg must be
installed for asset tests. The full `npm test`, root build/typecheck workflow,
workspace lint, and documentation build are the delivery checks. On Node 26,
web tests use `NODE_OPTIONS=--no-experimental-webstorage` for jsdom localStorage.

## Checks not performed

Live Mistral synthesis/cloning was not exercised: no live Mistral credentials were
configured in this workspace. Provider behavior was checked using official API
schemas and local fixtures. Physical iOS/Android playback and locking, packaged
Electron playback, and subjective cloned-voice quality remain live/device checks.
The desktop renderer uses the same web playback code; desktop build/typechecks
and native/mobile lifecycle tests are automated.

Raw audio, screenshots, test credentials, local scripts, and disposable services
are excluded from version control. Deployment and merge are separate actions.
