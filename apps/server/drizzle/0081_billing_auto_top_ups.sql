CREATE TABLE "billing_auto_top_ups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"credit_cents" integer NOT NULL,
	"charge_cents" integer NOT NULL,
	"stripe_payment_method_id" text NOT NULL,
	"stripe_invoice_id" text,
	"stripe_payment_intent_id" text,
	"failure_code" text,
	"failure_message" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_auto_top_ups_status_check" CHECK ("billing_auto_top_ups"."status" in ('processing', 'succeeded', 'failed')),
	CONSTRAINT "billing_auto_top_ups_amount_check" CHECK ("billing_auto_top_ups"."credit_cents" > 0 and "billing_auto_top_ups"."charge_cents" >= "billing_auto_top_ups"."credit_cents")
);
--> statement-breakpoint
ALTER TABLE "billing_checkouts" DROP CONSTRAINT "billing_checkouts_kind_check";--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD COLUMN "stripe_payment_method_id" text;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD COLUMN "payment_method_brand" text;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD COLUMN "payment_method_last4" text;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD COLUMN "auto_top_up_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD COLUMN "auto_top_up_threshold_cents" integer;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD COLUMN "auto_top_up_amount_cents" integer;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD COLUMN "auto_top_up_monthly_limit_cents" integer;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD COLUMN "auto_top_up_disabled_reason" text;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD COLUMN "auto_top_up_disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_checkouts" ADD COLUMN "save_payment_method" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_auto_top_ups" ADD CONSTRAINT "billing_auto_top_ups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_auto_top_ups_user_created_idx" ON "billing_auto_top_ups" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_auto_top_ups_invoice_unique" ON "billing_auto_top_ups" USING btree ("stripe_invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_auto_top_ups_user_processing_unique" ON "billing_auto_top_ups" USING btree ("user_id") WHERE "billing_auto_top_ups"."status" = 'processing';--> statement-breakpoint
CREATE INDEX "billing_auto_top_ups_processing_idx" ON "billing_auto_top_ups" USING btree ("created_at") WHERE "billing_auto_top_ups"."status" = 'processing';--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_auto_top_up_threshold_check" CHECK ("billing_accounts"."auto_top_up_threshold_cents" is null or "billing_accounts"."auto_top_up_threshold_cents" between 0 and 50000);--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_auto_top_up_amount_check" CHECK ("billing_accounts"."auto_top_up_amount_cents" is null or "billing_accounts"."auto_top_up_amount_cents" between 500 and 50000);--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_auto_top_up_limit_check" CHECK ("billing_accounts"."auto_top_up_monthly_limit_cents" is null or ("billing_accounts"."auto_top_up_monthly_limit_cents" between 500 and 500000 and "billing_accounts"."auto_top_up_monthly_limit_cents" >= coalesce("billing_accounts"."auto_top_up_amount_cents", 0)));--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_auto_top_up_config_check" CHECK (not "billing_accounts"."auto_top_up_enabled" or ("billing_accounts"."auto_top_up_threshold_cents" is not null and "billing_accounts"."auto_top_up_amount_cents" is not null and "billing_accounts"."auto_top_up_monthly_limit_cents" is not null));--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_auto_top_up_disabled_reason_check" CHECK ("billing_accounts"."auto_top_up_disabled_reason" is null or "billing_accounts"."auto_top_up_disabled_reason" in ('payment_failed', 'payment_method_removed'));--> statement-breakpoint
ALTER TABLE "billing_checkouts" ADD CONSTRAINT "billing_checkouts_kind_check" CHECK ("billing_checkouts"."kind" in ('credits', 'subscription', 'payment_method'));