-- App Store billing: a per-account token Apple echoes back on every purchase, an admin flag that
-- lets sandbox purchases grant a plan, and the App Store environment each subscription lives in.
ALTER TABLE "billing_accounts" ADD COLUMN "app_store_account_token" uuid;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD COLUMN "app_store_sandbox_allowed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD COLUMN "provider_environment" text;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_app_store_account_token_unique" UNIQUE("app_store_account_token");--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_provider_environment_check" CHECK ("billing_subscriptions"."provider_environment" is null or "billing_subscriptions"."provider_environment" in ('production', 'sandbox'));