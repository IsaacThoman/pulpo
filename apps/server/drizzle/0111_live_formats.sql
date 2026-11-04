-- Live formats: every document records its format (all existing documents are Markdown), and
-- documents get content-addressed binary parts stored beside their Yjs state.
CREATE TABLE "file_doc_assets" (
	"node_id" uuid NOT NULL,
	"hash" text NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_doc_assets_node_id_hash_pk" PRIMARY KEY("node_id","hash"),
	CONSTRAINT "file_doc_assets_hash_check" CHECK ("file_doc_assets"."hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "file_doc_assets_size_check" CHECK ("file_doc_assets"."size_bytes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "file_nodes" ADD COLUMN "format" text;--> statement-breakpoint
UPDATE "file_nodes" SET "format" = 'markdown' WHERE "kind" = 'doc';--> statement-breakpoint
ALTER TABLE "file_doc_assets" ADD CONSTRAINT "file_doc_assets_node_id_file_docs_node_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."file_docs"("node_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_doc_assets" ADD CONSTRAINT "file_doc_assets_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "file_doc_assets_object_key_unique" ON "file_doc_assets" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "file_doc_assets_owner_idx" ON "file_doc_assets" USING btree ("owner_user_id");--> statement-breakpoint
ALTER TABLE "file_nodes" ADD CONSTRAINT "file_nodes_format_check" CHECK (("file_nodes"."kind" = 'doc') = ("file_nodes"."format" is not null));