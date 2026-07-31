DROP TABLE "message_feedback" CASCADE;--> statement-breakpoint
ALTER TABLE "responses" ADD COLUMN "branch_reason" text DEFAULT 'message' NOT NULL;