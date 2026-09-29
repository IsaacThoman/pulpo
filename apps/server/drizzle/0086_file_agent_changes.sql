CREATE TABLE "file_agent_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"response_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"before_markdown" text,
	"reverted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_agent_changes_kind_check" CHECK ("file_agent_changes"."kind" in ('edit', 'create'))
);
--> statement-breakpoint
ALTER TABLE "file_agent_changes" ADD CONSTRAINT "file_agent_changes_response_id_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_agent_changes" ADD CONSTRAINT "file_agent_changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_agent_changes" ADD CONSTRAINT "file_agent_changes_node_id_file_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."file_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "file_agent_changes_response_node_unique" ON "file_agent_changes" USING btree ("response_id","node_id");