-- Requires a maintenance cutover; see docs/production-deployments.md.
-- Group conversions so PostgreSQL rewrites each table only once.
-- Serialize existing text as JSON strings; never parse payloads back into jsonb.
ALTER TABLE "responses"
  ALTER COLUMN "parameters" DROP DEFAULT,
  ALTER COLUMN "metadata" DROP DEFAULT,
  ALTER COLUMN "output" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "responses"
  ALTER COLUMN "input" TYPE text USING "input"::text,
  ALTER COLUMN "instructions" TYPE text USING to_json("instructions")::text,
  ALTER COLUMN "parameters" TYPE text USING "parameters"::text,
  ALTER COLUMN "metadata" TYPE text USING "metadata"::text,
  ALTER COLUMN "output" TYPE text USING "output"::text,
  ALTER COLUMN "error" TYPE text USING "error"::text,
  ALTER COLUMN "incomplete_details" TYPE text USING "incomplete_details"::text;
--> statement-breakpoint
ALTER TABLE "responses"
  ALTER COLUMN "parameters" SET DEFAULT '{}',
  ALTER COLUMN "metadata" SET DEFAULT '{}',
  ALTER COLUMN "output" SET DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE "response_items"
  ALTER COLUMN "payload" TYPE text USING "payload"::text;
--> statement-breakpoint
ALTER TABLE "response_content_parts"
  ALTER COLUMN "payload" TYPE text USING "payload"::text;
--> statement-breakpoint
ALTER TABLE "agent_runs"
  ALTER COLUMN "context" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "agent_runs"
  ALTER COLUMN "context" TYPE text USING "context"::text,
  ALTER COLUMN "error" TYPE text USING to_json("error")::text;
--> statement-breakpoint
ALTER TABLE "agent_runs"
  ALTER COLUMN "context" SET DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE "tool_executions"
  ALTER COLUMN "arguments" DROP DEFAULT,
  ALTER COLUMN "provider_attempts" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "tool_executions"
  ALTER COLUMN "arguments" TYPE text USING "arguments"::text,
  ALTER COLUMN "output" TYPE text USING to_json("output")::text,
  ALTER COLUMN "error" TYPE text USING to_json("error")::text,
  ALTER COLUMN "provider_attempts" TYPE text USING "provider_attempts"::text;
--> statement-breakpoint
ALTER TABLE "tool_executions"
  ALTER COLUMN "arguments" SET DEFAULT '{}',
  ALTER COLUMN "provider_attempts" SET DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE "request_logs"
  ALTER COLUMN "request_payload" TYPE text USING "request_payload"::text,
  ALTER COLUMN "response_payload" TYPE text USING "response_payload"::text,
  ALTER COLUMN "error_message" TYPE text USING to_json("error_message")::text;
--> statement-breakpoint
ALTER TABLE "generation_attempts"
  ALTER COLUMN "error_message" TYPE text USING to_json("error_message")::text;
--> statement-breakpoint
ALTER TABLE "ocr_attempts"
  ALTER COLUMN "request_payload" TYPE text USING "request_payload"::text,
  ALTER COLUMN "response_payload" TYPE text USING "response_payload"::text,
  ALTER COLUMN "error_message" TYPE text USING to_json("error_message")::text;
--> statement-breakpoint
ALTER TABLE "ocr_cache_entries"
  ALTER COLUMN "text" TYPE text USING to_json("text")::text;
