CREATE TABLE "data_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#6366f1' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"deletion_requested_at" timestamp with time zone,
	"deletion_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO data_profiles (id, user_id, name, is_default) SELECT id, id, 'Personal', true FROM users;
--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "profile_id" uuid;
--> statement-breakpoint
UPDATE "attachments" SET profile_id = user_id;
--> statement-breakpoint
ALTER TABLE "attachments" ALTER COLUMN profile_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "chat_import_sources" ADD COLUMN "profile_id" uuid;
--> statement-breakpoint
UPDATE "chat_import_sources" SET profile_id = user_id;
--> statement-breakpoint
ALTER TABLE "chat_import_sources" ALTER COLUMN profile_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "chat_shares" ADD COLUMN "profile_id" uuid;
--> statement-breakpoint
UPDATE "chat_shares" SET profile_id = user_id;
--> statement-breakpoint
ALTER TABLE "chat_shares" ALTER COLUMN profile_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "chat_turn_embeddings" ADD COLUMN "profile_id" uuid;
--> statement-breakpoint
UPDATE "chat_turn_embeddings" SET profile_id = user_id;
--> statement-breakpoint
ALTER TABLE "chat_turn_embeddings" ALTER COLUMN profile_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "profile_id" uuid;
--> statement-breakpoint
UPDATE "chats" SET profile_id = user_id;
--> statement-breakpoint
ALTER TABLE "chats" ALTER COLUMN profile_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "composer_drafts" ADD COLUMN "profile_id" uuid;
--> statement-breakpoint
UPDATE "composer_drafts" SET profile_id = user_id;
--> statement-breakpoint
ALTER TABLE "composer_drafts" ALTER COLUMN profile_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "folders" ADD COLUMN "profile_id" uuid;
--> statement-breakpoint
UPDATE "folders" SET profile_id = user_id;
--> statement-breakpoint
ALTER TABLE "folders" ALTER COLUMN profile_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD COLUMN "profile_id" uuid;
--> statement-breakpoint
UPDATE "idempotency_records" SET profile_id = user_id;
--> statement-breakpoint
ALTER TABLE "idempotency_records" ALTER COLUMN profile_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "queued_messages" ADD COLUMN "profile_id" uuid;
--> statement-breakpoint
UPDATE "queued_messages" SET profile_id = user_id;
--> statement-breakpoint
ALTER TABLE "queued_messages" ALTER COLUMN profile_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "responses" ADD COLUMN "profile_id" uuid;
--> statement-breakpoint
UPDATE "responses" SET profile_id = user_id;
--> statement-breakpoint
ALTER TABLE "responses" ALTER COLUMN profile_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "shelf_operations" ADD COLUMN "profile_id" uuid;
--> statement-breakpoint
UPDATE "shelf_operations" SET profile_id = user_id;
--> statement-breakpoint
ALTER TABLE "shelf_operations" ALTER COLUMN profile_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "shelved_drafts" ADD COLUMN "profile_id" uuid;
--> statement-breakpoint
UPDATE "shelved_drafts" SET profile_id = user_id;
--> statement-breakpoint
ALTER TABLE "shelved_drafts" ALTER COLUMN profile_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_memory_document_revisions" ADD COLUMN "profile_id" uuid;
--> statement-breakpoint
UPDATE "user_memory_document_revisions" SET profile_id = user_id;
--> statement-breakpoint
ALTER TABLE "user_memory_document_revisions" ALTER COLUMN profile_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_memory_documents" ADD COLUMN "profile_id" uuid;
--> statement-breakpoint
UPDATE "user_memory_documents" SET profile_id = user_id;
--> statement-breakpoint
ALTER TABLE "user_memory_documents" ALTER COLUMN profile_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "profile_id" uuid;
--> statement-breakpoint
UPDATE "user_preferences" SET profile_id = user_id;
--> statement-breakpoint
ALTER TABLE "user_preferences" ALTER COLUMN profile_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "workspace_leases" ADD COLUMN "profile_id" uuid;
--> statement-breakpoint
UPDATE "workspace_leases" SET profile_id = user_id;
--> statement-breakpoint
ALTER TABLE "workspace_leases" ALTER COLUMN profile_id SET NOT NULL;
--> statement-breakpoint
DROP INDEX "composer_drafts_user_scope_unique";
--> statement-breakpoint
DROP INDEX "responses_user_scope_idempotency_unique";
--> statement-breakpoint
DROP INDEX "user_memory_document_revisions_user_revision_unique";
--> statement-breakpoint
ALTER TABLE "chat_import_sources" DROP CONSTRAINT "chat_import_sources_user_id_source_source_chat_id_pk";
--> statement-breakpoint
ALTER TABLE "idempotency_records" DROP CONSTRAINT "idempotency_records_user_id_key_operation_pk";
--> statement-breakpoint
ALTER TABLE "shelf_operations" DROP CONSTRAINT "shelf_operations_user_id_operation_id_pk";
--> statement-breakpoint
ALTER TABLE "user_memory_documents" DROP CONSTRAINT "user_memory_documents_pkey";
--> statement-breakpoint
ALTER TABLE "user_preferences" DROP CONSTRAINT "user_preferences_pkey";
--> statement-breakpoint
ALTER TABLE "chat_import_sources" ADD CONSTRAINT "chat_import_sources_user_id_profile_id_source_source_chat_id_pk" PRIMARY KEY("user_id","profile_id","source","source_chat_id");
--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_user_id_profile_id_key_operation_pk" PRIMARY KEY("user_id","profile_id","key","operation");
--> statement-breakpoint
ALTER TABLE "shelf_operations" ADD CONSTRAINT "shelf_operations_user_id_profile_id_operation_id_pk" PRIMARY KEY("user_id","profile_id","operation_id");
--> statement-breakpoint
ALTER TABLE "user_memory_documents" ADD CONSTRAINT "user_memory_documents_user_id_profile_id_pk" PRIMARY KEY("user_id","profile_id");
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_profile_id_pk" PRIMARY KEY("user_id","profile_id");
--> statement-breakpoint
ALTER TABLE "data_profiles" ADD CONSTRAINT "data_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "data_profiles_default_unique" ON "data_profiles" USING btree ("user_id") WHERE "data_profiles"."is_default" = true;
--> statement-breakpoint
CREATE UNIQUE INDEX "data_profiles_owner_unique" ON "data_profiles" USING btree ("user_id","id");
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_profile_id_data_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."data_profiles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "chat_import_sources" ADD CONSTRAINT "chat_import_sources_profile_id_data_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."data_profiles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "chat_shares" ADD CONSTRAINT "chat_shares_profile_id_data_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."data_profiles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "chat_turn_embeddings" ADD CONSTRAINT "chat_turn_embeddings_profile_id_data_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."data_profiles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_profile_id_data_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."data_profiles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "composer_drafts" ADD CONSTRAINT "composer_drafts_profile_id_data_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."data_profiles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_profile_id_data_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."data_profiles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_profile_id_data_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."data_profiles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "queued_messages" ADD CONSTRAINT "queued_messages_profile_id_data_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."data_profiles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_profile_id_data_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."data_profiles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "shelf_operations" ADD CONSTRAINT "shelf_operations_profile_id_data_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."data_profiles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "shelved_drafts" ADD CONSTRAINT "shelved_drafts_profile_id_data_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."data_profiles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_memory_document_revisions" ADD CONSTRAINT "user_memory_document_revisions_profile_id_data_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."data_profiles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_memory_documents" ADD CONSTRAINT "user_memory_documents_profile_id_data_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."data_profiles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_profile_id_data_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."data_profiles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_leases" ADD CONSTRAINT "workspace_leases_profile_id_data_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."data_profiles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "composer_drafts_user_scope_unique" ON "composer_drafts" USING btree ("user_id","profile_id","scope");
--> statement-breakpoint
CREATE UNIQUE INDEX "responses_user_scope_idempotency_unique" ON "responses" USING btree ("user_id","profile_id","idempotency_scope","idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "user_memory_document_revisions_user_revision_unique" ON "user_memory_document_revisions" USING btree ("user_id","profile_id","revision");
--> statement-breakpoint
-- New accounts receive their initial profile in the same transaction.
CREATE FUNCTION pulpo_create_personal_profile() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('pulpo.restoring_profiles', true) IS DISTINCT FROM 'true' THEN
    INSERT INTO data_profiles(id, user_id, name, is_default) VALUES (NEW.id, NEW.id, 'Personal', true);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER users_create_personal_profile AFTER INSERT ON users FOR EACH ROW EXECUTE FUNCTION pulpo_create_personal_profile();
--> statement-breakpoint
-- A single ownership guard also protects worker inserts and legacy callers.
CREATE FUNCTION pulpo_assign_data_profile() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_profile uuid; owner_id uuid; retiring timestamptz; ref_id uuid; parent_table text;
BEGIN
  IF TG_OP = 'UPDATE' AND NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id) THEN RETURN NEW; END IF;
  -- A child always belongs to its parent's profile, even outside HTTP context.
  IF (to_jsonb(NEW)->>'chat_id') IS NOT NULL THEN
    SELECT profile_id INTO parent_profile FROM chats WHERE id = (to_jsonb(NEW)->>'chat_id')::uuid;
  END IF;
  IF NEW.profile_id IS NULL THEN
    NEW.profile_id := parent_profile;
    IF NEW.profile_id IS NULL THEN
      SELECT id INTO NEW.profile_id FROM data_profiles WHERE user_id = NEW.user_id AND is_default;
    END IF;
  END IF;
  SELECT user_id, deletion_requested_at INTO owner_id, retiring FROM data_profiles WHERE id = NEW.profile_id FOR SHARE;
  IF owner_id IS NULL OR owner_id <> NEW.user_id OR (retiring IS NOT NULL AND TG_OP = 'INSERT' AND current_setting('pulpo.restoring_profiles', true) IS DISTINCT FROM 'true') THEN
    RAISE EXCEPTION 'Invalid profile ownership' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.profile_id <> OLD.profile_id OR NEW.user_id <> OLD.user_id) THEN
    RAISE EXCEPTION 'Profile transfers are not supported' USING ERRCODE = '23514';
  END IF;
  IF parent_profile IS NOT NULL AND parent_profile <> NEW.profile_id THEN
    RAISE EXCEPTION 'Cross-profile chat reference' USING ERRCODE = '23514';
  END IF;
  -- Validate other direct resource references without changing existing FK behavior.
  FOR parent_table, ref_id IN SELECT v.t, nullif(to_jsonb(NEW)->>v.c, '')::uuid FROM (VALUES
    ('folders', 'folder_id'), ('responses', 'source_response_id'), ('responses', 'parent_response_id'),
    ('responses', 'previous_response_id'), ('responses', 'active_response_id'), ('responses', 'active_branch_leaf_id')
  ) AS v(t,c) LOOP
    IF ref_id IS NOT NULL THEN
      EXECUTE format('select profile_id from %I where id = $1', parent_table) INTO parent_profile USING ref_id;
      IF parent_profile IS NOT NULL AND parent_profile <> NEW.profile_id THEN
        RAISE EXCEPTION 'Cross-profile resource reference' USING ERRCODE = '23514';
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER attachments_profile_owner BEFORE INSERT OR UPDATE ON "attachments" FOR EACH ROW EXECUTE FUNCTION pulpo_assign_data_profile();
--> statement-breakpoint
CREATE TRIGGER chat_import_sources_profile_owner BEFORE INSERT OR UPDATE ON "chat_import_sources" FOR EACH ROW EXECUTE FUNCTION pulpo_assign_data_profile();
--> statement-breakpoint
CREATE TRIGGER chat_shares_profile_owner BEFORE INSERT OR UPDATE ON "chat_shares" FOR EACH ROW EXECUTE FUNCTION pulpo_assign_data_profile();
--> statement-breakpoint
CREATE TRIGGER chat_turn_embeddings_profile_owner BEFORE INSERT OR UPDATE ON "chat_turn_embeddings" FOR EACH ROW EXECUTE FUNCTION pulpo_assign_data_profile();
--> statement-breakpoint
CREATE TRIGGER chats_profile_owner BEFORE INSERT OR UPDATE ON "chats" FOR EACH ROW EXECUTE FUNCTION pulpo_assign_data_profile();
--> statement-breakpoint
CREATE TRIGGER composer_drafts_profile_owner BEFORE INSERT OR UPDATE ON "composer_drafts" FOR EACH ROW EXECUTE FUNCTION pulpo_assign_data_profile();
--> statement-breakpoint
CREATE TRIGGER folders_profile_owner BEFORE INSERT OR UPDATE ON "folders" FOR EACH ROW EXECUTE FUNCTION pulpo_assign_data_profile();
--> statement-breakpoint
CREATE TRIGGER idempotency_records_profile_owner BEFORE INSERT OR UPDATE ON "idempotency_records" FOR EACH ROW EXECUTE FUNCTION pulpo_assign_data_profile();
--> statement-breakpoint
CREATE TRIGGER queued_messages_profile_owner BEFORE INSERT OR UPDATE ON "queued_messages" FOR EACH ROW EXECUTE FUNCTION pulpo_assign_data_profile();
--> statement-breakpoint
CREATE TRIGGER responses_profile_owner BEFORE INSERT OR UPDATE ON "responses" FOR EACH ROW EXECUTE FUNCTION pulpo_assign_data_profile();
--> statement-breakpoint
CREATE TRIGGER shelf_operations_profile_owner BEFORE INSERT OR UPDATE ON "shelf_operations" FOR EACH ROW EXECUTE FUNCTION pulpo_assign_data_profile();
--> statement-breakpoint
CREATE TRIGGER shelved_drafts_profile_owner BEFORE INSERT OR UPDATE ON "shelved_drafts" FOR EACH ROW EXECUTE FUNCTION pulpo_assign_data_profile();
--> statement-breakpoint
CREATE TRIGGER user_memory_document_revisions_profile_owner BEFORE INSERT OR UPDATE ON "user_memory_document_revisions" FOR EACH ROW EXECUTE FUNCTION pulpo_assign_data_profile();
--> statement-breakpoint
CREATE TRIGGER user_memory_documents_profile_owner BEFORE INSERT OR UPDATE ON "user_memory_documents" FOR EACH ROW EXECUTE FUNCTION pulpo_assign_data_profile();
--> statement-breakpoint
CREATE TRIGGER user_preferences_profile_owner BEFORE INSERT OR UPDATE ON "user_preferences" FOR EACH ROW EXECUTE FUNCTION pulpo_assign_data_profile();
--> statement-breakpoint
CREATE TRIGGER workspace_leases_profile_owner BEFORE INSERT OR UPDATE ON "workspace_leases" FOR EACH ROW EXECUTE FUNCTION pulpo_assign_data_profile();
