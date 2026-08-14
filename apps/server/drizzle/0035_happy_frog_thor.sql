ALTER TABLE "chat_shares" ADD COLUMN "encrypted_token" text;--> statement-breakpoint
ALTER TABLE "chat_shares" ADD COLUMN "snapshot_version" integer;--> statement-breakpoint
ALTER TABLE "chat_shares" ADD COLUMN "snapshot" jsonb;--> statement-breakpoint
UPDATE "chat_shares" SET "revoked_at" = now() WHERE "revoked_at" IS NULL;
