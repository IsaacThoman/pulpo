CREATE TABLE "five_hour_usage_periods" (
	"user_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"spent_micros" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "five_hour_usage_periods_user_id_period_start_pk" PRIMARY KEY("user_id","period_start"),
	CONSTRAINT "five_hour_usage_periods_spent_check" CHECK ("five_hour_usage_periods"."spent_micros" >= 0)
);
--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD COLUMN "five_hour_limit_override_micros" bigint;--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD COLUMN "five_hour_period_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD COLUMN "five_hour_reserved_micros" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD COLUMN "settled_five_hour_micros" bigint;--> statement-breakpoint
UPDATE "budget_reservations"
SET
	"five_hour_period_start" = CASE
		WHEN "weekly_reserved_micros" > 0 AND "status" = 'pending' THEN CURRENT_TIMESTAMP
		WHEN "weekly_reserved_micros" > 0 THEN "created_at"
		ELSE NULL
	END,
	"five_hour_reserved_micros" = "weekly_reserved_micros",
	"settled_five_hour_micros" = "settled_weekly_micros";--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "five_hour_cost_micros" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "five_hour_period_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "five_hour_usage_periods" ADD CONSTRAINT "five_hour_usage_periods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "five_hour_usage_periods_active_idx" ON "five_hour_usage_periods" USING btree ("user_id","period_start");--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_five_hour_override_check" CHECK ("billing_accounts"."five_hour_limit_override_micros" is null or "billing_accounts"."five_hour_limit_override_micros" >= 0);--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD CONSTRAINT "reservation_five_hour_match_check" CHECK ("budget_reservations"."five_hour_reserved_micros" >= 0 and "budget_reservations"."five_hour_reserved_micros" = "budget_reservations"."weekly_reserved_micros");
