# Mobile dictation validation

## Disposable fixture

Build contracts, client-core, and server. With the local PostgreSQL container
running, create dedicated resources (once):

```sh
docker exec pulpo-postgres-1 psql -U pulpo -d postgres -c 'CREATE DATABASE pulpo_mobile_dictation_e2e'
docker run -d --name pulpo-dictation-qa-redis -p 127.0.0.1:6396:6379 redis:7-alpine
```

Use this environment for migration and fixture startup:

```sh
export POSTGRES_DATABASE=pulpo_mobile_dictation_e2e
export REDIS_URL=redis://localhost:6396
export PUBLIC_URL=http://localhost:8096
export PORT=8096 HOST=127.0.0.1
export ALLOW_ANY_LOCALHOST_PORT=true ALLOW_PRIVATE_PROVIDER_URLS=true
npm run db:migrate -w @pulpo/server
node apps/mobile/e2e/dictation-fixture.mjs
```

The fixture refuses other database, Redis, host, or port settings. It runs the
real server/authentication/multipart/draft/realtime code and replaces only the
Groq fetch response. Uploads must be M4A (`ftyp`) with `audio/mp4`; the control
endpoint keeps byte counts and MIME metadata, never audio bytes. It makes no
external transcription requests and disables billing in this disposable database.
Attachment fixtures use a dedicated directory under the system temporary directory.

Run native builds with `EXPO_PUBLIC_DEFAULT_INSTANCE_URL=http://localhost:8096`.
Use Metro on a dedicated port; Android needs reverse forwarding for both API and
Metro. Keep iOS simulator signing enabled so SecureStore receives its Keychain
entitlements (`CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=-` with xcodebuild).
Sign in as `dictation@example.test` / `Dictation-test-only-2026`.

The loopback control server at port 8097 accepts JSON POSTs with `mode` set to
`success`, `slow` (20 seconds), `no-speech`, `failure`, or `rate-limit`. Optional
`text` changes the transcript, and `reset: true` clears request metadata. GET
returns current settings and observed uploads. Restore `success` after testing.

API acceptance accepts a local M4A file, including one synthesized on macOS:

```sh
say -o /tmp/pulpo-dictation-speech.aiff 'Hello from mobile dictation.'
afconvert -f m4af -d aac /tmp/pulpo-dictation-speech.aiff /tmp/pulpo-dictation-speech.m4a
node apps/mobile/e2e/dictation-api.mjs /tmp/pulpo-dictation-speech.m4a
```

## Native acceptance scenarios

Use fresh native builds on iPhone, iPad, and Android. Reset microphone permission
on the disposable simulator when checking the initial prompt.

1. Deny microphone access. Verify a useful error, an unchanged draft, and no upload.
   Grant permission in Settings, return, and retry.
2. Record and stop. Verify visible recording/transcription states, disabled send
   and shelf transfers while busy, one M4A upload, editable text, and manual send.
3. Repeat with existing text, a selected range, and message/queued-message edits.
   Check that surrounding text and attachments survive. Change the text during
   a `slow` response and verify safe append to the latest draft.
4. Cancel recording and transcription; background the app; navigate to another
   chat or start a fresh draft. Verify no late insertion and no retained audio.
5. Exercise no-speech, provider error, rate limit, and offline behavior. Verify
   recovery and successful retry without duplicate uploads.
6. Record for 90 seconds. Verify automatic stop and exactly one transcription.
7. Inspect compact/tablet layouts, keyboard visibility, and accessible controls.

## Results

Run `node apps/mobile/e2e/dictation-native-config.mjs` to check the resolved
microphone permissions (including interactions between config plugins).

Automated checks passed: contracts (78), client-core (84), mobile (541), affected
server dictation/mobile routes (16), and web dictation (2). Mobile typechecking,
repository lint, the full repository build, iOS/Android exports, resolved native
config checks, and `git diff --check` passed.

The real API fixture accepted M4A multipart uploads and rejected invalid auth,
empty audio, unsupported MIME, oversized audio, no-speech, provider failure, and
rate limits. Existing server tests cover unchanged billing/error behavior.

Android 16 emulator, fresh debug APK: native recording and authenticated M4A
uploads passed (`audio/mp4`, nonempty `ftyp` files), including repeat recording,
selected-text replacement, safe append after typing during transcription,
recording/transcription cancellation, background interruption, draft switching,
permission denial/first grant, provider/no-speech/rate-limit errors and recovery,
offline start prevention, manual sending, message/queued-message editing, and
attachment preservation. Automatic stop at 90 seconds produced one 1.13 MB M4A.
The inserted draft was also verified in the real server composer_drafts table. Temporary audio was removed
after completion and cancellation.

iOS 26.5 iPhone 17 Pro and iPad Pro 11-inch (M5), fresh signed simulator build:
native permission grant, repeated recording/stop, authenticated M4A uploads,
selected-text replacement, correct caret placement for repeated insertion,
recording cancellation, navigation to Settings, background interruption, and
temporary-file cleanup passed. iPhone additionally passed permission denial,
transcription cancellation with no stale insertion, provider failure/recovery,
restored-draft insertion, attachment preservation, and manual sending. Drafts
synchronized between Android, iPhone, and iPad. Compact iPhone and tablet
portrait/landscape layouts were inspected, including the software keyboard.

Native testing found and fixed Android permission-activity cancellation, SDK 57
multipart file compatibility, a hidden drawer search-field blur rejection, and
iOS selection synchronization after draft restoration and transcript insertion.
Navigation focus now cancels dictation even when the composer stays mounted.
Regression tests cover these paths. The image-picker plugin's microphone
permission removal was also caught and corrected by merged-config validation.

Limitations: no configured test Groq credential was available, so live provider
speech recognition and recognition accuracy were not validated. Actual native
microphone recording, M4A containers, authentication, multipart transport, and
server handling were exercised with a controlled provider response. Android 17
emulator startup was unstable; the completed Android run used Android 16.
Physical-device deployment and merging are outside this validation.
Raw screenshots, recordings, build logs, and generated projects stay outside Git.

Toolbar follow-up: shelf is first, followed by attachments, chat presets, and
Agent mode; dictation and send stay right-aligned. The compact iPhone layout was
checked in the simulator. After reconciling the latest dev performance changes,
all 541 mobile tests, typechecking, and lint passed.
