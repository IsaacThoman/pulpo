ALTER TABLE "file_nodes" ADD COLUMN "system_role" text;--> statement-breakpoint
ALTER TABLE "file_nodes" ADD COLUMN "target_node_id" uuid;--> statement-breakpoint
ALTER TABLE "file_nodes" ADD COLUMN "target_chat_id" uuid;--> statement-breakpoint
ALTER TABLE "file_nodes" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "file_nodes" DROP CONSTRAINT "file_nodes_kind_check";--> statement-breakpoint
ALTER TABLE "file_nodes" ADD CONSTRAINT "file_nodes_kind_check" CHECK ("file_nodes"."kind" in ('folder', 'doc', 'blob', 'shortcut'));--> statement-breakpoint
ALTER TABLE "file_nodes" ADD CONSTRAINT "file_nodes_shortcut_check" CHECK (num_nonnulls("file_nodes"."target_node_id", "file_nodes"."target_chat_id") = case when "file_nodes"."kind" = 'shortcut' then 1 else 0 end);--> statement-breakpoint
ALTER TABLE "file_nodes" ADD CONSTRAINT "file_nodes_system_role_check" CHECK ("file_nodes"."system_role" is null or ("file_nodes"."system_role" in ('chats', 'archive') and "file_nodes"."kind" = 'folder' and "file_nodes"."parent_id" is null));--> statement-breakpoint
ALTER TABLE "file_nodes" ADD CONSTRAINT "file_nodes_target_node_id_file_nodes_id_fk" FOREIGN KEY ("target_node_id") REFERENCES "public"."file_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Deferrable so a backup restore can insert Files before the chats shortcuts point at (see schema.ts).
ALTER TABLE "file_nodes" ADD CONSTRAINT "file_nodes_target_chat_id_chats_id_fk" FOREIGN KEY ("target_chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
CREATE UNIQUE INDEX "file_nodes_owner_system_role_unique" ON "file_nodes" USING btree ("owner_user_id","system_role") WHERE "file_nodes"."system_role" is not null;--> statement-breakpoint
CREATE INDEX "file_nodes_target_chat_idx" ON "file_nodes" USING btree ("target_chat_id") WHERE "file_nodes"."target_chat_id" is not null;--> statement-breakpoint
CREATE INDEX "file_nodes_target_node_idx" ON "file_nodes" USING btree ("target_node_id") WHERE "file_nodes"."target_node_id" is not null;--> statement-breakpoint
-- Chat folders become Files folders inside each account's Chats folder, keeping their ids so
-- chats stay filed.
DO $$
DECLARE
  legacy record;
  chats_folder uuid;
  base text;
  candidate text;
  attempt integer;
BEGIN
  FOR legacy IN SELECT * FROM "folders" ORDER BY "user_id", "sort_order", "created_at" LOOP
    SELECT "id" INTO chats_folder FROM "file_nodes"
      WHERE "owner_user_id" = legacy."user_id" AND "system_role" = 'chats';
    IF chats_folder IS NULL THEN
      -- A live top-level folder already named Chats becomes the Chats folder.
      UPDATE "file_nodes" SET "system_role" = 'chats'
        WHERE "id" = (
          SELECT "id" FROM "file_nodes"
          WHERE "owner_user_id" = legacy."user_id" AND "parent_id" IS NULL AND "trashed_at" IS NULL
            AND "kind" = 'folder' AND "status" = 'ready' AND lower("name") = 'chats'
          LIMIT 1
        )
        RETURNING "id" INTO chats_folder;
    END IF;
    IF chats_folder IS NULL THEN
      candidate := 'Chats';
      attempt := 1;
      WHILE EXISTS (
        SELECT 1 FROM "file_nodes" WHERE "owner_user_id" = legacy."user_id" AND "parent_id" IS NULL
          AND "trashed_at" IS NULL AND lower("name") = lower(candidate)
      ) LOOP
        attempt := attempt + 1;
        candidate := 'Chats (' || attempt || ')';
      END LOOP;
      chats_folder := gen_random_uuid();
      INSERT INTO "file_nodes" ("id", "owner_user_id", "parent_id", "kind", "name", "system_role")
        VALUES (chats_folder, legacy."user_id", NULL, 'folder', candidate, 'chats');
    END IF;

    -- Files names cannot contain "/" or control characters, and are at most 255 characters.
    base := btrim(left(regexp_replace(legacy."name", '[/[:cntrl:]]', '-', 'g'), 200));
    IF base = '' OR base = '.' OR base = '..' THEN base := 'Folder'; END IF;
    candidate := base;
    attempt := 1;
    WHILE EXISTS (
      SELECT 1 FROM "file_nodes" WHERE "owner_user_id" = legacy."user_id" AND "parent_id" = chats_folder
        AND "trashed_at" IS NULL AND lower("name") = lower(candidate)
    ) LOOP
      attempt := attempt + 1;
      candidate := base || ' (' || attempt || ')';
    END LOOP;
    -- Folders were listed above the unfiled chats, so they start above them, in their old order.
    INSERT INTO "file_nodes" ("id", "owner_user_id", "parent_id", "kind", "name", "sort_order", "created_at", "updated_at")
      VALUES (legacy."id", legacy."user_id", chats_folder, 'folder', candidate, legacy."sort_order" - 1000000, legacy."created_at", legacy."updated_at");
  END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "chats" DROP CONSTRAINT "chats_folder_id_folders_id_fk";--> statement-breakpoint
-- Defensive: a chat filed under another account's folder id would break the new constraint.
UPDATE "chats" SET "folder_id" = NULL
  WHERE "folder_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "file_nodes" WHERE "file_nodes"."id" = "chats"."folder_id" AND "file_nodes"."owner_user_id" = "chats"."user_id"
  );--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_folder_id_file_nodes_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."file_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chats_folder_idx" ON "chats" USING btree ("folder_id") WHERE "chats"."folder_id" is not null;--> statement-breakpoint
DROP TABLE "folders" CASCADE;
