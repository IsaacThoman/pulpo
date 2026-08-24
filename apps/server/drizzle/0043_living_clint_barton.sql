CREATE TABLE "chat_search_documents" (
	"chat_id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_search_documents" ADD CONSTRAINT "chat_search_documents_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE FUNCTION pulpo_search_text(value jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  result text;
BEGIN
  CASE jsonb_typeof(value)
    WHEN 'string' THEN
      RETURN value #>> '{}';
    WHEN 'array' THEN
      SELECT string_agg(pulpo_search_text(element), ' ') INTO result
      FROM jsonb_array_elements(value) AS element;
      RETURN coalesce(result, '');
    WHEN 'object' THEN
      IF value ? 'role' AND value->>'role' <> 'user' AND value->>'type' IS DISTINCT FROM 'message' THEN
        RETURN '';
      END IF;
      SELECT string_agg(pulpo_search_text(entry.value), ' ') INTO result
      FROM jsonb_each(value) AS entry
      WHERE entry.key IN ('content', 'text', 'refusal');
      RETURN coalesce(result, '');
    ELSE
      RETURN '';
  END CASE;
END;
$$;--> statement-breakpoint
CREATE FUNCTION pulpo_refresh_chat_search_document(target_chat_id uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO chat_search_documents(chat_id, title, body, updated_at)
  SELECT c.id, c.title,
    coalesce(string_agg(pulpo_search_text(r.input) || ' ' || pulpo_search_text(r.output), E'\n\n' ORDER BY r.created_at), ''),
    now()
  FROM chats c
  LEFT JOIN responses r ON r.chat_id = c.id AND r.deleted_at IS NULL
  WHERE c.id = target_chat_id
  GROUP BY c.id, c.title
  ON CONFLICT (chat_id) DO UPDATE SET
    title = excluded.title,
    body = excluded.body,
    updated_at = excluded.updated_at;
END;
$$;--> statement-breakpoint
CREATE FUNCTION pulpo_refresh_chat_search_from_chat() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pulpo_refresh_chat_search_document(NEW.id);
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER chats_refresh_search_document
AFTER INSERT OR UPDATE OF title ON chats
FOR EACH ROW EXECUTE FUNCTION pulpo_refresh_chat_search_from_chat();--> statement-breakpoint
CREATE FUNCTION pulpo_refresh_chat_search_from_response() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.chat_id <> NEW.chat_id) THEN
    PERFORM pulpo_refresh_chat_search_document(OLD.chat_id);
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.status IN ('queued', 'in_progress') THEN
    RETURN NEW;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM pulpo_refresh_chat_search_document(NEW.chat_id);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER responses_refresh_search_document
AFTER INSERT OR DELETE OR UPDATE OF input, output, status, deleted_at, chat_id ON responses
FOR EACH ROW EXECUTE FUNCTION pulpo_refresh_chat_search_from_response();--> statement-breakpoint
INSERT INTO chat_search_documents(chat_id, title, body, updated_at)
SELECT c.id, c.title,
  coalesce(string_agg(pulpo_search_text(r.input) || ' ' || pulpo_search_text(r.output), E'\n\n' ORDER BY r.created_at), ''),
  now()
FROM chats c
LEFT JOIN responses r ON r.chat_id = c.id AND r.deleted_at IS NULL
GROUP BY c.id, c.title;--> statement-breakpoint
CREATE INDEX "chat_search_documents_fts_idx" ON "chat_search_documents" USING gin ((
    setweight(to_tsvector('simple', coalesce("title", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce("body", '')), 'B')
  ));
