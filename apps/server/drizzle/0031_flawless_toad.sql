ALTER TABLE "generation_attempts" ADD COLUMN "cache_write_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_pricing_versions" ADD COLUMN "cache_write_price_micros" bigint;--> statement-breakpoint
UPDATE "model_pricing_versions" SET "cache_write_price_micros" = "input_price_micros";--> statement-breakpoint
ALTER TABLE "model_pricing_versions" ALTER COLUMN "cache_write_price_micros" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "request_logs" ADD COLUMN "cache_write_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "cache_write_tokens" integer DEFAULT 0 NOT NULL;
