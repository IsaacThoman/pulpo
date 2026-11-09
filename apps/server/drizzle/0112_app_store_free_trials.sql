-- Marks App Store payments that were introductory free trials, which the admin's daily trial
-- limit counts over the last 24 hours.
ALTER TABLE "billing_orders" ADD COLUMN "free_trial" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "billing_orders_free_trial_idx" ON "billing_orders" USING btree ("paid_at") WHERE "billing_orders"."free_trial";