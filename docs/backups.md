# Encrypted Backblaze backups

Pulpo can automatically create full-instance backups, encrypt them with an offline [age](https://github.com/FiloSottile/age) identity, and upload the ciphertext to Backblaze B2. The private identity is never entered into Pulpo or Backblaze.

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
3. Grant only `listFiles`, `readFiles`, `writeFiles`, `deleteFiles`, `readBucketRetentions`, `readFileRetentions`, and `writeFileRetentions`. Do not grant bucket-management, `writeBucketRetentions`, or `bypassGovernance` capabilities.
4. Copy the bucket's S3 endpoint, application key ID, and application key. Pulpo accepts only official HTTPS endpoints in the form `https://s3.<region>.backblazeb2.com`.

Enabling Object Lock is an irreversible bucket change. Compliance-locked objects cannot be deleted or have their retention shortened, even with the application key, until their retention date passes.

## Configure Pulpo

Open **Admin → Settings → Database → Encrypted offsite backups**. Enter the B2 values and public age recipient, select a 6-, 12-, or 24-hour interval and retention period, and run **Test connection**.

Enable automatic backups and save. Pulpo queues the first backup immediately. The page shows the next run, latest health, retained objects, recipient fingerprint, and any terminal error. **Run now** creates an additional encrypted offsite backup without enabling the schedule.

Changing the recipient or retention applies only to future backups. Disabling or removing the Pulpo configuration does not delete locked Backblaze objects.

Full backups include account credentials (including passkeys and connected provider credentials), chats and attachments, Files trees and binary files, collaborative document snapshots and pending edits, drafts and queued messages, billing and pool records, usage and analytics, memory, catalog configuration, and application settings. Temporary chat content and temporary unsent drafts are excluded. Active sessions, unfinished authentication exchanges, live budget reservations, and operational transfer jobs are not restored.

Backup creation writes database JSON one row at a time to private temporary disk, then streams that file into the compressed archive. Blobs are streamed into a private temporary file one at a time to verify their checksums and determine their tar entry sizes. Allow temporary disk space for the uncompressed database JSON, the compressed archive, and the largest source blob; offsite uploads also spool the encrypted archive. Temporary files are removed after success or failure. The worker still loads and filters the database snapshot in memory, so it needs enough RAM for those steps. Row serialization avoids Node's limit on the length of a single database-wide JSON string without changing the backup format.

Run `npm run test:backup-memory -w @pulpo/server` to verify database serialization, blob staging, archive creation, and streaming restore with over 512 MiB of database JSON, a 384 MiB blob, a 96 MiB JavaScript heap, and a 320 MiB peak-RSS budget. This checks the serialization/archive path, not database-query memory usage.

## Recover an instance

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

`PULPO_BACKUP_AUDIT_TESTS=true` enables `src/admin/backup-roundtrip.postgres.test.ts` against a migrated disposable database named `/pulpo_backup_audit`. It verifies repeated restores of Files, Yjs updates, authentication, pools, billing, drafts and analytics, legacy defaults, interrupted jobs, source corruption, and encrypted scheduler recovery. The [October 2026 audit](./backup-audit-2026-10-06.md) records the validation and remaining limits.

Run `npm run test:restore-memory -w @pulpo/server` for a standalone archive/JSON streaming check with a 96 MiB JavaScript heap and a 320 MiB peak-RSS budget.

Keep the original Pulpo `ENCRYPTION_KEY` with your deployment recovery material when possible. Provider and storage credentials inside a full backup are encrypted with that deployment key and must otherwise be entered again after recovery.
