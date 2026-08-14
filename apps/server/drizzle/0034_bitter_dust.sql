CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_username_trgm_idx" ON "users" USING gin (lower("username") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_name_trgm_idx" ON "users" USING gin (lower("name") gin_trgm_ops);
