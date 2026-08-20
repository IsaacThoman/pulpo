CREATE TABLE "invite_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"created_by_user_id" uuid,
	"owner_user_id" uuid,
	"redeemed_by_user_id" uuid,
	"redeemed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "invite_code_quota" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_redeemed_by_user_id_users_id_fk" FOREIGN KEY ("redeemed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invite_codes_code_unique" ON "invite_codes" USING btree (lower("code"));--> statement-breakpoint
CREATE INDEX "invite_codes_owner_idx" ON "invite_codes" USING btree ("owner_user_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_invite_code_quota_check" CHECK ("users"."invite_code_quota" >= 0);