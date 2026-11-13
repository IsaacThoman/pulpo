ALTER TABLE "budget_reservations" DROP CONSTRAINT "budget_reservations_api_key_id_api_keys_id_fk";
--> statement-breakpoint
ALTER TABLE "usage_events" DROP CONSTRAINT "usage_events_api_key_id_api_keys_id_fk";
--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD CONSTRAINT "budget_reservations_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_api_key_created_idx" ON "usage_events" USING btree ("api_key_id","created_at") WHERE "usage_events"."api_key_id" is not null;