ALTER TABLE "backup_jobs" ADD COLUMN "archive_size_bytes" bigint;--> statement-breakpoint
ALTER TABLE "backup_jobs" ADD COLUMN "archive_checksum" text;--> statement-breakpoint
CREATE INDEX "backup_jobs_expiry_idx" ON "backup_jobs" USING btree ("expires_at");