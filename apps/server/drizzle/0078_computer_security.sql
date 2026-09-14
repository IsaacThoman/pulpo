ALTER TABLE "agent_computers" ADD COLUMN "credential_hash" text;--> statement-breakpoint
ALTER TABLE "agent_tool_approvals" ADD COLUMN "action_digest" text;--> statement-breakpoint
ALTER TABLE "responses" ADD COLUMN "requester_session_id" uuid;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_requester_session_id_sessions_id_fk" FOREIGN KEY ("requester_session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;