ALTER TABLE "generation_attempts" ADD COLUMN "upstream_model_id" text;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD COLUMN "source" text DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD COLUMN "purpose" text DEFAULT 'generation' NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD COLUMN "input_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD COLUMN "cached_input_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD COLUMN "output_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD COLUMN "reasoning_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD COLUMN "cost_micros" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE "generation_attempts" AS "call"
SET "upstream_model_id" = "model"."upstream_model_id",
    "source" = CASE WHEN "response"."agent_mode" THEN 'agent' ELSE "log"."origin" END
FROM "models" AS "model", "request_logs" AS "log", "responses" AS "response"
WHERE "call"."model_id" = "model"."id"
  AND "call"."request_log_id" = "log"."id"
  AND "log"."response_id" = "response"."id";
--> statement-breakpoint
UPDATE "generation_attempts" AS "call"
SET "input_tokens" = "log"."input_tokens",
    "cached_input_tokens" = "log"."cached_input_tokens",
    "output_tokens" = "log"."output_tokens",
    "reasoning_tokens" = "log"."reasoning_tokens",
    "cost_micros" = "log"."cost_micros"
FROM "request_logs" AS "log", "responses" AS "response"
WHERE "call"."request_log_id" = "log"."id"
  AND "log"."response_id" = "response"."id"
  AND NOT "response"."agent_mode"
  AND "call"."status" = 'completed';
--> statement-breakpoint
WITH "agent_billing" AS (
  SELECT "log"."id" AS "request_log_id", "billing"."ordinality"::integer AS "attempt", "billing"."value" AS "value"
  FROM "agent_runs" AS "run"
  JOIN "request_logs" AS "log" ON "log"."response_id" = "run"."response_id"
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE("run"."context"->'billingTurns', '[]'::jsonb)) WITH ORDINALITY AS "billing"("value", "ordinality")
)
UPDATE "generation_attempts" AS "call"
SET "input_tokens" = COALESCE(("billing"."value"->'usage'->>'inputTokens')::integer, 0),
    "cached_input_tokens" = COALESCE(("billing"."value"->'usage'->>'cachedInputTokens')::integer, 0),
    "output_tokens" = COALESCE(("billing"."value"->'usage'->>'outputTokens')::integer, 0),
    "reasoning_tokens" = COALESCE(("billing"."value"->'usage'->>'reasoningTokens')::integer, 0),
    "cost_micros" = COALESCE(("billing"."value"->>'costMicros')::bigint, 0)
FROM "agent_billing" AS "billing"
WHERE "call"."request_log_id" = "billing"."request_log_id"
  AND "call"."attempt" = "billing"."attempt"
  AND "call"."source" = 'agent';
