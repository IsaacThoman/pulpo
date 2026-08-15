ALTER TABLE "attachments" ADD COLUMN "workspace_path" text;--> statement-breakpoint
UPDATE "attachments" AS "attachment"
SET "workspace_path" = "execution"."arguments"->>'path'
FROM "tool_executions" AS "execution"
INNER JOIN "agent_runs" AS "run" ON "run"."id" = "execution"."agent_run_id"
WHERE "attachment"."origin" = 'assistant'
  AND "attachment"."source_response_id" = "run"."response_id"
  AND "attachment"."source_tool_call_id" = "execution"."operation_id"
  AND jsonb_typeof("execution"."arguments"->'path') = 'string';
