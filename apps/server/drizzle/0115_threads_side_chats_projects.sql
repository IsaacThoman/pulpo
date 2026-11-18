-- Idempotent so databases that ran an earlier draft of this migration can replay it.
CREATE TABLE IF NOT EXISTS "file_projects" (
	"folder_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"memory" text DEFAULT '' NOT NULL,
	"memory_revision" integer DEFAULT 0 NOT NULL,
	"thread_model_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_projects_instructions_length_check" CHECK (char_length("file_projects"."instructions") <= 16000),
	CONSTRAINT "file_projects_memory_length_check" CHECK (char_length("file_projects"."memory") <= 16000)
);
--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'chat' NOT NULL;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN IF NOT EXISTS "origin_chat_id" uuid;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN IF NOT EXISTS "origin_response_id" uuid;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN IF NOT EXISTS "thread_report_response_id" uuid;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN IF NOT EXISTS "thread_resolved_at" timestamp with time zone;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'file_projects_folder_id_file_nodes_id_fk') THEN
		ALTER TABLE "file_projects" ADD CONSTRAINT "file_projects_folder_id_file_nodes_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."file_nodes"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'file_projects_user_id_users_id_fk') THEN
		ALTER TABLE "file_projects" ADD CONSTRAINT "file_projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'file_projects_thread_model_id_models_id_fk') THEN
		ALTER TABLE "file_projects" ADD CONSTRAINT "file_projects_thread_model_id_models_id_fk" FOREIGN KEY ("thread_model_id") REFERENCES "public"."models"("id") ON DELETE set null ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chats_kind_check') THEN
		ALTER TABLE "chats" ADD CONSTRAINT "chats_kind_check" CHECK ("chats"."kind" in ('chat', 'side', 'thread'));
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chats_kind_origin_check') THEN
		ALTER TABLE "chats" ADD CONSTRAINT "chats_kind_origin_check" CHECK ("chats"."kind" = 'chat' or "chats"."origin_chat_id" is not null);
	END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_projects_user_idx" ON "file_projects" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chats_origin_idx" ON "chats" USING btree ("origin_chat_id") WHERE "chats"."origin_chat_id" is not null;
