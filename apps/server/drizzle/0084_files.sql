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
CREATE TABLE "file_nodes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"parent_id" uuid,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"mime_type" text,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"object_key" text,
	"checksum" text,
	"trashed_at" timestamp with time zone,
	"trash_root_id" uuid,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_nodes_kind_check" CHECK ("file_nodes"."kind" in ('folder', 'doc', 'blob')),
	CONSTRAINT "file_nodes_status_check" CHECK ("file_nodes"."status" in ('pending', 'ready')),
	CONSTRAINT "file_nodes_name_check" CHECK (char_length("file_nodes"."name") between 1 and 255),
	CONSTRAINT "file_nodes_size_check" CHECK ("file_nodes"."size_bytes" >= 0),
	CONSTRAINT "file_nodes_blob_check" CHECK (("file_nodes"."kind" = 'blob') = ("file_nodes"."object_key" is not null))
);
--> statement-breakpoint
ALTER TABLE "file_doc_updates" ADD CONSTRAINT "file_doc_updates_node_id_file_docs_node_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."file_docs"("node_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_doc_updates" ADD CONSTRAINT "file_doc_updates_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_docs" ADD CONSTRAINT "file_docs_node_id_file_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."file_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_nodes" ADD CONSTRAINT "file_nodes_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_nodes" ADD CONSTRAINT "file_nodes_parent_id_file_nodes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."file_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_doc_updates_node_seq_idx" ON "file_doc_updates" USING btree ("node_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "file_nodes_live_name_unique" ON "file_nodes" USING btree ("owner_user_id",coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("name")) WHERE "file_nodes"."trashed_at" is null;--> statement-breakpoint
CREATE INDEX "file_nodes_owner_parent_idx" ON "file_nodes" USING btree ("owner_user_id","parent_id") WHERE "file_nodes"."trashed_at" is null;--> statement-breakpoint
CREATE INDEX "file_nodes_owner_trash_idx" ON "file_nodes" USING btree ("owner_user_id","trash_root_id") WHERE "file_nodes"."trashed_at" is not null;--> statement-breakpoint
CREATE INDEX "file_nodes_object_key_idx" ON "file_nodes" USING btree ("object_key");