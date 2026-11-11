-- Files permissions: what the agent may change per chat, whether it may browse all of the user's
-- Files there, and what the app that sent a message can do (so a reply never waits on a prompt
-- that app cannot show). Idempotent so databases that ran an earlier draft (numbered 0112) can
-- apply it again.
ALTER TABLE "chats" ADD COLUMN IF NOT EXISTS "file_change_mode" text DEFAULT 'suggest' NOT NULL;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN IF NOT EXISTS "files_browse_allowed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "queued_messages" ADD COLUMN IF NOT EXISTS "client_features" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "responses" ADD COLUMN IF NOT EXISTS "client_features" jsonb DEFAULT '[]'::jsonb NOT NULL;
