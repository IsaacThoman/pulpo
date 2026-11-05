# Pulpo Office Converter

A small HTTP service around headless LibreOffice. Pulpo Files uses it to turn legacy and
OpenDocument files into the Office Open XML formats its editors open, and to export office
files as PDF (see `docs/files.md`). The code is `packages/office-converter`; this directory
builds its image.

LibreOffice (MPL-2.0) runs as a separate program in its own container; Pulpo only talks to it
over HTTP.

## Conversions

| From | To |
| --- | --- |
| `.doc`, `.rtf`, `.odt`, `.ott`, `.wpd`, `.pages`, `.dotx` | `.docx` or `.pdf` |
| `.xls`, `.ods`, `.ots`, `.numbers`, `.xltx` | `.xlsx` or `.pdf` |
| `.ppt`, `.pps`, `.odp`, `.otp`, `.key`, `.potx` | `.pptx` or `.pdf` |
| `.docx`, `.xlsx`, `.pptx` | `.pdf` |

Each format was checked with real files (`packages/office-converter/fixtures`, sources in its
README). Apple iWork support covers the formats LibreOffice's libetonyek reads (Pages 5,
Numbers 3, Keynote 5/6 and earlier); iWork files from newer releases may fail to convert.

## API

- `GET /healthz`: `200 {"status":"ok"}` once LibreOffice has started, `503` before.
- `GET /v1/formats`: the supported `{ from, to }` pairs.
- `POST /v1/convert?from=<extension>&to=<docx|xlsx|pptx|pdf>`: the document's bytes as the
  body; the converted bytes come back. Failures are JSON `{ "error": { "code", "message" } }`:

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `unsupported_conversion` | That pair is not supported |
| 401 | `unauthorized` | Missing or wrong token |
| 413 | `input_too_large`, `output_too_large` | Over a size limit |
| 415 | `unexpected_content` | The bytes are not the format the extension names |
| 422 | `encrypted` | Password-protected (other than a format's default password) |
| 422 | `conversion_failed` | LibreOffice could not read it, e.g. damaged |
| 503 | `busy`, `starting` | All slots and queue places taken, or not ready; retry after `Retry-After` |
| 504 | `timeout` | The job ran out of time and was killed |

Every request except `/healthz` needs `Authorization: Bearer <OFFICE_CONVERTER_TOKEN>` when
a token is configured.

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `PORT` | `8790` | |
| `OFFICE_CONVERTER_TOKEN` | none | Shared secret (32+ characters) the server sends |
| `OFFICE_CONVERTER_TIMEOUT_SECONDS` | `60` | Per job; the whole process tree is killed after it |
| `OFFICE_CONVERTER_CONCURRENCY` | `3` | Jobs running at once; Pulpo lets one account use two |
| `OFFICE_CONVERTER_MAX_QUEUED` | `8` | Jobs waiting; more get `503 busy` |
| `OFFICE_CONVERTER_MAX_INPUT_MB` | `100` | |
| `OFFICE_CONVERTER_MAX_OUTPUT_MB` | `100` | |
| `OFFICE_CONVERTER_MEMORY_LIMIT_MB` | `4096` in the image | Address-space limit (`ulimit -v`) per job, Linux only |
| `OFFICE_CONVERTER_WORK_DIR` | `/tmp/office-converter` | Profiles and job directories |

Pulpo's server is pointed at it with `OFFICE_CONVERTER_URL` (and `OFFICE_CONVERTER_TOKEN`);
without a URL, conversion is hidden in every client.

## Security model

Every document is untrusted. The service assumes a hostile file may try to run code, read
other files, reach the network, or exhaust resources.

- **Import filter forced by name.** LibreOffice normally guesses a file's format from its
  content, so a `.doc` holding HTML would be imported as a web page. The service checks the
  container signature (compound file, zip, RTF, WordPerfect) and passes the one import
  filter that extension may use (`--infilter`); anything else is refused before LibreOffice
  starts.
- **One profile per job.** Each job copies a template profile into a fresh directory, with
  its own home and temporary directory, and deletes all of it afterwards. Jobs share no state.
- **Locked settings** (`src/profile.ts`): macros disabled (security level "very high", no
  trusted locations), embedded OLE/DDE content and OLE automation disabled, links never
  updated on load in Writer and Calc, links from untrusted documents blocked, and HTTP(S)
  routed to a proxy on the discard port, so linked images or templates cannot be fetched.
  Startup fails if LibreOffice drops any of them. Tests convert documents with an on-load
  macro, a linked remote image, a section linked to a local file, and RTF fields including a
  local file, and check that none of them had any effect.
- **Local images are not walled off.** LibreOffice still embeds a linked local *image* (an RTF
  `INCLUDEPICTURE` naming a PNG or SVG, for example) in the output. Text files, sections,
  spreadsheet links, and DDE are not read. The container is what contains this: its file
  system holds LibreOffice, fonts, and the job's own files, nothing private, and every job
  directory has an unguessable name. Do not run the service natively on a machine whose images
  matter; a mount namespace around each job would close this but needs privileges the
  container deliberately lacks.
- **No inherited environment.** LibreOffice gets only `PATH`, `HOME`, `TMPDIR`, and `LANG`,
  never the service's token.
- **Limits.** Per-job timeout with the whole process group killed (and killed again after a
  normal exit so no helper survives), a cancelled request kills its job, a concurrency limit
  with a bounded queue, input and output size limits, and a per-job address-space limit.
- **Container.** Runs as UID 10001 under `tini` (which reaps processes orphaned by killed
  jobs), with a read-only root file system, a 1 GB tmpfs at `/tmp`, no capabilities,
  `no-new-privileges`, and memory and process limits. A request's body is read only once its
  job has a slot, so queued uploads wait in their sockets rather than in memory.
- **Network.** The service needs no network access of its own. In the infrastructure Compose
  files it sits alone on an `internal` network (`pulpo-prod-office`, `pulpo-dev-office`) with
  no route out, reached through callers on that network (the recommended HTTP relay below),
  and it refuses to
  start without `OFFICE_CONVERTER_TOKEN` (`OFFICE_CONVERTER_REQUIRE_TOKEN=true`). Its DNS also
  resolves no outside names (`dns: 127.0.0.1`). CI runs the smoke test with `--network=none`
  under the same restrictions. The `office` profile in the root `compose.yaml` is for local use
  and shares the default network.

## Fonts

Office documents name fonts the container cannot ship, so it carries metric-compatible
replacements that keep line breaks and page counts: Carlito (Calibri), Caladea (Cambria),
Liberation (Arial, Times New Roman, Courier New), DejaVu, Noto (many scripts), Noto CJK, and
Noto Color Emoji. The font cache is built into the image.

## Build and test

```bash
npm test -w @pulpo/office-converter          # uses a local LibreOffice when there is one
docker build -f infra/office-converter/Dockerfile --target test .   # unit tests on the image's LibreOffice
docker build -f infra/office-converter/Dockerfile -t pulpo-office-converter:test .
docker run --rm --network=none --read-only --tmpfs /tmp:size=1g,mode=1777 \
  --cap-drop=ALL --security-opt=no-new-privileges:true --memory=2g --pids-limit=512 \
  pulpo-office-converter:test office-converter-smoke-test
```

On macOS, `brew install --cask libreoffice` provides the `soffice` the unit tests look for. To
run the service natively:

```bash
npm run build -w @pulpo/office-converter
OFFICE_CONVERTER_SOFFICE=/Applications/LibreOffice.app/Contents/MacOS/soffice \
  node packages/office-converter/dist/index.js
```

The `office-converter` workflow builds and tests both architectures on pull requests, and
publishes `ghcr.io/isaacthoman/pulpo-office-converter` from `main` and release tags. Pin it by
digest (`PULPO_OFFICE_CONVERTER_IMAGE`) in the infrastructure Compose files.

## Running it

- Local Compose: `docker compose --profile office up -d`, then set
  `OFFICE_CONVERTER_URL=http://office-converter:8790` in the server environment.
- Production and persistent development: enable the `office` profile, pin the converter
  image by digest, and supply a token. See the verified Coolify wiring below before enabling
  the server URL. The infrastructure files intentionally leave the converter isolated.

### Coolify networking investigation (read-only, 2026-11-05 UTC)

Inspected running containers, network metadata, generated Compose network sections and the
installed Coolify **4.4.7** source on `bee`. No production configuration was changed.

- Production API (`alvlghtptjbgenf9kmkisgyp`) and worker (`rh0fvf8mfi97jcjchjhj0y6v`),
  and the equivalent persistent development apps, are independent Dockerfile applications.
  Their generated Compose attaches them only to the external `coolify` network. Infrastructure
  services also use `coolify`, with stable `pulpo-prod-*` / `pulpo-dev-*` aliases.
- PR #938 API and worker use only `lge7s5gv4obek4lo30319ph4-938`; other previews have their
  own PR-number network. These are not on `coolify`. The root Compose office profile is not
  enabled for previews today; do not point previews at the production converter.
- `ApplicationDeploymentJob.php` generates Dockerfile application networks from the destination.
  `convertDockerRunToCompose()` in `bootstrap/helpers/docker.php` has no `--network` mapping.
  Adding `--network pulpo-prod-office` to custom Docker options is silently ignored. Additional
  destinations deploy extra copies; they do not attach the existing container to another network.
  A one-off `docker network connect` disappears with the next container replacement.

**Recommendation:** keep LibreOffice exclusively on its internal network. Add a small HTTP
relay to the infrastructure Compose, attached to both `coolify` and `office`. API/worker reach
its stable environment-specific alias without changing their Dockerfile application networks.
The relay forwards only to the converter, passes the Bearer token through, and must never
provide a general forward proxy. The converter retains `OFFICE_CONVERTER_REQUIRE_TOKEN=true`.
This avoids giving the document parser an internet route or depending on post-deploy hooks.

The exact proposed addition under `services` in `deploy/compose.production-infra.yaml` is
below. This is a reviewable deployment recommendation, **not an applied configuration**.
Use the same block in `deploy/compose.development-infra.yaml`, changing both `pulpo-prod-`
aliases to `pulpo-dev-`. Pin the relay image by digest before enabling it.

```yaml
  office-relay:
    image: ${PULPO_OFFICE_RELAY_IMAGE:?Pin an nginxinc/nginx-unprivileged image by digest}
    profiles: [office]
    entrypoint: [/bin/sh, -ec]
    command:
      - |
        cat > /tmp/nginx.conf <<'CONF'
        pid /tmp/nginx.pid;
        error_log /dev/stderr warn;
        events { worker_connections 128; }
        http {
          access_log off;
          client_body_temp_path /tmp/client;
          proxy_temp_path /tmp/proxy;
          resolver 127.0.0.11 valid=10s ipv6=off;
          server {
            listen 8080;
            client_max_body_size 100m;
            client_body_timeout 210s;
            location / {
              set $$converter pulpo-prod-office-converter:8790;
              proxy_pass http://$$converter;
              proxy_http_version 1.1;
              proxy_set_header Connection "";
              proxy_request_buffering off;
              proxy_buffering off;
              proxy_connect_timeout 5s;
              proxy_send_timeout 210s;
              proxy_read_timeout 210s;
            }
          }
        }
        CONF
        exec nginx -c /tmp/nginx.conf -g 'daemon off;'
    read_only: true
    tmpfs: [/tmp:rw,nosuid,nodev,size=16m,mode=1777]
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    mem_limit: 64m
    pids_limit: 32
    restart: unless-stopped
    networks:
      office: {}
      coolify:
        aliases: [pulpo-prod-office-relay]
```

The doubled dollars preserve nginx variables through Compose interpolation. Set API **and worker**
`OFFICE_CONVERTER_URL=http://pulpo-prod-office-relay:8080` (development: `pulpo-dev-office-relay`)
and the same token as their infrastructure converter. Keep host ports and Traefik labels off
both services. No API/worker network change is needed on redeploy.

The design was checked against the observed generated Compose and Docker network membership;
the documented snippet was parsed with Compose locally without starting Docker. The fixed
upstream and runtime Docker DNS resolver let the relay follow converter container replacement.
No relay container or redeploy was tested on production. Before enabling it, validate the pinned
relay image/config in CI, then in persistent development check health, an authenticated conversion,
a wrong-token refusal, and conversion after separately redeploying converter, API and worker.
Keep previews disabled until their own scoped relay/converter wiring has equivalent coverage.
