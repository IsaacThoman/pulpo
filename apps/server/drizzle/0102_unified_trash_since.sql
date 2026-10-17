-- Files items trashed before chats and Files shared one trash keep the 30 days Files gave them, so a
-- shorter retention chosen for chats does not purge them on upgrade (see `filePurgeAtFor`).
INSERT INTO "application_settings" ("key", "value") VALUES ('unifiedTrashSince', to_jsonb(now())) ON CONFLICT ("key") DO NOTHING;
