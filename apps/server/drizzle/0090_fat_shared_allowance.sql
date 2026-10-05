CREATE TABLE "budget_reservation_allowance_funders" (
	"reservation_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"weekly_period_start" timestamp with time zone NOT NULL,
	"reserved_micros" bigint NOT NULL,
	"settled_micros" bigint,
	CONSTRAINT "budget_reservation_allowance_funders_reservation_id_owner_user_id_pk" PRIMARY KEY("reservation_id","owner_user_id"),
	CONSTRAINT "budget_reservation_allowance_funders_amount_check" CHECK ("budget_reservation_allowance_funders"."reserved_micros" >= 0 and ("budget_reservation_allowance_funders"."settled_micros" is null or "budget_reservation_allowance_funders"."settled_micros" >= 0))
);
--> statement-breakpoint
CREATE TABLE "shared_allowance_periods" (
	"owner_user_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"spent_micros" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shared_allowance_periods_owner_user_id_period_start_pk" PRIMARY KEY("owner_user_id","period_start"),
	CONSTRAINT "shared_allowance_periods_spent_check" CHECK ("shared_allowance_periods"."spent_micros" >= 0)
);
--> statement-breakpoint
CREATE TABLE "shared_five_hour_usage_periods" (
	"user_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"spent_micros" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shared_five_hour_usage_periods_user_id_period_start_pk" PRIMARY KEY("user_id","period_start"),
	CONSTRAINT "shared_five_hour_usage_periods_spent_check" CHECK ("shared_five_hour_usage_periods"."spent_micros" >= 0)
);
--> statement-breakpoint
ALTER TABLE "budget_reservations" DROP CONSTRAINT "reservation_source_split_check";--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD COLUMN "shared_reserved_micros" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD COLUMN "shared_five_hour_period_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD COLUMN "settled_shared_micros" bigint;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "shared_cost_micros" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_reservation_allowance_funders" ADD CONSTRAINT "budget_reservation_allowance_funders_reservation_id_budget_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."budget_reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_reservation_allowance_funders" ADD CONSTRAINT "budget_reservation_allowance_funders_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_allowance_periods" ADD CONSTRAINT "shared_allowance_periods_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_five_hour_usage_periods" ADD CONSTRAINT "shared_five_hour_usage_periods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_reservation_allowance_funders_owner_idx" ON "budget_reservation_allowance_funders" USING btree ("owner_user_id","weekly_period_start");--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD CONSTRAINT "reservation_source_split_check" CHECK ("budget_reservations"."weekly_reserved_micros" >= 0 and "budget_reservations"."shared_reserved_micros" >= 0 and "budget_reservations"."balance_reserved_micros" >= 0 and "budget_reservations"."weekly_reserved_micros" + "budget_reservations"."shared_reserved_micros" + "budget_reservations"."balance_reserved_micros" = "budget_reservations"."amount_micros");