DROP TABLE "file_agent_changes" CASCADE;--> statement-breakpoint
CREATE TABLE "file_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "file_changes_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"chat_id" uuid NOT NULL,
	"response_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_changes_mode_check" CHECK ("file_changes"."mode" in ('write', 'suggest')),
	CONSTRAINT "file_changes_kind_check" CHECK ("file_changes"."kind" in ('create', 'update', 'move', 'trash')),
	CONSTRAINT "file_changes_status_check" CHECK ("file_changes"."status" in ('applied', 'undone', 'pending', 'accepted', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "file_versions" (
	"object_key" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"size_bytes" bigint NOT NULL,
	"mime_type" text,
	"checksum" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_versions_size_check" CHECK ("file_versions"."size_bytes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "file_scope_access" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "file_nodes" ADD COLUMN "suggestion_change_id" uuid;--> statement-breakpoint
ALTER TABLE "file_changes" ADD CONSTRAINT "file_changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_changes" ADD CONSTRAINT "file_changes_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_changes" ADD CONSTRAINT "file_changes_response_id_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_changes" ADD CONSTRAINT "file_changes_node_id_file_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."file_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_node_id_file_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."file_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "file_changes_response_node_kind_unique" ON "file_changes" USING btree ("response_id","node_id","kind");--> statement-breakpoint
CREATE INDEX "file_changes_user_created_idx" ON "file_changes" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "file_changes_node_idx" ON "file_changes" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "file_changes_chat_pending_idx" ON "file_changes" USING btree ("chat_id") WHERE "file_changes"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "file_versions_user_idx" ON "file_versions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "file_versions_node_idx" ON "file_versions" USING btree ("node_id");