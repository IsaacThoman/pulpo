-- Usage visibility: who may see a user's usage stats and requests on their profile. 'friends'
-- (accepted friends plus Pool members) preserves the existing friends/Pool leaderboard sharing.
-- Idempotent so databases that ran an earlier draft of it (numbered 0112) can apply it again.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "usage_visibility" text DEFAULT 'friends' NOT NULL;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_usage_visibility_check') THEN
		ALTER TABLE "users" ADD CONSTRAINT "users_usage_visibility_check" CHECK ("users"."usage_visibility" in ('pool', 'friends', 'public'));
	END IF;
END $$;
