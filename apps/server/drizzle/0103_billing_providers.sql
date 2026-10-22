-- Billing rows can come from Stripe or the App Store. Rename Stripe-only identifiers in place
-- and record the provider on every existing row as Stripe.
ALTER TABLE "billing_subscriptions" RENAME COLUMN "stripe_subscription_id" TO "provider_subscription_id";--> statement-breakpoint
ALTER TABLE "billing_subscriptions" RENAME COLUMN "stripe_price_id" TO "provider_product_id";--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD COLUMN "provider" text DEFAULT 'stripe' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ALTER COLUMN "provider" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "billing_orders" RENAME COLUMN "stripe_payment_id" TO "provider_payment_id";--> statement-breakpoint
ALTER TABLE "billing_orders" RENAME COLUMN "stripe_subscription_id" TO "provider_subscription_id";--> statement-breakpoint
ALTER TABLE "billing_orders" RENAME COLUMN "stripe_price_id" TO "provider_product_id";--> statement-breakpoint
ALTER TABLE "billing_orders" ADD COLUMN "provider" text DEFAULT 'stripe' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_orders" ALTER COLUMN "provider" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "billing_webhook_events" ADD COLUMN "provider" text DEFAULT 'stripe' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_webhook_events" ALTER COLUMN "provider" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "billing_orders" ADD CONSTRAINT "billing_orders_provider_check" CHECK ("billing_orders"."provider" in ('stripe', 'app_store'));--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_provider_check" CHECK ("billing_subscriptions"."provider" in ('stripe', 'app_store'));--> statement-breakpoint
ALTER TABLE "billing_webhook_events" ADD CONSTRAINT "billing_webhook_events_provider_check" CHECK ("billing_webhook_events"."provider" in ('stripe', 'app_store'));
