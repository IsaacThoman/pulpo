# Self-hosted Whisper for Pulpo

This service provides a browser upload page and a separate authenticated endpoint
for Pulpo dictation. It runs independently of the Pulpo API. The supported setup
uses Apple silicon, Node.js 22 or later, FFmpeg, and the
`whisper-large-v3-turbo-Q8_0.gguf` model. It can reuse the copy installed by
T3 Code under `~/.t3/userdata/speech/models/`.

## Start the service

In this directory, run `npm ci`. Set `WHISPER_PULPO_TOKEN` in your service
manager to a new shared secret. For example, generate one with
`openssl rand -hex 32`. Then run `npm start` under the user who has access
to the model. The service binds to `127.0.0.1:5577` by default.

| Environment variable | Purpose |
| --- | --- |
| `WHISPER_PULPO_TOKEN` | Shared secret, at least 32 printable non-space characters. The Pulpo API is disabled when this is unset. |
| `WHISPER_MODEL_PATH` | Optional path to the GGUF model. Defaults to the T3 Code model path above. |
| `WHISPER_FFMPEG` | Optional path to the FFmpeg executable. Defaults to `ffmpeg` on PATH. |
| `WHISPER_PORT` | Optional loopback port. Defaults to `5577`. |

Use one process per checkout. If replacing an existing Whisper Transcribe
installation, update that service to this version before configuring Pulpo, then
restart it through its service manager. Set `WHISPER_FFMPEG` explicitly if
your service manager does not include Homebrew on PATH.

## Connect Pulpo

1. Share the local service on the Tailnet using Tailscale Serve. For a host
   with an existing Serve configuration, choose an unused HTTPS port, for
   example `tailscale serve --bg --https=8465 http://127.0.0.1:5577`. Give
   Pulpo's runtime access to that host and port through your Tailnet policy.
2. Set `PULPO_DICTATION_WHISPER_URL` to the service's HTTPS origin, including
   its port if applicable. Set `PULPO_DICTATION_WHISPER_TOKEN` to the same
   secret as the service. Restart the Pulpo API. The URL must be reachable
   from the API process itself, including when it runs in a container. HTTP is
   accepted for loopback connections.
3. In **Admin → Settings → Dictation**, select **Self-hosted Whisper**, enable
   dictation, and save. Billing continues to use decoded audio duration.
   Switching the setting back to **Groq** uses its saved API key.

The browser page remains accessible to devices allowed by the Tailnet policy.
Pulpo submits and retrieves its jobs through bearer-authenticated endpoints.
The service handles one file at a time, deletes temporary audio after processing,
and retains completed results in memory for up to 15 minutes. Pulpo uses its
existing 10 MB upload limit and 30-second provider timeout. A failed Whisper
request stays with that provider and returns an error to the caller.
