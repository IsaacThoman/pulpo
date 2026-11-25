CREATE TABLE "signup_promo_claims" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"amount_cents" integer NOT NULL,
	"claimed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "signup_promo_claims_amount_check" CHECK ("signup_promo_claims"."amount_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "signed_up" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "signup_promo_claims" ADD CONSTRAINT "signup_promo_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "signup_promo_claims_user_idx" ON "signup_promo_claims" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "signup_promo_claims_claimed_at_idx" ON "signup_promo_claims" USING btree ("claimed_at");