CREATE TABLE "budget_reservation_custom_funders" (
	"reservation_id" uuid NOT NULL,
	"limit_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"period_start" timestamp with time zone,
	"reserved_micros" bigint NOT NULL,
	"settled_micros" bigint,
	CONSTRAINT "budget_reservation_custom_funders_reservation_id_limit_id_owner_user_id_pk" PRIMARY KEY("reservation_id","limit_id","owner_user_id"),
	CONSTRAINT "budget_reservation_custom_funders_amount_check" CHECK ("budget_reservation_custom_funders"."reserved_micros" >= 0 and ("budget_reservation_custom_funders"."settled_micros" is null or "budget_reservation_custom_funders"."settled_micros" >= 0))
);
--> statement-breakpoint
CREATE TABLE "custom_limit_spend" (
	"id" uuid PRIMARY KEY NOT NULL,
	"limit_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"period_start" timestamp with time zone,
	"spent_micros" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_limit_spend_amount_check" CHECK ("custom_limit_spend"."spent_micros" >= 0)
);
--> statement-breakpoint
ALTER TABLE "budget_reservations" DROP CONSTRAINT "reservation_source_split_check";--> statement-breakpoint
ALTER TABLE "billing_custom_limits" ADD COLUMN "share_percent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD COLUMN "custom_reserved_micros" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD COLUMN "settled_custom_micros" bigint;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "custom_cost_micros" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_reservation_custom_funders" ADD CONSTRAINT "budget_reservation_custom_funders_reservation_id_budget_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."budget_reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_reservation_custom_funders" ADD CONSTRAINT "budget_reservation_custom_funders_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_limit_spend" ADD CONSTRAINT "custom_limit_spend_limit_id_billing_custom_limits_id_fk" FOREIGN KEY ("limit_id") REFERENCES "public"."billing_custom_limits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_limit_spend" ADD CONSTRAINT "custom_limit_spend_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_limit_spend" ADD CONSTRAINT "custom_limit_spend_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_reservation_custom_funders_allowance_idx" ON "budget_reservation_custom_funders" USING btree ("limit_id","owner_user_id");--> statement-breakpoint
CREATE INDEX "custom_limit_spend_allowance_idx" ON "custom_limit_spend" USING btree ("limit_id","owner_user_id","created_at");--> statement-breakpoint
ALTER TABLE "billing_custom_limits" ADD CONSTRAINT "billing_custom_limits_share_check" CHECK ("billing_custom_limits"."share_percent" between 0 and 100);--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD CONSTRAINT "reservation_source_split_check" CHECK ("budget_reservations"."weekly_reserved_micros" >= 0 and "budget_reservations"."shared_reserved_micros" >= 0 and "budget_reservations"."balance_reserved_micros" >= 0 and "budget_reservations"."custom_reserved_micros" >= 0 and "budget_reservations"."custom_reserved_micros" + "budget_reservations"."weekly_reserved_micros" + "budget_reservations"."shared_reserved_micros" + "budget_reservations"."balance_reserved_micros" = "budget_reservations"."amount_micros");