ALTER TABLE "users" ADD COLUMN "deletion_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deletion_error" text;--> statement-breakpoint
-- Keep deletion irreversible and serialize changes to the last active administrator.
CREATE FUNCTION pulpo_account_lifecycle_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.deletion_requested_at IS NOT NULL THEN
    IF NEW.deletion_requested_at IS NULL OR NOT NEW.blocked OR NEW.avatar_object_key IS DISTINCT FROM OLD.avatar_object_key THEN
      RAISE EXCEPTION 'Account deletion is irreversible';
    END IF;
  END IF;
  IF OLD.role = 'admin' AND NOT OLD.blocked AND OLD.deletion_requested_at IS NULL THEN
    IF TG_OP = 'DELETE' OR NEW.role <> 'admin' OR NEW.blocked OR NEW.deletion_requested_at IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(hashtext('account-administration'));
      IF NOT EXISTS (SELECT 1 FROM users WHERE id <> OLD.id AND role = 'admin' AND NOT blocked AND deletion_requested_at IS NULL) THEN
        RAISE EXCEPTION 'Appoint another unblocked administrator first';
      END IF;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER account_lifecycle_guard BEFORE UPDATE OR DELETE ON users FOR EACH ROW EXECUTE FUNCTION pulpo_account_lifecycle_guard();
--> statement-breakpoint
-- In-flight requests and delayed workers cannot create new account content after acceptance.
-- SHARE locks serialize these inserts with the deletion marker update.
CREATE FUNCTION pulpo_reject_deleted_account_work() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_id uuid; deleting timestamptz;
BEGIN
  owner_id := (to_jsonb(NEW)->>TG_ARGV[0])::uuid;
  IF owner_id IS NULL THEN RETURN NEW; END IF;
  SELECT deletion_requested_at INTO deleting FROM users WHERE id = owner_id FOR SHARE;
  IF deleting IS NOT NULL THEN RAISE EXCEPTION 'Account is being deleted'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sessions', 'api_keys', 'management_tokens', 'chats', 'attachments', 'responses', 'queued_messages', 'chat_shares', 'composer_drafts', 'workspace_leases', 'codex_login_attempts', 'user_provider_credentials', 'user_memory_documents', 'user_memory_document_revisions', 'chat_turn_embeddings', 'export_jobs', 'billing_checkouts', 'pool_members'] LOOP
    EXECUTE format('CREATE TRIGGER reject_deleted_account_work BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION pulpo_reject_deleted_account_work(''user_id'')', t);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION pulpo_reject_deleted_response_start() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('queued', 'in_progress') AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND deletion_requested_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Account is being deleted';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER reject_deleted_response_start BEFORE UPDATE OF status ON responses FOR EACH ROW EXECUTE FUNCTION pulpo_reject_deleted_response_start();
