ALTER TABLE "provider_connections" ADD COLUMN "cache_affinity_mode" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_connections" ADD COLUMN "cache_affinity_scope" text DEFAULT 'chat' NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_connections" ADD COLUMN "cache_isolation_mode" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_connections" ADD COLUMN "cache_isolation_scope" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
UPDATE "provider_connections"
SET "cache_affinity_mode" = 'openai_prompt_cache_key'
WHERE lower("base_url") LIKE 'https://api.openai.com/%';--> statement-breakpoint
UPDATE "provider_connections"
SET "cache_affinity_mode" = 'fireworks_session_affinity',
    "cache_isolation_mode" = 'fireworks_prompt_cache_isolation'
WHERE lower("base_url") LIKE 'https://api.fireworks.ai/%';
