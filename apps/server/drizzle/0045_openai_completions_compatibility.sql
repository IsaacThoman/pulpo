DROP INDEX "responses_user_idempotency_unique";--> statement-breakpoint
ALTER TABLE "responses" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "responses" ADD COLUMN "incomplete_details" jsonb;--> statement-breakpoint
ALTER TABLE "responses" ADD COLUMN "idempotency_scope" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "responses" ADD COLUMN "idempotency_fingerprint" text;--> statement-breakpoint
UPDATE "responses" AS "response"
SET "idempotency_scope" = 'api:' || COALESCE("log"."api_key_id"::text, 'legacy') || ':responses'
FROM "request_logs" AS "log"
WHERE "log"."response_id" = "response"."id"
  AND "log"."origin" = 'api';--> statement-breakpoint
CREATE UNIQUE INDEX "responses_user_scope_idempotency_unique" ON "responses" USING btree ("user_id","idempotency_scope","idempotency_key");
