CREATE TABLE "restore_uploads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"original_name" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"fingerprint" text NOT NULL,
	"parts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'uploading' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "restore_uploads_expiry_idx" ON "restore_uploads" USING btree ("expires_at");