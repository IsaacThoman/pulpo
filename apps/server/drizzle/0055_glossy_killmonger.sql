ALTER TABLE "backup_jobs" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "backup_jobs" ADD COLUMN "destination" text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE "backup_jobs" ADD COLUMN "trigger" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "backup_jobs" ADD COLUMN "storage_endpoint" text;--> statement-breakpoint
ALTER TABLE "backup_jobs" ADD COLUMN "storage_bucket" text;--> statement-breakpoint
ALTER TABLE "backup_jobs" ADD COLUMN "recipient_fingerprint" text;--> statement-breakpoint
ALTER TABLE "backup_jobs" ADD COLUMN "scheduled_for" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "backup_jobs" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "backup_jobs" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "backup_jobs" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "backup_jobs_lock_expiry_idx" ON "backup_jobs" USING btree ("locked_until");--> statement-breakpoint
CREATE UNIQUE INDEX "backup_jobs_scheduled_slot_idx" ON "backup_jobs" USING btree ("destination","trigger","scheduled_for");