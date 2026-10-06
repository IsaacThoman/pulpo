CREATE TABLE "app_store_subscriptions" (
	"original_transaction_id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"product_id" text NOT NULL,
	"plan" text NOT NULL,
	"paid_plan" text NOT NULL,
	"status" text NOT NULL,
	"auto_renew" boolean DEFAULT true NOT NULL,
	"in_billing_retry" boolean DEFAULT false NOT NULL,
	"latest_transaction_id" text NOT NULL,
	"current_period_start" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"grace_period_expires_at" timestamp with time zone,
	"paid_through" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"transaction_signed_at" timestamp with time zone NOT NULL,
	"renewal_signed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_store_subscriptions_environment_check" CHECK ("app_store_subscriptions"."environment" in ('Production', 'Sandbox')),
	CONSTRAINT "app_store_subscriptions_plan_check" CHECK ("app_store_subscriptions"."plan" in ('eight', 'fat')),
	CONSTRAINT "app_store_subscriptions_paid_plan_check" CHECK ("app_store_subscriptions"."paid_plan" in ('eight', 'fat')),
	CONSTRAINT "app_store_subscriptions_status_check" CHECK ("app_store_subscriptions"."status" in ('active', 'past_due', 'expired', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "app_store_transactions" (
	"transaction_id" text PRIMARY KEY NOT NULL,
	"original_transaction_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"product_id" text NOT NULL,
	"plan" text NOT NULL,
	"transaction_reason" text,
	"storefront" text,
	"currency" text,
	"price_milliunits" bigint,
	"purchased_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revocation_reason" integer,
	"signed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_store_subscriptions" ADD CONSTRAINT "app_store_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_store_transactions" ADD CONSTRAINT "app_store_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_store_subscriptions_user_idx" ON "app_store_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "app_store_subscriptions_status_idx" ON "app_store_subscriptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "app_store_transactions_original_idx" ON "app_store_transactions" USING btree ("original_transaction_id");--> statement-breakpoint
CREATE INDEX "app_store_transactions_user_purchased_idx" ON "app_store_transactions" USING btree ("user_id","purchased_at");