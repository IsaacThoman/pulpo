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
  no route out, which the API and worker containers must join to reach it, and it refuses to
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
- Production and persistent development: on the infrastructure application set
  `COMPOSE_PROFILES=office`, `OFFICE_CONVERTER_TOKEN` (32+ random characters), and
  `PULPO_OFFICE_CONVERTER_IMAGE` (pinned by digest). Attach the API and worker containers to the
  `pulpo-prod-office` network (`pulpo-dev-office` for development) as well as `coolify`, and
  give them `OFFICE_CONVERTER_URL=http://pulpo-prod-office-converter:8790` (`pulpo-dev-…`) and
  the same token. The attachment has to survive redeploys, so make it part of the API and
  worker applications' own configuration rather than a one-off `docker network connect`. If
  the platform cannot attach them to a second network, also put the converter on `coolify`:
  the token then still guards it, but it gains a route out, so prefer the isolated network.
