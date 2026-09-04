CREATE TYPE "public"."note_role" AS ENUM('owner', 'editor', 'viewer');--> statement-breakpoint
CREATE TABLE "note_memberships" (
	"note_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "note_role" NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "note_memberships_note_id_user_id_pk" PRIMARY KEY("note_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"document_state" "bytea" NOT NULL,
	"title" text DEFAULT 'Untitled note' NOT NULL,
	"body_text" text DEFAULT '' NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("body_text", ''))) STORED NOT NULL,
	"deleted_at" timestamp with time zone,
	"purge_started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Migration 0057 may have created composer draft tables before that feature was
-- reverted. Leave those legacy tables intact so this unrelated migration never
-- destroys draft data on upgraded installations.
ALTER TABLE "attachments" ADD COLUMN "note_id" uuid;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "uploaded_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "note_memberships" ADD CONSTRAINT "note_memberships_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_memberships" ADD CONSTRAINT "note_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "note_memberships_single_owner_idx" ON "note_memberships" USING btree ("note_id") WHERE "note_memberships"."role" = 'owner';--> statement-breakpoint
CREATE INDEX "note_memberships_user_idx" ON "note_memberships" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "note_memberships_note_idx" ON "note_memberships" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "notes_owner_updated_idx" ON "notes" USING btree ("owner_user_id","updated_at");--> statement-breakpoint
CREATE INDEX "notes_search_idx" ON "notes" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "notes_purge_idx" ON "notes" USING btree ("deleted_at","purge_started_at");--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_single_parent_check" CHECK (num_nonnulls("attachments"."chat_id", "attachments"."note_id") <= 1);
