ALTER TABLE "billing_subscriptions" ADD COLUMN "paid_plan" text;--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD COLUMN "paid_plan_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_paid_plan_check" CHECK ("billing_subscriptions"."paid_plan" is null or "billing_subscriptions"."paid_plan" in ('eight', 'fat'));--> statement-breakpoint
-- Existing subscriptions were always paid at their current price.
UPDATE "billing_subscriptions"
SET "paid_plan" = "plan", "paid_plan_at" = now()
WHERE "paid_through" IS NOT NULL AND "paid_plan" IS NULL;
