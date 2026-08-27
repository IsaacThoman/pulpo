DROP INDEX IF EXISTS "responses_user_idempotency_unique";--> statement-breakpoint
ALTER TABLE "responses" ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "responses" ADD COLUMN IF NOT EXISTS "incomplete_details" jsonb;--> statement-breakpoint
ALTER TABLE "responses" ADD COLUMN IF NOT EXISTS "idempotency_scope" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "responses" ADD COLUMN IF NOT EXISTS "idempotency_fingerprint" text;--> statement-breakpoint
UPDATE "responses" AS "response"
SET "idempotency_scope" = 'api:' || COALESCE("log"."api_key_id"::text, 'legacy') || ':responses'
FROM "request_logs" AS "log"
WHERE "log"."response_id" = "response"."id"
  AND "log"."origin" = 'api';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "responses_user_scope_idempotency_unique" ON "responses" USING btree ("user_id","idempotency_scope","idempotency_key");
