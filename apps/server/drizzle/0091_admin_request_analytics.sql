CREATE TABLE "analytics_hourly_rollups" (
	"hour" timestamp with time zone NOT NULL,
	"model_id" text NOT NULL,
	"client_platform" text NOT NULL,
	"origin" text NOT NULL,
	"plan" text NOT NULL,
	"agent_mode" boolean NOT NULL,
	"requests" integer NOT NULL,
	"failures" integer NOT NULL,
	"input_tokens" bigint NOT NULL,
	"output_tokens" bigint NOT NULL,
	"cost_micros" bigint NOT NULL,
	CONSTRAINT "analytics_hourly_rollups_pk" PRIMARY KEY("hour","model_id","client_platform","origin","plan","agent_mode")
);
--> statement-breakpoint
CREATE TABLE "request_analytics" (
	"id" uuid PRIMARY KEY NOT NULL,
	"response_id" uuid,
	"user_id" uuid NOT NULL,
	"api_key_id" uuid,
	"pool_id" uuid,
	"requested_model_id" text NOT NULL,
	"answered_model_id" text,
	"plan" text,
	"origin" text NOT NULL,
	"client_platform" text DEFAULT 'unknown' NOT NULL,
	"client_version" text,
	"preset_selections" jsonb,
	"reasoning_effort" text,
	"verbosity" text,
	"temperature" double precision,
	"max_output_tokens" integer,
	"instruction_preset_ids" jsonb,
	"custom_instructions" boolean,
	"memory_enabled" boolean,
	"agent_mode" boolean DEFAULT false NOT NULL,
	"branch_reason" text,
	"attachment_count" integer,
	"attachment_kinds" jsonb,
	"used_dictation" boolean,
	"input_chars" integer,
	"status" text DEFAULT 'queued' NOT NULL,
	"error_category" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"fallback_used" boolean DEFAULT false NOT NULL,
	"first_token_ms" integer,
	"duration_ms" integer,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"tool_calls" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "request_analytics_tools" (
	"analytics_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"calls" integer NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "request_analytics_tools_analytics_id_tool_name_pk" PRIMARY KEY("analytics_id","tool_name")
);
--> statement-breakpoint
ALTER TABLE "queued_messages" ADD COLUMN "client_platform" text;--> statement-breakpoint
ALTER TABLE "queued_messages" ADD COLUMN "client_version" text;--> statement-breakpoint
ALTER TABLE "queued_messages" ADD COLUMN "used_dictation" boolean;--> statement-breakpoint
ALTER TABLE "request_analytics" ADD CONSTRAINT "request_analytics_response_id_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."responses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_analytics" ADD CONSTRAINT "request_analytics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_analytics" ADD CONSTRAINT "request_analytics_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_analytics" ADD CONSTRAINT "request_analytics_pool_id_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."pools"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_analytics_tools" ADD CONSTRAINT "request_analytics_tools_analytics_id_request_analytics_id_fk" FOREIGN KEY ("analytics_id") REFERENCES "public"."request_analytics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "request_analytics_response_unique" ON "request_analytics" USING btree ("response_id");--> statement-breakpoint
CREATE INDEX "request_analytics_created_idx" ON "request_analytics" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "request_analytics_user_created_idx" ON "request_analytics" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "request_analytics_pending_idx" ON "request_analytics" USING btree ("created_at") WHERE "request_analytics"."finalized_at" is null;--> statement-breakpoint
CREATE INDEX "request_analytics_tools_created_idx" ON "request_analytics_tools" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "generation_attempts_started_idx" ON "generation_attempts" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "request_logs_user_created_idx" ON "request_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "request_logs_api_key_idx" ON "request_logs" USING btree ("api_key_id") WHERE "request_logs"."api_key_id" is not null;--> statement-breakpoint
CREATE INDEX "usage_created_idx" ON "usage_events" USING btree ("created_at");--> statement-breakpoint
-- Backfill analytics from responses that still have request logs. Client
-- platform, dictation, plan, and personalization were never recorded, so they
-- stay null/unknown for this history.
INSERT INTO "request_analytics" (
  "id", "response_id", "user_id", "api_key_id", "pool_id", "requested_model_id", "answered_model_id",
  "origin", "client_platform", "preset_selections", "reasoning_effort", "verbosity", "temperature",
  "max_output_tokens", "agent_mode", "branch_reason", "status", "error_category", "retry_count",
  "fallback_used", "first_token_ms", "duration_ms", "input_tokens", "cached_input_tokens",
  "output_tokens", "reasoning_tokens", "cost_micros", "tool_calls", "created_at", "finalized_at"
)
SELECT
  gen_random_uuid(), "response"."id", "response"."user_id", "log"."api_key_id", "reservation"."pool_id",
  "log"."requested_model_id", coalesce("response"."actual_model_id", "log"."actual_model_id", "response"."model_id"),
  "response"."origin", CASE WHEN "response"."origin" = 'api' THEN 'api' ELSE 'unknown' END,
  "response"."preset_selections",
  coalesce("params"."value"->'reasoning'->>'effort', "model"."default_parameters"->'reasoning'->>'effort'),
  coalesce("params"."value"->'text'->>'verbosity', "model"."default_parameters"->'text'->>'verbosity'),
  CASE WHEN jsonb_typeof("params"."value"->'temperature') = 'number' THEN ("params"."value"->>'temperature')::double precision END,
  CASE WHEN jsonb_typeof("params"."value"->'max_output_tokens') = 'number' THEN least(("params"."value"->>'max_output_tokens')::numeric, 2147483647)::integer END,
  "response"."agent_mode", "response"."branch_reason", "response"."status"::text, "log"."error_category",
  "log"."retry_count", "log"."fallback_used",
  CASE WHEN "response"."first_reply_text_at" IS NOT NULL AND "response"."request_received_at" IS NOT NULL
    THEN greatest(0, least(2147483647, (extract(epoch FROM "response"."first_reply_text_at" - "response"."request_received_at") * 1000)))::integer END,
  "log"."duration_ms",
  coalesce("usage"."input_tokens", "log"."input_tokens"), coalesce("usage"."cached_input_tokens", "log"."cached_input_tokens"),
  coalesce("usage"."output_tokens", "log"."output_tokens"), coalesce("usage"."reasoning_tokens", "log"."reasoning_tokens"),
  coalesce("usage"."cost_micros", "log"."cost_micros"), coalesce("run"."tool_calls", 0),
  "log"."created_at",
  CASE WHEN "response"."status" IN ('completed', 'failed', 'cancelled', 'incomplete') THEN now() END
FROM "responses" AS "response"
JOIN "request_logs" AS "log" ON "log"."response_id" = "response"."id"
LEFT JOIN "usage_events" AS "usage" ON "usage"."response_id" = "response"."id"
LEFT JOIN "budget_reservations" AS "reservation" ON "reservation"."response_id" = "response"."id"
LEFT JOIN "agent_runs" AS "run" ON "run"."response_id" = "response"."id"
LEFT JOIN "models" AS "model" ON "model"."id" = "response"."model_id"
LEFT JOIN LATERAL (
  SELECT CASE WHEN pg_input_is_valid("response"."parameters", 'jsonb') THEN "response"."parameters"::jsonb ELSE '{}'::jsonb END AS "value"
) AS "params" ON true;--> statement-breakpoint
INSERT INTO "request_analytics_tools" ("analytics_id", "tool_name", "calls", "failures", "cost_micros", "created_at")
SELECT "analytics"."id", "tool"."tool_name", count(*)::integer,
  (count(*) FILTER (WHERE "tool"."status" = 'failed'))::integer,
  coalesce(sum("tool"."billed_cost_micros"), 0), "analytics"."created_at"
FROM "request_analytics" AS "analytics"
JOIN "agent_runs" AS "run" ON "run"."response_id" = "analytics"."response_id"
JOIN "tool_executions" AS "tool" ON "tool"."agent_run_id" = "run"."id"
GROUP BY "analytics"."id", "tool"."tool_name", "analytics"."created_at";--> statement-breakpoint
-- Purged chats only left their billing ledger rows behind.
INSERT INTO "request_analytics" (
  "id", "user_id", "api_key_id", "requested_model_id", "answered_model_id", "origin", "client_platform",
  "status", "duration_ms", "input_tokens", "cached_input_tokens", "output_tokens", "reasoning_tokens",
  "cost_micros", "created_at", "finalized_at"
)
SELECT
  gen_random_uuid(), "usage"."user_id", "usage"."api_key_id", "usage"."requested_model_id", "usage"."model_id",
  CASE WHEN "usage"."api_key_id" IS NOT NULL THEN 'api' ELSE 'web' END,
  CASE WHEN "usage"."api_key_id" IS NOT NULL THEN 'api' ELSE 'unknown' END,
  'completed', "usage"."latency_ms", "usage"."input_tokens", "usage"."cached_input_tokens",
  "usage"."output_tokens", "usage"."reasoning_tokens", "usage"."cost_micros", "usage"."created_at", "usage"."created_at"
FROM "usage_events" AS "usage"
WHERE "usage"."response_id" IS NULL;
