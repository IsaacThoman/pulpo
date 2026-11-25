CREATE TABLE "signup_promo_claims" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"amount_micros" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signup_promo_claims_amount_check" CHECK ("signup_promo_claims"."amount_micros" > 0)
);
--> statement-breakpoint
ALTER TABLE "signup_promo_claims" ADD CONSTRAINT "signup_promo_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "signup_promo_claims_user_unique" ON "signup_promo_claims" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "signup_promo_claims_created_idx" ON "signup_promo_claims" USING btree ("created_at");