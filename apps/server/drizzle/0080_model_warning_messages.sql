ALTER TABLE "models" ADD COLUMN "warning_message" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "warning_dismiss_days" integer DEFAULT 30 NOT NULL;