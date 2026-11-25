CREATE TABLE "search_auth_codes" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"source_session_id" uuid NOT NULL,
	"pkce_challenge" text NOT NULL,
	"search_origin" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budget_reservations" ALTER COLUMN "response_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "search_auth_codes" ADD CONSTRAINT "search_auth_codes_source_session_id_sessions_id_fk" FOREIGN KEY ("source_session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "search_auth_codes_expiry_idx" ON "search_auth_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "search_auth_codes_session_idx" ON "search_auth_codes" USING btree ("source_session_id");--> statement-breakpoint
CREATE INDEX "reservation_standalone_pending_idx" ON "budget_reservations" USING btree ("created_at") WHERE "budget_reservations"."response_id" is null and "budget_reservations"."status" = 'pending';