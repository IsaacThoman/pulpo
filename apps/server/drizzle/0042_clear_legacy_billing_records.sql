-- The provider-column rename in 0041 intentionally kept the database shape,
-- but legacy provider values are not valid Stripe resource IDs. Remove only
-- records whose identifiers cannot have been created by Stripe so this remains
-- safe if a test-mode Stripe record was written between the two migrations.
DELETE FROM "credit_ledger"
WHERE "metadata" ? 'polarOrderId';--> statement-breakpoint

DELETE FROM "billing_orders"
WHERE "stripe_payment_id" !~ '^(pi_|in_)';--> statement-breakpoint

DELETE FROM "billing_subscriptions"
WHERE "stripe_subscription_id" !~ '^sub_';--> statement-breakpoint

DELETE FROM "billing_checkouts"
WHERE "stripe_checkout_session_id" IS NULL
  OR "stripe_checkout_session_id" !~ '^cs_';--> statement-breakpoint

DELETE FROM "billing_webhook_events"
WHERE "provider_event_id" !~ '^(evt_|reconcile:)';--> statement-breakpoint

UPDATE "billing_accounts"
SET
  "stripe_customer_id" = NULL,
  "updated_at" = now()
WHERE "stripe_customer_id" IS NOT NULL
  AND "stripe_customer_id" !~ '^cus_';--> statement-breakpoint

UPDATE "billing_accounts"
SET
  "hold_at" = NULL,
  "hold_reason" = NULL,
  "hold_reference" = NULL,
  "hold_cleared_at" = NULL,
  "hold_cleared_by" = NULL,
  "updated_at" = now()
WHERE "hold_reason" IN ('payment_reversed', 'payment_refunded', 'payment_dispute')
  AND "hold_reference" IS NOT NULL
  AND "hold_reference" !~ '^(re_|ch_|dp_|pi_|in_)';
