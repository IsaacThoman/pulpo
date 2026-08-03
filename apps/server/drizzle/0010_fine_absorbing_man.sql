ALTER TABLE "generation_attempts" RENAME COLUMN "attempt" TO "retry_attempt";--> statement-breakpoint
ALTER TABLE "request_logs" RENAME COLUMN "current_attempt" TO "current_retry_attempt";--> statement-breakpoint
ALTER TABLE "generation_attempts" ALTER COLUMN "retry_attempt" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD COLUMN "turn_number" integer;--> statement-breakpoint
ALTER TABLE "request_logs" ADD COLUMN "current_turn_number" integer;--> statement-breakpoint
UPDATE "generation_attempts"
SET "turn_number" = "retry_attempt", "retry_attempt" = 1
WHERE "source" = 'agent';--> statement-breakpoint
UPDATE "request_logs"
SET "current_turn_number" = "current_retry_attempt", "current_retry_attempt" = 1
WHERE "origin" = 'agent' AND "current_retry_attempt" > 0;
