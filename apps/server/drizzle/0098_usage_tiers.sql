CREATE TABLE "daily_usage_periods" (
	"user_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"spent_micros" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_usage_periods_user_id_period_start_pk" PRIMARY KEY("user_id","period_start"),
	CONSTRAINT "daily_usage_periods_spent_check" CHECK ("daily_usage_periods"."spent_micros" >= 0)
);
--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD COLUMN "daily_limit_override_micros" bigint;--> statement-breakpoint
ALTER TABLE "daily_usage_periods" ADD CONSTRAINT "daily_usage_periods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;