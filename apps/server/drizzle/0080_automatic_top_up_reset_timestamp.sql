ALTER TABLE "auto_top_up_settings" ADD COLUMN "limit_reached_at" timestamp with time zone;--> statement-breakpoint
UPDATE "auto_top_up_settings" SET "limit_reached_at" = "updated_at" WHERE "limit_reached" = true;--> statement-breakpoint
ALTER TABLE "auto_top_up_settings" DROP COLUMN "limit_reached";
