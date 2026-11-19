-- "This computer": what a desktop app lent the agent for a reply (a session, an access mode and a
-- folder), on the reply and on a queued message that will become one. Idempotent so a database
-- that ran an earlier draft can apply it again.
ALTER TABLE "queued_messages" ADD COLUMN IF NOT EXISTS "computer" jsonb;--> statement-breakpoint
ALTER TABLE "responses" ADD COLUMN IF NOT EXISTS "computer" jsonb;
