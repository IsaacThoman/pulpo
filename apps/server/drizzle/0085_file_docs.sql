CREATE TABLE "file_doc_updates" (
	"seq" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "file_doc_updates_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"node_id" uuid NOT NULL,
	"update" "bytea" NOT NULL,
	"byte_size" integer NOT NULL,
	"origin" text NOT NULL,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_doc_updates_origin_check" CHECK ("file_doc_updates"."origin" in ('client', 'agent', 'import', 'restore'))
);
--> statement-breakpoint
CREATE TABLE "file_docs" (
	"node_id" uuid PRIMARY KEY NOT NULL,
	"state" "bytea" NOT NULL,
	"state_bytes" integer NOT NULL,
	"pending_updates" integer DEFAULT 0 NOT NULL,
	"markdown" text DEFAULT '' NOT NULL,
	"schema_version" integer NOT NULL,
	"last_edited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "file_doc_updates" ADD CONSTRAINT "file_doc_updates_node_id_file_docs_node_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."file_docs"("node_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_doc_updates" ADD CONSTRAINT "file_doc_updates_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_docs" ADD CONSTRAINT "file_docs_node_id_file_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."file_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_doc_updates_node_seq_idx" ON "file_doc_updates" USING btree ("node_id","seq");