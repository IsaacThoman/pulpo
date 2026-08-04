ALTER TABLE "models" ADD COLUMN "compaction_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "compaction_threshold_tokens" integer DEFAULT 100000 NOT NULL;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "agent_compaction_threshold_tokens" integer DEFAULT 180000 NOT NULL;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "compaction_retained_turns" integer DEFAULT 4 NOT NULL;