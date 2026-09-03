-- This schema was briefly shipped as 0056 on the composer-sync branch before
-- dev acquired its own 0056 migration. Preview databases may therefore
-- already contain these objects even though the canonical journal now records
-- them as 0057. Keep this migration adoptive so those databases can advance.
CREATE TABLE IF NOT EXISTS "composer_draft_attachments" (
	"draft_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "composer_draft_attachments_draft_id_attachment_id_pk" PRIMARY KEY("draft_id","attachment_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "composer_drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"chat_id" uuid,
	"scope" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"model_id" text NOT NULL,
	"preset_selections" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"agent_mode" boolean DEFAULT false NOT NULL,
	"auto_expire" boolean,
	"editor_id" text NOT NULL,
	"revision" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "composer_drafts_scope_check" CHECK (("composer_drafts"."scope" = 'new' and "composer_drafts"."chat_id" is null) or ("composer_drafts"."chat_id" is not null and "composer_drafts"."scope" = "composer_drafts"."chat_id"::text)),
	CONSTRAINT "composer_drafts_content_length_check" CHECK (char_length("composer_drafts"."content") <= 1000000),
	CONSTRAINT "composer_drafts_revision_check" CHECK ("composer_drafts"."revision" > 0)
);
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'composer_draft_attachments_draft_id_composer_drafts_id_fk'
			AND conrelid = 'public.composer_draft_attachments'::regclass
	) THEN
		ALTER TABLE "composer_draft_attachments" ADD CONSTRAINT "composer_draft_attachments_draft_id_composer_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."composer_drafts"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'composer_draft_attachments_attachment_id_attachments_id_fk'
			AND conrelid = 'public.composer_draft_attachments'::regclass
	) THEN
		ALTER TABLE "composer_draft_attachments" ADD CONSTRAINT "composer_draft_attachments_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'composer_drafts_user_id_users_id_fk'
			AND conrelid = 'public.composer_drafts'::regclass
	) THEN
		ALTER TABLE "composer_drafts" ADD CONSTRAINT "composer_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'composer_drafts_chat_id_chats_id_fk'
			AND conrelid = 'public.composer_drafts'::regclass
	) THEN
		ALTER TABLE "composer_drafts" ADD CONSTRAINT "composer_drafts_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "composer_draft_attachments_position_unique" ON "composer_draft_attachments" USING btree ("draft_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "composer_drafts_user_scope_unique" ON "composer_drafts" USING btree ("user_id","scope");
