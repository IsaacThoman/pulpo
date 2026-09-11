# File uploads

Web and mobile support up to 500 attachments per message, including synchronized composer drafts and shelved drafts. Uploads run three at a time per client, including reservation, transfer, confirmation, and bounded retries for server capacity errors.

In **Admin → Settings → Authentication**, configure:

- **Maximum attachment size**: defaults to 25 MiB; supports up to 1,000 MiB per file. A value of zero disables new attachments. User storage quotas still apply, including pending upload reservations.
- **Maximum images in a prompt**: defaults to five and accepts values from zero to 20. Image batches above this count require Agent mode. Batches above 25 MiB of combined image data also require Agent mode, regardless of count.

When the image count or byte budget is exceeded, no images from that batch are embedded in the initial Agent prompt. All attachments remain available as workspace files, with their names, sizes, types, and paths listed in the prompt. The Agent can inspect them with workspace tools. Non-image attachments also require Agent mode. This requires an enabled Agent-capable model and a working workspace controller.

## Resource use

Local uploads stream to a temporary file and atomically rename on success. S3 uploads go directly from the client to object storage through a signed URL. Confirmation streams the object to verify its size and checksum, retaining only a 16-byte MIME prefix. Workspace staging also streams files, one at a time. Before staging, the worker compares a bounded inventory against files already verified by the workspace daemon. Unchanged files are skipped; changed or deleted files are restored. A daemon restart safely causes one fresh staging pass. Rebuild and deploy the workspace image to enable this optimization; older images remain compatible through ordinary uploads.

Each API process admits at most 16 local uploads and eight confirmations concurrently. Thumbnail generation runs two jobs at a time, deduplicates concurrent requests, queues at most 64 unique jobs, and caches up to 32 MiB of generated previews. Queued work retains metadata only. Requests beyond capacity receive HTTP 503 with `Retry-After`; uploads and client previews retry up to four times with exponential backoff while retaining their queue slot. Attachment endpoints have separate rate limits so a 500-file batch does not exhaust the general API allowance.

Thumbnail generation spools the compressed source to temporary disk before Sharp decodes it, with the existing 40-million-pixel limit. Temporary files are removed on success or failure. Configure enough temporary disk space for two maximum-sized images, and retain container memory, CPU, and disk limits: streaming limits file buffering but does not eliminate image decoding costs or total resource consumption across processes.

Web attachment lists render pages of 20, with preview requests only near the viewport. Mobile virtualizes the composer strip and pages sent attachments in groups of 12. Both clients fetch at most two thumbnails at a time, avoiding original-image decoding for completed inline previews. The web thumbnail cache is limited to 16 MiB; mobile thumbnail files count toward the existing attachment disk-cache budget. Opening an individual attachment still loads its original.

Composer attachment changes synchronize at most once per 250 ms during uploads, with an explicit flush before submission. Pending local persistence saves coalesce to the latest state. The database writes only changed attachment positions; typing does not rewrite attachment-reference rows.

## Large-file deployment considerations

The current transfer uses one PUT per file. Interrupted transfers restart the file; uploads are not resumable. For production deployments, align reverse-proxy request-size limits, timeouts, and buffering with the configured file limit. Check S3 CORS and public endpoint reachability. Workspace storage must accommodate the conversation's attachments.

For unreliable connections and larger files, the next extension is resumable direct-to-S3 multipart uploads with per-part retries and cleanup of abandoned parts. AWS recommends multipart uploads from approximately 100 MB: [S3 multipart upload guidance](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html).

Validation includes a 500-job concurrency test, matching message/draft/shelf bounds, image threshold tests, attachment rate-limit/capacity tests, and a local 1,000 MiB streaming upload plus checksum inspection under a 64 MiB JavaScript heap limit. The local smoke check peaked at approximately 112 MiB RSS; this measures the storage path, not full production capacity or a live S3 upload.

The repeatable two-user API, Socket.IO, thumbnail, and database smoke runner is `apps/server/scripts/bulk-attachments-smoke.ts`. It refuses non-loopback APIs and any database except `pulpo_bulk_qa`. Use a disposable local database with migrations applied, a `bulk@example.test` account with password `Bulk-upload-qa-2026`, and a `bulk-qa` model. It creates test users and chats and temporarily installs an attachment-reference audit trigger. See [local validation](qa/bulk-attachments.md) for measured results and coverage limits.

Bulk mobile image galleries use the existing virtualized viewer and resolve only mounted pages; original downloads are limited to two at a time. Web queued-message summaries show the first three names and a remaining count. Confirmed files recover their original reservation after a stale browser checkpoint, and completed draft records no longer repeatedly persist original file blobs.
