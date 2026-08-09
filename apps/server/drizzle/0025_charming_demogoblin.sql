ALTER TABLE "tool_executions" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "tool_executions" ADD COLUMN "provider_attempts" jsonb DEFAULT '[]'::jsonb NOT NULL;