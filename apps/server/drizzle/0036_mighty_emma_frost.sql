CREATE TABLE "billing_accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"polar_customer_id" text,
	"weekly_limit_override_micros" bigint,
	"hold_at" timestamp with time zone,
	"hold_reason" text,
	"hold_reference" text,
	"hold_cleared_at" timestamp with time zone,
	"hold_cleared_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_accounts_weekly_override_check" CHECK ("billing_accounts"."weekly_limit_override_micros" is null or "billing_accounts"."weekly_limit_override_micros" >= 0)
);
--> statement-breakpoint
CREATE TABLE "billing_checkouts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"polar_checkout_id" text,
	"kind" text NOT NULL,
	"plan" text,
	"requested_credit_cents" integer,
	"charge_cents" integer,
	"status" text DEFAULT 'creating' NOT NULL,
	"checkout_url" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_checkouts_kind_check" CHECK ("billing_checkouts"."kind" in ('credits', 'subscription'))
);
--> statement-breakpoint
CREATE TABLE "billing_orders" (
	"polar_order_id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"polar_checkout_id" text,
	"polar_subscription_id" text,
	"polar_product_id" text NOT NULL,
	"billing_reason" text NOT NULL,
	"status" text NOT NULL,
	"currency" text NOT NULL,
	"subtotal_amount_cents" integer DEFAULT 0 NOT NULL,
	"discount_amount_cents" integer DEFAULT 0 NOT NULL,
	"net_amount_cents" integer DEFAULT 0 NOT NULL,
	"tax_amount_cents" integer DEFAULT 0 NOT NULL,
	"total_amount_cents" integer DEFAULT 0 NOT NULL,
	"platform_fee_amount_cents" integer DEFAULT 0 NOT NULL,
	"refunded_amount_cents" integer DEFAULT 0 NOT NULL,
	"requested_credit_cents" integer,
	"granted_credit_micros" bigint DEFAULT 0 NOT NULL,
	"paid_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_subscriptions" (
	"polar_subscription_id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"polar_product_id" text NOT NULL,
	"plan" text NOT NULL,
	"status" text NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"paid_through" timestamp with time zone,
	"provider_modified_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_subscriptions_plan_check" CHECK ("billing_subscriptions"."plan" in ('eight', 'fat'))
);
--> statement-breakpoint
CREATE TABLE "billing_webhook_events" (
	"provider_event_id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"resource_id" text,
	"status" text DEFAULT 'processing' NOT NULL,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_usage_periods" (
	"user_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"spent_micros" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_usage_periods_user_id_period_start_pk" PRIMARY KEY("user_id","period_start"),
	CONSTRAINT "weekly_usage_periods_spent_check" CHECK ("weekly_usage_periods"."spent_micros" >= 0)
);
--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD COLUMN "weekly_period_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD COLUMN "weekly_reserved_micros" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD COLUMN "balance_reserved_micros" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD COLUMN "settled_weekly_micros" bigint;--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD COLUMN "settled_balance_micros" bigint;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "weekly_cost_micros" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "balance_cost_micros" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "weekly_period_start" timestamp with time zone;--> statement-breakpoint
UPDATE "budget_reservations" SET "balance_reserved_micros" = "amount_micros";--> statement-breakpoint
UPDATE "usage_events" SET "balance_cost_micros" = "cost_micros";--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_hold_cleared_by_users_id_fk" FOREIGN KEY ("hold_cleared_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_checkouts" ADD CONSTRAINT "billing_checkouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_orders" ADD CONSTRAINT "billing_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_usage_periods" ADD CONSTRAINT "weekly_usage_periods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_accounts_polar_customer_unique" ON "billing_accounts" USING btree ("polar_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_checkouts_user_idempotency_unique" ON "billing_checkouts" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_checkouts_polar_unique" ON "billing_checkouts" USING btree ("polar_checkout_id");--> statement-breakpoint
CREATE INDEX "billing_checkouts_user_created_idx" ON "billing_checkouts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "billing_orders_user_created_idx" ON "billing_orders" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "billing_orders_subscription_idx" ON "billing_orders" USING btree ("polar_subscription_id");--> statement-breakpoint
CREATE INDEX "billing_orders_paid_idx" ON "billing_orders" USING btree ("paid_at");--> statement-breakpoint
CREATE INDEX "billing_subscriptions_user_idx" ON "billing_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "billing_subscriptions_status_idx" ON "billing_subscriptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "billing_webhook_status_idx" ON "billing_webhook_events" USING btree ("status","received_at");--> statement-breakpoint
CREATE INDEX "reservation_user_status_idx" ON "budget_reservations" USING btree ("user_id","status");--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD CONSTRAINT "reservation_source_split_check" CHECK ("budget_reservations"."weekly_reserved_micros" >= 0 and "budget_reservations"."balance_reserved_micros" >= 0 and "budget_reservations"."weekly_reserved_micros" + "budget_reservations"."balance_reserved_micros" = "budget_reservations"."amount_micros");
