CREATE TABLE "workspace_computers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"registration" jsonb NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_operations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"response_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"root_id" uuid NOT NULL,
	"operation_id" text NOT NULL,
	"generation" integer NOT NULL,
	"type" text NOT NULL,
	"arguments" jsonb NOT NULL,
	"hash" text NOT NULL,
	"result" jsonb,
	"last_seen_at" timestamp with time zone,
	"deadline" timestamp with time zone NOT NULL,
	"retired_at" timestamp with time zone,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "active_runtime_ms" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "composer_drafts" ADD COLUMN "workspace" jsonb;--> statement-breakpoint
ALTER TABLE "queued_messages" ADD COLUMN "workspace" jsonb;--> statement-breakpoint
ALTER TABLE "responses" ADD COLUMN "workspace" jsonb;--> statement-breakpoint
ALTER TABLE "responses" ADD COLUMN "workspace_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "responses" ADD COLUMN "workspace_wait" jsonb;--> statement-breakpoint
ALTER TABLE "workspace_computers" ADD CONSTRAINT "workspace_computers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_computers" ADD CONSTRAINT "workspace_computers_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_operations" ADD CONSTRAINT "workspace_operations_response_id_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_operations" ADD CONSTRAINT "workspace_operations_device_id_workspace_computers_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."workspace_computers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_computers_token_unique" ON "workspace_computers" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_operations_response_operation_unique" ON "workspace_operations" USING btree ("response_id","generation","operation_id");--> statement-breakpoint
CREATE INDEX "workspace_operations_device_idx" ON "workspace_operations" USING btree ("device_id");
--> statement-breakpoint
ALTER TABLE "workspace_computers" ADD COLUMN "connection_id" text;--> statement-breakpoint
ALTER TABLE "workspace_operations" ADD COLUMN "dispatched_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "workspace_computers" DROP CONSTRAINT "workspace_computers_session_id_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "workspace_computers" ALTER COLUMN "session_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_computers" ADD CONSTRAINT "workspace_computers_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;