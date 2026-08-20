ALTER TABLE "users" ALTER COLUMN "storage_limit_bytes" SET DEFAULT 5368709120;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD COLUMN "storage_limit_override_bytes" bigint;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_storage_override_check" CHECK ("billing_accounts"."storage_limit_override_bytes" is null or "billing_accounts"."storage_limit_override_bytes" >= 0);--> statement-breakpoint
UPDATE "application_settings"
SET "value" = jsonb_set("value", '{defaultStorageLimitBytes}', '5368709120'::jsonb, true),
    "updated_at" = now()
WHERE "key" = 'auth';--> statement-breakpoint
UPDATE "users"
SET "storage_limit_bytes" = CASE
	WHEN EXISTS (
		SELECT 1 FROM "billing_subscriptions"
		WHERE "billing_subscriptions"."user_id" = "users"."id"
			AND "billing_subscriptions"."plan" = 'fat'
			AND "billing_subscriptions"."status" IN ('active', 'past_due')
			AND "billing_subscriptions"."paid_through" > now()
	) THEN 107374182400
	WHEN EXISTS (
		SELECT 1 FROM "billing_subscriptions"
		WHERE "billing_subscriptions"."user_id" = "users"."id"
			AND "billing_subscriptions"."plan" = 'eight'
			AND "billing_subscriptions"."status" IN ('active', 'past_due')
			AND "billing_subscriptions"."paid_through" > now()
	) THEN 26843545600
	ELSE 5368709120
END,
"updated_at" = now();
