CREATE TABLE "file_folder_layouts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"folder_id" uuid,
	"snap_to_grid" boolean DEFAULT true NOT NULL,
	"positions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "file_folder_layouts" ADD CONSTRAINT "file_folder_layouts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_folder_layouts" ADD CONSTRAINT "file_folder_layouts_folder_id_file_nodes_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."file_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "file_folder_layouts_owner_folder_unique" ON "file_folder_layouts" USING btree ("owner_user_id",coalesce("folder_id", '00000000-0000-0000-0000-000000000000'::uuid));