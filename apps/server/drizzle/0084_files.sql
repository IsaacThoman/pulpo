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
ALTER TABLE "file_nodes" ADD CONSTRAINT "file_nodes_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_nodes" ADD CONSTRAINT "file_nodes_parent_id_file_nodes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."file_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "file_nodes_live_name_unique" ON "file_nodes" USING btree ("owner_user_id",coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("name")) WHERE "file_nodes"."trashed_at" is null;--> statement-breakpoint
CREATE INDEX "file_nodes_owner_parent_idx" ON "file_nodes" USING btree ("owner_user_id","parent_id") WHERE "file_nodes"."trashed_at" is null;--> statement-breakpoint
CREATE INDEX "file_nodes_owner_trash_idx" ON "file_nodes" USING btree ("owner_user_id","trash_root_id") WHERE "file_nodes"."trashed_at" is not null;--> statement-breakpoint
CREATE INDEX "file_nodes_object_key_idx" ON "file_nodes" USING btree ("object_key");