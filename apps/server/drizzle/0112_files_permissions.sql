ALTER TABLE "chats" ADD COLUMN "file_change_mode" text DEFAULT 'suggest' NOT NULL;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "files_browse_allowed" boolean DEFAULT false NOT NULL;