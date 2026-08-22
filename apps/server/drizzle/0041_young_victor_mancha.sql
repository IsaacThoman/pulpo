ALTER TABLE "billing_accounts" RENAME COLUMN "polar_customer_id" TO "stripe_customer_id";--> statement-breakpoint
ALTER TABLE "billing_checkouts" RENAME COLUMN "polar_checkout_id" TO "stripe_checkout_session_id";--> statement-breakpoint
ALTER TABLE "billing_orders" RENAME COLUMN "polar_order_id" TO "stripe_payment_id";--> statement-breakpoint
ALTER TABLE "billing_orders" RENAME COLUMN "polar_checkout_id" TO "stripe_checkout_session_id";--> statement-breakpoint
ALTER TABLE "billing_orders" RENAME COLUMN "polar_subscription_id" TO "stripe_subscription_id";--> statement-breakpoint
ALTER TABLE "billing_orders" RENAME COLUMN "polar_product_id" TO "stripe_price_id";--> statement-breakpoint
ALTER TABLE "billing_subscriptions" RENAME COLUMN "polar_subscription_id" TO "stripe_subscription_id";--> statement-breakpoint
ALTER TABLE "billing_subscriptions" RENAME COLUMN "polar_product_id" TO "stripe_price_id";--> statement-breakpoint
DROP INDEX "billing_accounts_polar_customer_unique";--> statement-breakpoint
DROP INDEX "billing_checkouts_polar_unique";--> statement-breakpoint
DROP INDEX "billing_orders_subscription_idx";--> statement-breakpoint
ALTER TABLE "billing_orders" ADD COLUMN "stripe_payment_intent_id" text;--> statement-breakpoint
ALTER TABLE "billing_orders" ADD COLUMN "stripe_charge_id" text;--> statement-breakpoint
ALTER TABLE "billing_orders" ADD COLUMN "processing_fee_amount_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_accounts_stripe_customer_unique" ON "billing_accounts" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_checkouts_stripe_unique" ON "billing_checkouts" USING btree ("stripe_checkout_session_id");--> statement-breakpoint
CREATE INDEX "billing_orders_payment_intent_idx" ON "billing_orders" USING btree ("stripe_payment_intent_id");--> statement-breakpoint
CREATE INDEX "billing_orders_charge_idx" ON "billing_orders" USING btree ("stripe_charge_id");--> statement-breakpoint
CREATE INDEX "billing_orders_subscription_idx" ON "billing_orders" USING btree ("stripe_subscription_id");