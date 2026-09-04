ALTER TABLE "composer_drafts" DROP CONSTRAINT "composer_drafts_revision_check";--> statement-breakpoint
ALTER TABLE "composer_drafts" ADD COLUMN "cleared_revision" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "composer_drafts" ADD COLUMN "state" jsonb;--> statement-breakpoint
ALTER TABLE "composer_drafts" ADD COLUMN "mutation_id" text;--> statement-breakpoint
ALTER TABLE "composer_drafts" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "composer_drafts" ADD CONSTRAINT "composer_drafts_revision_check" CHECK ("composer_drafts"."revision" >= 0);
--> statement-breakpoint
UPDATE composer_drafts d SET state = jsonb_build_object(
  'content', d.content,
  'attachments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'name', a.original_name, 'mimeType', a.mime_type, 'size', a.size_bytes) ORDER BY da.position)
    FROM composer_draft_attachments da JOIN attachments a ON a.id = da.attachment_id WHERE da.draft_id = d.id AND a.status = 'ready'), '[]'::jsonb),
  'model', jsonb_build_object('id', d.model_id, 'presets', d.preset_selections),
  'agentMode', d.agent_mode, 'temporary', COALESCE((SELECT temporary FROM chats WHERE id = d.chat_id), false),
  'autoExpire', COALESCE(d.auto_expire, false)
), expires_at = (SELECT expires_at FROM chats WHERE id = d.chat_id);
--> statement-breakpoint
ALTER TABLE composer_drafts ALTER COLUMN state SET NOT NULL;
--> statement-breakpoint
CREATE FUNCTION clear_unavailable_composer_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL OR (NEW.expires_at IS NOT NULL AND NEW.expires_at <= now()) THEN
    UPDATE composer_drafts SET content = '', state = '{"content":"","attachments":[],"model":null,"agentMode":true,"temporary":false,"autoExpire":false}'::jsonb,
      revision = revision + 1, cleared_revision = revision + 1, mutation_id = NULL, expires_at = NULL, updated_at = now()
      WHERE chat_id = NEW.id;
    DELETE FROM composer_draft_attachments WHERE draft_id IN (SELECT id FROM composer_drafts WHERE chat_id = NEW.id);
  ELSE
    UPDATE composer_drafts SET expires_at = NEW.expires_at WHERE chat_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER chats_clear_composer_draft AFTER UPDATE OF deleted_at, expires_at ON chats
  FOR EACH ROW EXECUTE FUNCTION clear_unavailable_composer_draft();
--> statement-breakpoint
UPDATE composer_drafts SET content = '', state = '{"content":"","attachments":[],"model":null,"agentMode":true,"temporary":false,"autoExpire":false}'::jsonb,
 revision = revision + 1, cleared_revision = revision + 1, expires_at = NULL
 WHERE chat_id IN (SELECT id FROM chats WHERE deleted_at IS NOT NULL OR expires_at <= now());

--> statement-breakpoint
DELETE FROM composer_draft_attachments WHERE draft_id IN (SELECT id FROM composer_drafts WHERE revision = cleared_revision);
