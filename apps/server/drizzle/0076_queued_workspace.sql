ALTER TABLE "queued_messages" ADD COLUMN "workspace" jsonb;--> statement-breakpoint
ALTER TABLE "queued_messages" ADD COLUMN "requester_session_id" uuid;--> statement-breakpoint
ALTER TABLE "queued_messages" ADD CONSTRAINT "queued_messages_requester_session_id_sessions_id_fk" FOREIGN KEY ("requester_session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;