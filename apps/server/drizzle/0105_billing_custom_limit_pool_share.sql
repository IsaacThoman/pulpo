CREATE TABLE "budget_reservation_custom_limit_draws" (
	"reservation_id" uuid NOT NULL,
	"limit_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"reserved_micros" bigint NOT NULL,
	CONSTRAINT "budget_reservation_custom_limit_draws_pk" PRIMARY KEY("reservation_id","limit_id","owner_user_id"),
	CONSTRAINT "budget_reservation_custom_limit_draws_amount_check" CHECK ("budget_reservation_custom_limit_draws"."reserved_micros" >= 0)
);
--> statement-breakpoint
CREATE TABLE "custom_limit_pool_usage" (
	"id" uuid PRIMARY KEY NOT NULL,
	"limit_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"micros" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_limit_pool_usage_amount_check" CHECK ("custom_limit_pool_usage"."micros" > 0)
);
--> statement-breakpoint
ALTER TABLE "billing_custom_limits" ADD COLUMN "pool_share_percent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_reservation_custom_limit_draws" ADD CONSTRAINT "budget_reservation_custom_limit_draws_reservation_id_budget_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."budget_reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_reservation_custom_limit_draws" ADD CONSTRAINT "budget_reservation_custom_limit_draws_limit_id_billing_custom_limits_id_fk" FOREIGN KEY ("limit_id") REFERENCES "public"."billing_custom_limits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_reservation_custom_limit_draws" ADD CONSTRAINT "budget_reservation_custom_limit_draws_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_limit_pool_usage" ADD CONSTRAINT "custom_limit_pool_usage_limit_id_billing_custom_limits_id_fk" FOREIGN KEY ("limit_id") REFERENCES "public"."billing_custom_limits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_limit_pool_usage" ADD CONSTRAINT "custom_limit_pool_usage_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_limit_pool_usage" ADD CONSTRAINT "custom_limit_pool_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_reservation_custom_limit_draws_owner_idx" ON "budget_reservation_custom_limit_draws" USING btree ("limit_id","owner_user_id");--> statement-breakpoint
CREATE INDEX "custom_limit_pool_usage_owner_idx" ON "custom_limit_pool_usage" USING btree ("limit_id","owner_user_id","created_at");--> statement-breakpoint
ALTER TABLE "billing_custom_limits" ADD CONSTRAINT "billing_custom_limits_pool_share_check" CHECK ("billing_custom_limits"."pool_share_percent" between 0 and 100);