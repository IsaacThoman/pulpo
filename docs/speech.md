# Speech models, cloned voices, and watermarks

Pulpo read-aloud works on web, desktop, and mobile. Administrators manage speech
models under **Admin → Speech models**. Voice selections belong to one model;
changing a provider binding does not change the voice ID saved in user preferences.
Dictation and live voice conversations use separate systems.

## Server setup

Apply database migration `0070_speech_voice_assets.sql` with the normal
`npm run db:migrate` workflow before running the updated server. It adds private
per-voice assets and a durable resource-cleanup queue. Existing model configuration,
voice IDs, previews, preferences, and billing retain their existing behavior;
models without an adapter use OpenAI-compatible requests.

The server runtime image includes FFmpeg. For development or a custom runtime,
install FFmpeg on the API server's PATH, including its `libmp3lame` encoder:

```sh
# Debian / Ubuntu
apt-get update
apt-get install -y ffmpeg

# macOS development
brew install ffmpeg

ffmpeg -version
ffmpeg -encoders
```

FFmpeg validates uploaded audio, normalizes private assets to 24 kHz mono PCM WAV,
and mixes watermarks. At most two processes run concurrently per API process,
with sixteen queued operations, a two-minute processing deadline, and bounded
output. Cancellation kills the subprocess; temporary files are removed. Running
several API replicas multiplies this concurrency bound.

## Configure Voxtral

1. Save a provider connection with the Mistral API key and base URL
   `https://api.mistral.ai/v1`.
2. Add a speech model and choose **Mistral Voxtral**. The editable preset selects
   `voxtral-mini-tts-2603`, MP3 output, and a conservative 1,500-character chunk
   size. That chunk size is a Pulpo default, not a claimed provider hard limit.
3. Save the disabled draft. An empty voice list is allowed while disabled.
4. Reopen it and **Load Mistral voices**. Preview and add the desired voices, then
   save. Discovery loads paginated provider results; adding a voice does not
   overwrite existing labels, previews, or watermark settings.
5. Choose a default voice and enable the model when ready. Test provider IDs
   before enabling a manually entered voice.

The native adapter sends `voice_id` and decodes the non-streaming JSON/base64
response. MP3 and WAV are supported. OpenAI speech SSE, speed, and instruction
controls are unavailable for Voxtral. The client still generates and plays chunks
with at most one chunk prefetched.

Billing starts disabled. Administrators may set a character price or a generated
audio-minute price. Mistral token usage is not fabricated. Admin voice tests and
preview synthesis may incur provider costs, but do not charge a Pulpo user balance.

## Create and maintain cloned voices

Add a voice with a stable local ID and a display name, and save the model. Expand
that voice's **Voice audio settings**, then upload its **Cloning reference**.
Pulpo registers a named Mistral voice and privately retains a normalized reference,
its SHA-256 checksum, and the provider binding. Replacing the reference creates a
new provider voice, publishes it atomically, and retires the old binding. A failed
upload leaves the previous working binding intact. Synthesized previews are cleared
when a clone is replaced or repaired so users do not hear the old voice.

Upload limits are Pulpo's own bounds:

| Asset | Accepted inputs | Maximum upload | Decoded duration |
| --- | --- | --- | --- |
| Cloning reference | MP3, WAV, M4A/AAC, FLAC, Ogg/Opus | 10 MiB | 3–30 seconds |
| Watermark | MP3, WAV, M4A/AAC, FLAC, Ogg/Opus | 10 MiB | Greater than zero, at most 2 minutes |
| Separately uploaded user preview | MP3, WAV | 5 MiB | Greater than zero, at most 30 seconds |

Actual decoding validates reference/watermark content; filenames and MIME types
alone are insufficient. References are accessible only to administrators. Users
hear a separately uploaded preview or one created with **Generate user preview**.
The reference is never automatically published as a preview. **Listen to reference**
and **Listen to watermark** inspect the original normalized private uploads.

If Mistral reports a missing voice, use **Repair provider voice** to register the
saved reference again. Pulpo keeps its local voice ID, label, watermark, and user
preferences. Imported provider voices without a local reference must be replaced
with an available provider voice or receive a new reference upload.

Remove the voice from the model and save to remove its private assets. Pulpo deletes
only remote voices it created, and checks for remaining model references before
cleanup. Provider voices imported from discovery are not owned by Pulpo and are
not deleted just because they are removed from a model.

Failed or deferred cleanup appears under **Speech resource cleanup**. Correct the
provider/storage problem and choose **Retry cleanup**. A still-referenced provider
voice stays queued until all references are removed. Interrupted uploads use a
unique provider slug for reconciliation and a ten-minute staging grace period.
Cleanup also runs opportunistically after voice/model mutations, with a bounded
processing window; no additional background service is required. Pending remote
cleanup retains its provider connection, preventing that connection's deletion.

## Per-voice watermarks

Upload a watermark to any saved voice, including OpenAI-compatible voices. It starts
disabled with a 15% volume setting. Enable it and adjust the volume from 1–100%.
Changes publish immediately after validation; ordinary model edits must be saved
before managing assets. **Test voice and watermark** synthesizes a mixed sample;
**Stop preview** cancels it.

The clip loops beneath speech, beginning at the start of each message and ending
with speech. There is no appended watermark tail. FFmpeg mixes and limits peaks
on the server, so clients receive the mixed audio. User previews are also mixed
when downloaded. Saved synthesized preview audio remains unmarked in private
storage so changing a watermark does not mix it twice.

Clients send `playbackOffsetSeconds` with each generation request and accumulate
`x-speech-duration-seconds` from successful responses. The header is exposed through
CORS. This preserves loop position across chunks without changing one-chunk
prefetch. The header and charges use original generated speech duration; audio
mixing adds no billable duration. Older clients omit the offset and still receive
watermarked audio, with the loop restarting on each chunk.

If an enabled watermark is missing or cannot be mixed, Pulpo returns a recoverable
error before charging the user or sending audio. Replace the clip or correct the
server's FFmpeg/storage setup and retry. MP3 encoding may add its normal codec
padding; WAV is useful when inspecting exact sample timing.

## Management API and CLI

New endpoints use the same current-admin and scoped-token checks as existing
speech management. Reads require `catalog:read`; mutations require `catalog:write`.
Cloning references are excluded from the public catalog. The corresponding web
admin prefix is `/api/admin/speech-models`.

| Method | `/api/management/v1/speech-models` suffix | Purpose |
| --- | --- | --- |
| GET | `/:id/provider-voices` | Discover all available Mistral voices |
| GET | `/:id/provider-voices/:voiceId/sample` | Download a provider sample |
| POST / GET | `/:id/voices/:voiceId/clone` | Upload/replace or inspect a reference |
| POST | `/:id/voices/:voiceId/clone/repair` | Re-register the saved reference |
| POST / GET / DELETE | `/:id/voices/:voiceId/watermark` | Upload/replace, inspect, or remove the clip |
| PATCH | `/:id/voices/:voiceId/watermark` | Set `{ "enabled": true, "volume": 0.15 }` |
| POST | `/:id/voices/:voiceId/test` | Synthesize `{ "input": "Hello", "savePreview": false }` |
| GET | `/cleanup` | List pending cleanup records |
| POST | `/cleanup/:cleanupId/retry` | Retry an eligible cleanup record |

Uploads are multipart requests with one `file` part. Test generation returns binary
audio. Remove a cloned voice through normal model update; there is no operation
that leaves a cloned voice pointing to a deleted reference.

```sh
pulpo speech-model preset voxtral --provider "$PROVIDER_ID" --adapter mistral > speech.json
pulpo speech-model create --file speech.json
pulpo speech-model provider-voices voxtral
pulpo speech-model provider-sample voxtral "$VOICE_ID" -o sample.wav
# Add a voice and defaultVoice to speech.json, then save before uploading assets.
pulpo speech-model update voxtral --file speech.json
pulpo speech-model clone upload voxtral "$VOICE_ID" reference.m4a
pulpo speech-model clone download voxtral "$VOICE_ID" -o reference.wav
pulpo speech-model clone repair voxtral "$VOICE_ID"
pulpo speech-model watermark upload voxtral "$VOICE_ID" watermark.ogg
# watermark.json contains {"enabled":true,"volume":0.15}
pulpo speech-model watermark configure voxtral "$VOICE_ID" -f watermark.json
pulpo speech-model test-voice voxtral "$VOICE_ID" --text 'Hello.' --save-preview -o mixed.mp3
pulpo --yes speech-model watermark delete voxtral "$VOICE_ID"
pulpo speech-model cleanup
pulpo speech-model cleanup --retry "$CLEANUP_ID"
```

Download extensions should match the model's configured MP3/WAV output. Private
reference and watermark downloads are normalized WAV.

## Backups and recovery

Full backups include active references, watermarks, synthesized/uploaded previews,
checksums, and provider bindings. Restore remaps private blob keys and preserves
local voice IDs. Legacy backups default to OpenAI-compatible adapters, empty
private assets, and no watermarks. The pending remote-cleanup queue is included;
its obsolete local object keys are discarded on restore because retired/staged
blobs are not archived.

Mistral's remote voice store is external to the archive. Restore does not create
or overwrite provider resources automatically. Test restored cloned voices and
use explicit repair if their bindings no longer exist. Use the same server
secret-encryption key required by other encrypted provider connections in backups.

The adapter follows the [Mistral speech API](https://docs.mistral.ai/api/endpoint/audio/speech)
and [voice API](https://docs.mistral.ai/api/endpoint/audio/voices). Mixing uses
[FFmpeg amix](https://ffmpeg.org/ffmpeg-filters.html#amix) with the first input's
duration and peak limiting.
