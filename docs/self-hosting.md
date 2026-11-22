# Self-hosting Pulpo

Pulpo runs on one machine with Docker Compose. The stack is the web app, the API, a
background worker, PostgreSQL, Redis, S3-compatible file storage (SeaweedFS), and
Ollama, which generates embeddings for chat memory. You bring the model providers:
any OpenAI-, Anthropic-, or Mistral-compatible API, or a model server you run yourself.

This guide has two paths:

- [Try it on your computer](#try-it-on-your-computer) takes a few minutes and needs
  nothing but Docker.
- [Run it on a server](#run-it-on-a-server) sets up a real installation with a domain
  name and HTTPS.

Agent mode, which gives models a sandboxed Linux workspace, needs a separate machine.
It is covered in [Agent workspaces on K3s](self-hosting-agent-workspaces.md) and is
optional.

Pulpo is published under the
[Pulpo Noncommercial License](https://github.com/IsaacThoman/pulpo/blob/main/LICENSE.md).
Personal and other noncommercial use is permitted. Use inside a for-profit company and
the billing features need a separate license, so leave `PULPO_BILLING_ENABLED` off.

## Requirements

- Docker Engine with the Compose plugin. `docker compose version` should print a version;
  the older standalone `docker-compose` is not supported.
- Git.
- At least 2 CPU cores, 4 GB of RAM, and 15 GB of free disk. The running stack idles at
  about 600 MB of RAM. Most of the disk goes to the images, which are built on your
  machine from source.
- An API key for at least one model provider, or a local model server.
- For a server installation: two DNS names pointing at the server, such as
  `chat.example.com` and `files.example.com`, and ports 80 and 443 open to the internet.

The images build for both x86-64 and ARM64.

## Try it on your computer

```sh
git clone --branch main https://github.com/IsaacThoman/pulpo.git
cd pulpo
cp .env.example .env
sed -i.bak "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$(openssl rand -hex 32)|" .env && rm .env.bak
docker compose up -d --build
```

The `main` branch holds the latest release. The first build downloads dependencies and
takes several minutes. When the command returns, open `http://localhost:8080`. Pulpo
shows **Set up Pulpo**; the account you create there is the administrator. Then follow
[First steps](#first-steps).

This mode is for one computer. It runs in development mode over plain HTTP, and the app
only works at `http://localhost:8080`. Do not put it on the internet. Port 8080 is
published on every network interface, so other machines on your network can reach it.
PostgreSQL, Redis, the API, and file storage are published on `127.0.0.1` only, for
debugging.

If a port is already in use, change it in `.env` and run `docker compose up -d` again:

| Port | Setting | Also update |
| --- | --- | --- |
| 8080, web app | `PULPO_HTTP_PORT` | `PUBLIC_URL`, for example `http://localhost:9000` |
| 8333, file storage | `S3_PORT` | `S3_PUBLIC_ENDPOINT`, for example `http://localhost:9001` |
| 3000, API | `API_PORT` | |
| 5432, PostgreSQL | `POSTGRES_PORT` | |
| 6379, Redis | `REDIS_PORT` | |

## First steps

A new installation has no models. Open the menu on your name at the bottom of the
sidebar and choose **Admin panel**.

1. **Add a provider.** Under **Providers**, choose **Add provider**. Enter a name, pick
   the **API format** the provider speaks, and fill in **Provider base URL** and
   **Provider API key**. The base URL includes the version path, for example
   `https://api.openai.com/v1` or `https://api.anthropic.com/v1`.
   [Provider API formats](provider-api-formats.md) explains which format to choose.
2. **Add a model.** Under **Models**, choose **New model**. The button stays disabled
   until a provider exists. Fill in **Model name** (what people see), **Model ID** (a
   short identifier of your choice), the **Provider**, and **Upstream model** (the
   provider's own name for the model). Choose **Save & update**.
3. **Send a message.** Go back to **New chat**. The model is selected and ready.
4. **Decide who can join.** Under **Settings → Authentication**, **Enable new sign ups**
   is on by default and **Default user role** is **Pending approval**. Anyone can
   register, but they cannot use Pulpo until you change their role from `pending` to
   `user` under **Users**. Turn sign-ups off for a private instance and create accounts
   yourself with **Add user**.

Provider URLs must use HTTPS and a public address. To use a model server on your own
network, see [Local models](#local-models).

## Run it on a server

These steps produce an installation at `https://chat.example.com`, with uploaded files
served from `https://files.example.com`. [Caddy](https://caddyserver.com) terminates
HTTPS and obtains certificates automatically. Replace both names with your own
throughout.

Uploads and downloads go straight from the browser to file storage through signed,
short-lived URLs, which is why storage needs its own public name. If you would rather
use a single name, see [Storing files on local disk](#storing-files-on-local-disk)
before you start.

### 1. Point DNS at the server

Create A (and AAAA, if you use IPv6) records for both names. Caddy can only obtain
certificates once the names resolve to the server and ports 80 and 443 are reachable.

### 2. Get the code

```sh
git clone --branch main https://github.com/IsaacThoman/pulpo.git
cd pulpo
```

### 3. Create `.env`

Run this in the `pulpo` directory. It writes the configuration with freshly generated
secrets:

```sh
cat > .env <<EOF
COMPOSE_FILE=compose.yaml:compose.selfhost.yaml
PULPO_ENV_FILE=.env

NODE_ENV=production
PUBLIC_URL=https://chat.example.com
COOKIE_SECURE=true
ENCRYPTION_KEY=$(openssl rand -hex 32)

SERVICE_USER_POSTGRES=pulpo
SERVICE_PASSWORD_64_POSTGRES=$(openssl rand -hex 32)

STORAGE_DRIVER=s3
S3_BUCKET=pulpo
S3_PUBLIC_ENDPOINT=https://files.example.com
SERVICE_USER_S3=pulpo
SERVICE_PASSWORD_64_S3=$(openssl rand -hex 32)

PULPO_CLIENT_IP_MODE=forwarded
PULPO_TRUSTED_PROXY_CIDRS=172.28.57.0/24
EOF
chmod 600 .env
```

Then edit the two URLs.

| Setting | Purpose |
| --- | --- |
| `COMPOSE_FILE` | Makes every `docker compose` command use the two files named here. Without it, Compose would load `compose.override.yaml`, which is the development setup. |
| `PULPO_ENV_FILE` | The file the API and worker read their settings from. Without it they read `.env.example`. |
| `PUBLIC_URL` | The exact address people type. Password-reset links, passkeys, and upload permissions are derived from it. Passkeys are bound to this host name, so choose it before anyone registers one. |
| `COOKIE_SECURE` | Restricts the session cookie to HTTPS. |
| `ENCRYPTION_KEY` | Encrypts provider API keys, two-factor secrets, and other stored credentials. |
| `SERVICE_USER_POSTGRES`, `SERVICE_PASSWORD_64_POSTGRES` | Database account. The database is created with these on first start. |
| `S3_PUBLIC_ENDPOINT` | The address browsers use to reach file storage. |
| `SERVICE_USER_S3`, `SERVICE_PASSWORD_64_S3` | Access key and secret for file storage. |
| `PULPO_CLIENT_IP_MODE`, `PULPO_TRUSTED_PROXY_CIDRS` | Let the API see each visitor's real address through the proxies in front of it. See [Client addresses](#client-addresses). |

The `SERVICE_…` names are the ones the Compose file expects; they come from the
platform Pulpo's hosted service is deployed with.

Keep a copy of `.env` somewhere safe and separate from the server. Losing
`ENCRYPTION_KEY` makes the stored credentials unreadable. Do not change the database or
storage credentials after the first start: the services keep the ones they were
created with.

### 4. Add the HTTPS proxy

Create `compose.selfhost.yaml` next to `compose.yaml`:

```yaml
services:
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - web

networks:
  default:
    ipam:
      config:
        - subnet: 172.28.57.0/24

volumes:
  caddy_data:
  caddy_config:
```

And `Caddyfile`:

```
chat.example.com {
	reverse_proxy web:80
}

files.example.com {
	reverse_proxy seaweed-s3:8333
}
```

Only Caddy publishes ports. The database, Redis, the API, and file storage stay on the
private Docker network. The fixed subnet is what `PULPO_TRUSTED_PROXY_CIDRS` refers to;
if `172.28.57.0/24` is already used on your server, pick another private range and
change both places.

### 5. Start Pulpo

```sh
docker compose up -d --build
docker compose ps
```

Every service should be `Up`, and `web`, `postgres`, `redis`, and `ollama` should
report `healthy`. `object-storage-init` exits after it has prepared the storage volume;
that is expected. Check the installation from any machine:

```sh
curl https://chat.example.com/health
```

It answers `{"status":"ok","service":"pulpo-api"}`.

### 6. Create the administrator

Open `https://chat.example.com` straight away. The first person to reach the
**Set up Pulpo** page becomes the administrator, so do not leave a fresh installation
unattended. Then continue with [First steps](#first-steps), and set up
[backups](#backups) before you rely on the instance.

## Changing settings

Edit `.env`, then apply the change:

```sh
docker compose up -d
docker compose restart web
```

`docker compose up -d` recreates the API and worker with the new settings. The second
command matters: the `web` container looks up the API's address once, when it starts.
If the API comes back with a different address, `web` answers
**502 Bad Gateway** until it is restarted.

## Updating

Take a [backup](#backups) first. Then:

```sh
git pull
docker compose up -d --build
docker compose restart web
```

Database migrations run automatically when the new API starts, before it accepts
requests. Follow them with `docker compose logs -f api`. Going back to older code does
not undo a migration, so restore the backup if you need to roll back.

Each build leaves the previous images and several gigabytes of build cache behind.
Reclaim the space now and then:

```sh
docker image prune -f
docker builder prune -f
```

## Backups

### Full backup from the admin panel

**Admin panel → Settings → Database → Backup instance** builds and downloads
`pulpo-instance-<date>.tar.gz`. It holds the database and every stored file: accounts,
chats, attachments, Files, settings, and the encrypted provider credentials.

To restore, open the same page on the target instance. Under
**Recover full application**, choose the archive, type `RESTORE`, and choose
**Replace and restore**. This replaces everything on that instance and signs everyone
out. It also works for moving to a new server: install Pulpo there, create a throwaway
administrator, and restore.

Bring the original `ENCRYPTION_KEY` to the new server. With a different key, stored
credentials cannot be decrypted. Chats then fail with
`Unsupported state or unable to authenticate data` until you enter each provider's API
key again under **Admin panel → Providers**, and accounts that use two-factor
authentication need it reset.

### Automatic offsite backups

Pulpo can encrypt backups to a key only you hold and upload them to Backblaze B2 on a
schedule. See [Encrypted backups](backups.md).

### Database dump

For a database-only copy that does not depend on Pulpo:

```sh
docker compose exec -T postgres pg_dump -U pulpo -d pulpo | gzip > pulpo-db.sql.gz
```

Uploaded files are not in the database. They live in the `seaweed_*` Docker volumes,
or in `object_data` with local storage, so a dump alone is not a complete backup.

## Optional configuration

After any of these, [apply the change](#changing-settings).

### Email

Without email, an administrator sets a new password for someone who forgot theirs by
editing the account under **Admin panel → Users**. To let people reset their own, add
an SMTP account:

```dotenv
SMTP_URL=smtps://username:password@smtp.example.com:465
SMTP_FROM=Pulpo <pulpo@example.com>
```

Use `smtp://…:587` for a server that expects STARTTLS. Percent-encode special
characters in the user name and password.

### Local models

Pulpo refuses provider URLs that use plain HTTP or resolve to a private address. To
connect a model server on your own network, allow them:

```dotenv
ALLOW_PRIVATE_PROVIDER_URLS=true
```

The bundled Ollama service can then serve chat models as well. Pull a model, and add a
provider with the **OpenAI Chat Completions** format, the base URL
`http://ollama:11434/v1`, and any non-empty API key:

```sh
docker compose exec ollama ollama pull qwen3:4b
```

Then add a model whose **Upstream model** is the name you pulled. The bundled service
runs on the CPU. For anything beyond small models, run a GPU-backed server such as
Ollama, vLLM, or llama.cpp elsewhere and use its address as the base URL.

### Chat memory

Under **Admin panel → Settings → Episodic Memory**, **Enable relevant-chat recall**
downloads a small embedding model (about 240 MB) into the bundled Ollama service and
indexes the chats of people who turned on Memories.

### Storing files on local disk

Pulpo can keep files in a Docker volume and serve them through the API instead of
running S3 storage. You then need only one DNS name. The trade-off is a 25 MiB limit
per upload, the largest request the built-in web server accepts for the API. Decide
before the first start; files are not moved when you change this later.

In `.env`, replace `STORAGE_DRIVER=s3`, `S3_BUCKET`, and `S3_PUBLIC_ENDPOINT` with:

```dotenv
STORAGE_DRIVER=local
```

Leave the two `SERVICE_…_S3` lines in place; the Compose file still reads them. In
`compose.selfhost.yaml`, add these under `services:` so the storage services do not
start:

```yaml
  seaweed-master:
    profiles: ["s3"]
  seaweed-volume:
    profiles: ["s3"]
  seaweed-filer:
    profiles: ["s3"]
  seaweed-s3:
    profiles: ["s3"]
```

Remove the `files.example.com` block from the `Caddyfile`.

### Using your own reverse proxy

If the server already runs nginx, Traefik, or another proxy, leave out the `Caddyfile`,
the `caddy` service, and its two volumes. Keep the `networks` block. Publish the two
services on the loopback interface in `compose.selfhost.yaml` instead, and point your
proxy at them:

```yaml
services:
  web:
    ports:
      - "127.0.0.1:8080:80"
  seaweed-s3:
    ports:
      - "127.0.0.1:8333:8333"
```

Your proxy must:

- Pass the `Host` header through unchanged. Signed file URLs fail otherwise.
- Support WebSocket upgrades on `/socket.io/`.
- Not buffer responses, and allow long-lived requests. Replies are streamed.
- Allow request bodies as large as your attachment limit on the files name, and at
  least 100 MB on the app name.
- Set `X-Forwarded-For` and `X-Forwarded-Proto`.

### Client addresses

The API sits behind two proxies: Caddy and the `web` container. In `forwarded` mode it
reads the visitor's address from `X-Forwarded-For`, trusting only proxies inside
`PULPO_TRUSTED_PROXY_CIDRS`. This is what makes **Settings → Devices** show real
addresses and keeps one visitor's rate limit from affecting everyone else. Caddy
discards any `X-Forwarded-For` header a visitor sends, so it cannot be forged.

After signing in from another network, check that **Settings → Devices** shows your
public address. If it shows an address from the Docker subnet instead, Docker is not
passing the original address to Caddy, which happens with rootless Docker and some
IPv6 setups.

Behind Cloudflare, use `PULPO_CLIENT_IP_MODE=cloudflare`.
[Production deployments](production-deployments.md#client-ips-behind-cloudflare-tunnel)
describes each mode.

### Mobile apps

The iOS and Android apps can sign in to your instance. On the sign-in screen, choose
**Change server** and enter your `https://` address. The apps require HTTPS.

### Command-line administration

The [Pulpo CLI](https://github.com/IsaacThoman/pulpo/blob/main/apps/cli/README.md)
manages providers, models, users, and settings from a terminal.

## Security checklist

- Create the administrator immediately after the first start.
- Turn off **Enable new sign ups** unless you want registrations.
- Turn on two-factor authentication for administrator accounts in their account
  settings.
- Publish only ports 80 and 443. The Compose file for servers publishes nothing else.
- Keep `.env` private (`chmod 600`) and backed up.
- Update regularly.

## Troubleshooting

Start with the logs:

```sh
docker compose logs --tail 100 api worker web
```

| Symptom | Cause and fix |
| --- | --- |
| **502 Bad Gateway** after changing settings or updating | `web` still has the API's old address. Run `docker compose restart web`. |
| The app loads but sign-in does not stick | `COOKIE_SECURE=true` while browsing over plain HTTP. Use the HTTPS address. |
| **Add provider → Create** does nothing | The URL uses `http://` or a private address. See [Local models](#local-models). |
| Attachments fail to upload | The browser cannot reach `S3_PUBLIC_ENDPOINT`. Open that address in a browser: an XML `AccessDenied` page means it is reachable. Check DNS, the certificate, and that `PUBLIC_URL` matches the address in the address bar exactly. |
| Chats fail with `Unsupported state or unable to authenticate data` | `ENCRYPTION_KEY` differs from the one the data was written with. Restore the key, or enter the provider API keys again. |
| The API restarts in a loop | Usually an invalid setting. The first lines of `docker compose logs api` name it. |
| Caddy does not obtain a certificate | The DNS name does not resolve to this server yet, or port 80 or 443 is blocked. See `docker compose logs caddy`. |

## Removing Pulpo

```sh
docker compose down
```

stops the stack and keeps its data. Add `--volumes` to delete the database, the files,
and everything else permanently.

## Settings reference

The settings most installations touch. `.env.example` lists the rest.

| Setting | Default | Meaning |
| --- | --- | --- |
| `PUBLIC_URL` | `http://localhost:5173` | Address people use to reach Pulpo. |
| `NODE_ENV` | `development` | Set to `production` on a server. |
| `COOKIE_SECURE` | `false` | Send the session cookie over HTTPS only. |
| `ENCRYPTION_KEY` | development key | At least 32 characters. Encrypts stored credentials. |
| `INSTANCE_NAME` | `Pulpo` | Name shown by authenticator apps and passkey prompts. |
| `STORAGE_DRIVER` | `local` | `s3` or `local`. |
| `S3_PUBLIC_ENDPOINT` | same as `S3_ENDPOINT` | Address browsers use for uploads and downloads. |
| `S3_BUCKET` | `pulpo` | Bucket name. Created on first use. |
| `S3_CONFIGURE_CORS` | `true` | Let Pulpo set the bucket's CORS rules from `PUBLIC_URL`. |
| `PULPO_CLIENT_IP_MODE` | `direct` | `direct`, `forwarded`, or `cloudflare`. |
| `PULPO_TRUSTED_PROXY_CIDRS` | empty | Proxy addresses to trust. Required unless the mode is `direct`. |
| `ALLOW_PRIVATE_PROVIDER_URLS` | `false` | Permit HTTP and private-network provider URLs. |
| `SMTP_URL`, `SMTP_FROM` | empty | Outgoing email for password resets. |
| `SESSION_TTL_DAYS` | `30` | How long a sign-in lasts. |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, or `silent`. |
| `WORKSPACE_CONTROLLER_URL`, `WORKSPACE_CONTROLLER_TOKEN`, `WORKSPACE_CONTROLLER_CA_CERT_BASE64` | empty | Connection to an [agent workspace cluster](self-hosting-agent-workspaces.md). |
| `PULPO_BILLING_ENABLED` | `false` | Leave off. The billing features are not covered by the license. |
