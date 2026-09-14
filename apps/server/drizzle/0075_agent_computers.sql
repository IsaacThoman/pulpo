CREATE TABLE "agent_computer_pairings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"computer_id" uuid NOT NULL,
	"device_session_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_ip" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by_session_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_computer_pairings_status_check" CHECK ("agent_computer_pairings"."status" in ('pending', 'approved', 'denied', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "agent_computers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"owner_session_id" uuid,
	"name" text NOT NULL,
	"os" text NOT NULL,
	"arch" text DEFAULT '' NOT NULL,
	"app_version" text DEFAULT '' NOT NULL,
	"access_mode" text DEFAULT 'folder' NOT NULL,
	"root_path" text NOT NULL,
	"attachments_dir" text NOT NULL,
	"home_dir" text DEFAULT '' NOT NULL,
	"shell" text DEFAULT 'bash' NOT NULL,
	"approval_policy" text DEFAULT 'default' NOT NULL,
	"allow_remote" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_computers_os_check" CHECK ("agent_computers"."os" in ('macos', 'windows', 'linux')),
	CONSTRAINT "agent_computers_access_mode_check" CHECK ("agent_computers"."access_mode" in ('folder', 'full')),
	CONSTRAINT "agent_computers_approval_policy_check" CHECK ("agent_computers"."approval_policy" in ('default', 'bash-only', 'never'))
);
--> statement-breakpoint
CREATE TABLE "agent_tool_approvals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"response_id" uuid NOT NULL,
	"agent_run_id" uuid,
	"computer_id" uuid NOT NULL,
	"operation_id" text NOT NULL,
	"kind" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by_session_id" uuid,
	"decided_via" text,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_tool_approvals_kind_check" CHECK ("agent_tool_approvals"."kind" in ('bash', 'write', 'edit')),
	CONSTRAINT "agent_tool_approvals_status_check" CHECK ("agent_tool_approvals"."status" in ('pending', 'approved', 'denied', 'expired', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "workspace_leases" ALTER COLUMN "image_digest" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "workspace_computer_id" uuid;--> statement-breakpoint
ALTER TABLE "responses" ADD COLUMN "workspace_computer_id" uuid;--> statement-breakpoint
ALTER TABLE "workspace_leases" ADD COLUMN "kind" text DEFAULT 'sandbox' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_leases" ADD COLUMN "computer_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_computer_pairings" ADD CONSTRAINT "agent_computer_pairings_computer_id_agent_computers_id_fk" FOREIGN KEY ("computer_id") REFERENCES "public"."agent_computers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_computer_pairings" ADD CONSTRAINT "agent_computer_pairings_device_session_id_sessions_id_fk" FOREIGN KEY ("device_session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_computer_pairings" ADD CONSTRAINT "agent_computer_pairings_decided_by_session_id_sessions_id_fk" FOREIGN KEY ("decided_by_session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_computers" ADD CONSTRAINT "agent_computers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_computers" ADD CONSTRAINT "agent_computers_owner_session_id_sessions_id_fk" FOREIGN KEY ("owner_session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_approvals" ADD CONSTRAINT "agent_tool_approvals_response_id_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_approvals" ADD CONSTRAINT "agent_tool_approvals_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_approvals" ADD CONSTRAINT "agent_tool_approvals_computer_id_agent_computers_id_fk" FOREIGN KEY ("computer_id") REFERENCES "public"."agent_computers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tool_approvals" ADD CONSTRAINT "agent_tool_approvals_decided_by_session_id_sessions_id_fk" FOREIGN KEY ("decided_by_session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_computer_pairings_active_unique" ON "agent_computer_pairings" USING btree ("computer_id","device_session_id") WHERE "agent_computer_pairings"."status" in ('pending', 'approved');--> statement-breakpoint
CREATE INDEX "agent_computer_pairings_session_idx" ON "agent_computer_pairings" USING btree ("device_session_id");--> statement-breakpoint
CREATE INDEX "agent_computers_user_idx" ON "agent_computers" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_tool_approvals_operation_unique" ON "agent_tool_approvals" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "agent_tool_approvals_response_idx" ON "agent_tool_approvals" USING btree ("response_id");--> statement-breakpoint
CREATE INDEX "agent_tool_approvals_computer_status_idx" ON "agent_tool_approvals" USING btree ("computer_id","status");--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_workspace_computer_id_agent_computers_id_fk" FOREIGN KEY ("workspace_computer_id") REFERENCES "public"."agent_computers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_workspace_computer_id_agent_computers_id_fk" FOREIGN KEY ("workspace_computer_id") REFERENCES "public"."agent_computers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_leases" ADD CONSTRAINT "workspace_leases_computer_id_agent_computers_id_fk" FOREIGN KEY ("computer_id") REFERENCES "public"."agent_computers"("id") ON DELETE set null ON UPDATE no action;