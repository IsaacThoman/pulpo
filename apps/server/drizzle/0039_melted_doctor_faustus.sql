CREATE TABLE "budget_reservation_funders" (
	"reservation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reserved_micros" bigint NOT NULL,
	"settled_micros" bigint,
	CONSTRAINT "budget_reservation_funders_reservation_id_user_id_pk" PRIMARY KEY("reservation_id","user_id"),
	CONSTRAINT "budget_reservation_funders_amount_check" CHECK ("budget_reservation_funders"."reserved_micros" >= 0 and ("budget_reservation_funders"."settled_micros" is null or "budget_reservation_funders"."settled_micros" >= 0))
);
--> statement-breakpoint
CREATE TABLE "pool_invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pool_id" uuid NOT NULL,
	"inviter_user_id" uuid NOT NULL,
	"invitee_user_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"inviter_disclosure_accepted_at" timestamp with time zone NOT NULL,
	"invitee_disclosure_accepted_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pool_invitations_status_check" CHECK ("pool_invitations"."status" in ('pending', 'accepted', 'declined', 'canceled'))
);
--> statement-breakpoint
CREATE TABLE "pool_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pool_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pools" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD COLUMN "pool_id" uuid;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "pool_balance_after_micros" bigint;--> statement-breakpoint
ALTER TABLE "budget_reservation_funders" ADD CONSTRAINT "budget_reservation_funders_reservation_id_budget_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."budget_reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_reservation_funders" ADD CONSTRAINT "budget_reservation_funders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
INSERT INTO "budget_reservation_funders" ("reservation_id", "user_id", "reserved_micros", "settled_micros")
SELECT "id", "user_id", "balance_reserved_micros",
  CASE WHEN "status" = 'settled' THEN coalesce("settled_balance_micros", 0) ELSE NULL END
FROM "budget_reservations"
WHERE "balance_reserved_micros" > 0;--> statement-breakpoint
ALTER TABLE "pool_invitations" ADD CONSTRAINT "pool_invitations_pool_id_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."pools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_invitations" ADD CONSTRAINT "pool_invitations_inviter_user_id_users_id_fk" FOREIGN KEY ("inviter_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_invitations" ADD CONSTRAINT "pool_invitations_invitee_user_id_users_id_fk" FOREIGN KEY ("invitee_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_members" ADD CONSTRAINT "pool_members_pool_id_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."pools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_members" ADD CONSTRAINT "pool_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pools" ADD CONSTRAINT "pools_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_reservation_funders_user_idx" ON "budget_reservation_funders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "pool_invitations_invitee_status_idx" ON "pool_invitations" USING btree ("invitee_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "pool_invitations_pool_invitee_pending_unique" ON "pool_invitations" USING btree ("pool_id","invitee_user_id") WHERE "pool_invitations"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "pool_members_pool_active_idx" ON "pool_members" USING btree ("pool_id","left_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pool_members_user_active_unique" ON "pool_members" USING btree ("user_id") WHERE "pool_members"."left_at" is null;--> statement-breakpoint
CREATE INDEX "pools_owner_idx" ON "pools" USING btree ("owner_user_id");--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD CONSTRAINT "budget_reservations_pool_id_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."pools"("id") ON DELETE set null ON UPDATE no action;
