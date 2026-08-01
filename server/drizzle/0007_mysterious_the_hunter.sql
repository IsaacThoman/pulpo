CREATE TYPE "public"."agent_run_status" AS ENUM('queued', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."tool_execution_status" AS ENUM('queued', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."workspace_lease_status" AS ENUM('provisioning', 'ready', 'expired', 'failed', 'released');--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"response_id" uuid NOT NULL,
	"workspace_lease_id" uuid,
	"status" "agent_run_status" DEFAULT 'queued' NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"model_turns" integer DEFAULT 0 NOT NULL,
	"tool_calls" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_executions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"workspace_lease_id" uuid,
	"operation_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"arguments" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "tool_execution_status" DEFAULT 'queued' NOT NULL,
	"output" text,
	"exit_code" integer,
	"error" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_leases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"chat_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"controller_lease_id" text,
	"status" "workspace_lease_status" DEFAULT 'provisioning' NOT NULL,
	"image_digest" text NOT NULL,
	"error" text,
	"claimed_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"hard_expires_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "agent_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "agent_instructions" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "responses" ADD COLUMN "agent_mode" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_response_id_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_workspace_lease_id_workspace_leases_id_fk" FOREIGN KEY ("workspace_lease_id") REFERENCES "public"."workspace_leases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_executions" ADD CONSTRAINT "tool_executions_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_executions" ADD CONSTRAINT "tool_executions_workspace_lease_id_workspace_leases_id_fk" FOREIGN KEY ("workspace_lease_id") REFERENCES "public"."workspace_leases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_leases" ADD CONSTRAINT "workspace_leases_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_leases" ADD CONSTRAINT "workspace_leases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_response_unique" ON "agent_runs" USING btree ("response_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_executions_operation_unique" ON "tool_executions" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "tool_executions_run_idx" ON "tool_executions" USING btree ("agent_run_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_leases_chat_active_unique" ON "workspace_leases" USING btree ("chat_id") WHERE "workspace_leases"."status" in ('provisioning', 'ready');--> statement-breakpoint
CREATE INDEX "workspace_leases_expiry_idx" ON "workspace_leases" USING btree ("expires_at");