CREATE TABLE "backup_blobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"storage_endpoint" text NOT NULL,
	"storage_bucket" text NOT NULL,
	"storage_prefix" text NOT NULL,
	"recipient_fingerprint" text NOT NULL,
	"content_checksum" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"object_key" text NOT NULL,
	"locked_until" timestamp with time zone NOT NULL,
	"uploaded_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "backup_jobs" ADD COLUMN "format" text DEFAULT 'archive' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "backup_blobs_live_content_idx" ON "backup_blobs" USING btree ("storage_endpoint","storage_bucket","storage_prefix","recipient_fingerprint","content_checksum") WHERE "backup_blobs"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "backup_blobs_object_key_idx" ON "backup_blobs" USING btree ("storage_endpoint","storage_bucket","object_key");--> statement-breakpoint
CREATE INDEX "backup_blobs_lock_idx" ON "backup_blobs" USING btree ("locked_until") WHERE "backup_blobs"."deleted_at" is null;