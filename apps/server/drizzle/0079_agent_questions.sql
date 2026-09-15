ALTER TYPE "public"."agent_run_status" ADD VALUE 'waiting_for_input' BEFORE 'completed';--> statement-breakpoint
CREATE TABLE "agent_questions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"response_id" uuid NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"tool_call_id" text NOT NULL,
	"item" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "active_duration_ms" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "workspace_cost_micros" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_questions" ADD CONSTRAINT "agent_questions_response_id_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_questions" ADD CONSTRAINT "agent_questions_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_questions_tool_unique" ON "agent_questions" USING btree ("tool_call_id");--> statement-breakpoint
CREATE INDEX "agent_questions_resume_idx" ON "agent_questions" USING btree ("resolved_at","consumed_at");