# Encrypted Backblaze backups

Pulpo can automatically create full-instance backups, encrypt them with an offline [age](https://github.com/FiloSottile/age) identity, and upload the ciphertext to Backblaze B2. The private identity is never entered into Pulpo or Backblaze.

Offsite backups come in two formats:

- **Snapshots** hold the database and a manifest of the files it references. Each attachment, file, avatar, icon, and voice clip is encrypted and uploaded separately, once, and shared by every later snapshot. A run uploads the database plus only the files that are new since earlier snapshots. Manual runs and most scheduled runs are snapshots.
- **Full archives** are self-contained `.tar.gz` files with every blob inside. They need no assembly to restore, so Pulpo also uploads one on the **Full archive copy** schedule (weekly by default, monthly, or off).

The server can read the live application data while it is running and while it builds a backup. The protection here is for the stored offsite file: the secrets available to Pulpo and B2 are not enough to decrypt it.

## Create the offline encryption identity

Install age on a trusted computer and create either a classic key:

```sh
age-keygen -o pulpo-backup-identity.txt
age-keygen -y pulpo-backup-identity.txt > pulpo-backup-recipient.txt
```

Or create a post-quantum hybrid key with age 1.3 or newer:

```sh
age-keygen -pq -o pulpo-backup-identity.txt
age-keygen -y pulpo-backup-identity.txt > pulpo-backup-recipient.txt
```

Keep multiple protected copies of `pulpo-backup-identity.txt`. Losing it makes every backup created for its recipient unrecoverable. Paste only the `age1…` or `age1pq1…` value from the recipient file into Pulpo. Never paste a value beginning with `AGE-SECRET-KEY`.

## Prepare Backblaze B2

1. Create a private bucket and enable Object Lock. Do not add a default bucket retention rule; Pulpo applies Compliance retention to each completed backup.
2. Create an application key restricted to that bucket and the prefix you will enter in Pulpo.
3. Grant only `listFiles`, `readFiles`, `writeFiles`, `deleteFiles`, `readBucketRetentions`, `readFileRetentions`, and `writeFileRetentions`. Do not grant bucket-management, `writeBucketRetentions`, or `bypassGovernance` capabilities. Pulpo uses `writeFileRetentions` to extend the lock on shared snapshot blobs.
4. Copy the bucket's S3 endpoint, application key ID, and application key. Pulpo accepts only official HTTPS endpoints in the form `https://s3.<region>.backblazeb2.com`.

Enabling Object Lock is an irreversible bucket change. Compliance-locked objects cannot be deleted or have their retention shortened, even with the application key, until their retention date passes.

## Configure Pulpo

Open **Admin → Settings → Database → Encrypted offsite backups**. Enter the B2 values and public age recipient, select a 6-, 12-, or 24-hour interval, a retention period, and how often to keep a full archive, then run **Test connection**.

Enable automatic backups and save. Pulpo queues the first backup immediately. The page shows the next run, latest health, retained objects, recipient fingerprint, and any terminal error. **Run now** creates an additional snapshot without enabling the schedule.

A scheduled run is a full archive when none was attempted within the **Full archive copy** interval, and a snapshot otherwise. A failed archive still counts, so a problem with archives never stops snapshots.

Changing the recipient or retention applies only to future backups. A new recipient makes the next snapshot upload every blob again, because earlier copies are encrypted to the old identity. Disabling or removing the Pulpo configuration does not delete locked Backblaze objects.

### How snapshots are stored and retained

Objects are stored under the configured prefix:

- `<prefix>/<year>/<month>/<time>-<id>.tar.gz.age` for full archives
- `<prefix>/<year>/<month>/<time>-<id>.snapshot.tar.gz.age` for snapshots
- `<prefix>/blobs/<random id>.age` for snapshot blobs

Blob names are random. File names, owners, and content hashes exist only in the encrypted snapshot manifest and in Pulpo's database. Anyone with bucket access can still see how many blobs there are, how large each one is, and when it was uploaded.

Each snapshot is locked for the configured retention. Each blob is locked for at least as long as every snapshot that references it. When a newer snapshot outlives a blob's lock, Pulpo extends the lock to that snapshot's expiry plus up to seven days, so locks are extended about once a week instead of on every run. A blob is deleted only after its lock expires, and therefore after every snapshot that used it has expired. Content deleted from Pulpo can remain in Backblaze for up to the retention period plus seven days.

Pulpo tracks offsite backups and blob copies in its own database. That history survives an in-place restore, so earlier snapshots still expire on schedule, but a replacement instance starts a new set. It does not delete objects created by the previous instance; remove them in Backblaze after their locks expire. Multipart uploads left unfinished by a crashed worker are aborted after a week, and objects from runs that failed after uploading are deleted once their retention expires.

Full backups include account credentials (including passkeys and connected provider credentials), chats and attachments, Files trees and binary files, collaborative document snapshots and pending edits, drafts and queued messages, billing and pool records, usage and analytics, memory, catalog configuration, and application settings. Temporary chat content and temporary unsent drafts are excluded. Active sessions, unfinished authentication exchanges, live budget reservations, and operational transfer jobs are not restored.

Backup creation writes database JSON one row at a time to private temporary disk, then streams that file into the compressed archive. Blobs are streamed into a private temporary file one at a time to verify their checksums and determine their tar entry sizes. Allow temporary disk space for the uncompressed database JSON, the compressed archive, and the largest source blob; offsite uploads also spool the encrypted archive. Snapshots upload up to four new blobs at once, each staged in plaintext and as ciphertext, and identify existing blobs by their recorded SHA-256 without reading them. Blobs with no recorded digest, such as avatars, are read on every snapshot. Temporary files are removed after success or failure. The worker still loads and filters the database snapshot in memory, so it needs enough RAM for those steps. Row serialization avoids Node's limit on the length of a single database-wide JSON string without changing the backup format.

Run `npm run test:backup-memory -w @pulpo/server` to verify database serialization, blob staging, archive creation, and streaming restore with over 512 MiB of database JSON, a 384 MiB blob, a 96 MiB JavaScript heap, and a 320 MiB peak-RSS budget. This checks the serialization/archive path, not database-query memory usage.

## Recover an instance

### From a snapshot

Install the Pulpo CLI on the trusted computer that holds the private identity (`npm install --global @isaacthoman/pulpo`). Download the `.snapshot.tar.gz.age` file from Pulpo or from the B2 bucket, then rebuild a self-contained archive from it:

```sh
B2_APPLICATION_KEY_ID=… B2_APPLICATION_KEY=… pulpo backup assemble \
  pulpo-snapshot.tar.gz.age \
  --identity pulpo-backup-identity.txt \
  --endpoint https://s3.us-west-004.backblazeb2.com \
  --bucket pulpo-backups \
  --output pulpo-instance.tar.gz
```

The command downloads, decrypts, and verifies every blob the snapshot references, then writes the archive locally. Nothing is sent anywhere else. A key restricted to `readFiles` on the bucket is enough. To work offline instead, download the bucket's `blobs/` folder with any tool and pass `--blobs-dir <folder>` in place of `--endpoint` and `--bucket`. Allow temporary disk space for the database JSON and four blobs, plus the finished archive.

Upload `pulpo-instance.tar.gz` as described below. Pulpo refuses a decrypted snapshot that has not been assembled.

### From a full archive

Download the `.tar.gz.age` file from Pulpo or directly from the B2 bucket. Decrypt it on the trusted computer that holds the private identity:

```sh
age --decrypt \
  -i pulpo-backup-identity.txt \
  -o pulpo-instance.tar.gz \
  pulpo-instance.tar.gz.age
```

Sign in to the replacement Pulpo instance as an administrator, open **Admin → Settings → Database**, and upload `pulpo-instance.tar.gz` under **Recover full application**. The restore endpoint intentionally refuses encrypted age files so the private identity never crosses into Pulpo.

The browser uploads backups up to 20 GiB in 16 MiB chunks, with two requests in flight. Each request remains below Cloudflare's 100 MB upload limit. Progress, transient-error retries, and **Pause upload** are available while uploading. Keep the page open; to resume after a refresh or browser restart, select the same file and enter `RESTORE` again. Pulpo verifies previously uploaded chunks before skipping them. **Discard upload** removes an unfinished transfer.

Upload state is stored in PostgreSQL and chunks in the configured local/S3 blob store, so API restarts do not discard progress. Inactive uploads expire after 24 hours and the maintenance sweep removes their chunks. Finished uploads remain available for status inspection for 24 hours before cleanup. No instance data is replaced until the complete archive has passed integrity checks. The worker then imports the database transactionally and invalidates existing sessions.

Restore during a maintenance window with other users and generation, billing, and document workers idle. Pulpo does not yet enforce a global write barrier around instance replacement. Responses and agent/tool executions that were active at backup time are restored as cancelled, preserving their prompts and partial output. Queued messages that were already dispatched are removed; interrupted dispatches with no restored response return to pending.

Older v1 archives remain readable, but archives created before the October 2026 backup coverage correction omitted Files, collaborative documents, passkeys, connected provider credentials, drafts, queues, pools, billing records, usage periods, and request analytics. Restoring one cannot recover the omitted data and replaces the current contents of those tables. Create and verify a fresh backup after updating.

Restore extraction uses the worker's temporary disk rather than buffering the archive in RAM. Allow disk space for the expanded archive and a second copy of its database JSON. Extraction is limited to 100 GiB, manifests and individual database rows to 64 MiB, and database nesting to 1,000 levels. Payload memory is bounded by individual rows/batches; the manifest and reference indexes remain in memory.

For development validation, `PULPO_RESTORE_TESTS=true` enables the restore integration suite against a migrated disposable database whose URL ends in `/pulpo_restore_test`. The tests replace that database's contents; never point them at a running instance.

`PULPO_BACKUP_SNAPSHOT_TESTS=true` enables `src/admin/backup-snapshot.postgres.test.ts` against a migrated disposable database named `/pulpo_backup_snapshot`. It verifies blob deduplication, lock extension, retention cleanup over time, interrupted uploads, the full-archive schedule, and restore from an archive assembled by the CLI. Setting `PULPO_BACKUP_S3_TEST_ENDPOINT`, `PULPO_BACKUP_S3_TEST_KEY_ID`, `PULPO_BACKUP_S3_TEST_KEY`, and optionally `PULPO_BACKUP_S3_TEST_BUCKET`, `_REGION`, and `_PREFIX` also runs `src/admin/b2-backup-store.s3.test.ts` and `src/admin/backup-snapshot-s3.postgres.test.ts` against a real S3 implementation with Compliance Object Lock. CI uses SeaweedFS; a B2 test bucket also works. The end-to-end test needs `npm run build -w @isaacthoman/pulpo` first, and its objects stay locked for one day.

`PULPO_BACKUP_AUDIT_TESTS=true` enables `src/admin/backup-roundtrip.postgres.test.ts` against a migrated disposable database named `/pulpo_backup_audit`. It verifies repeated restores of Files, Yjs updates, authentication, pools, billing, drafts and analytics, legacy defaults, interrupted jobs, source corruption, and encrypted scheduler recovery. The [October 2026 audit](./backup-audit-2026-10-06.md) records the validation and remaining limits.

Run `npm run test:restore-memory -w @pulpo/server` for a standalone archive/JSON streaming check with a 96 MiB JavaScript heap and a 320 MiB peak-RSS budget.

Keep the original Pulpo `ENCRYPTION_KEY` with your deployment recovery material when possible. Provider and storage credentials inside a full backup are encrypted with that deployment key and must otherwise be entered again after recovery.
