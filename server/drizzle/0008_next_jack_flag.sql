ALTER TABLE "responses" ADD COLUMN "agent_capacity_action" text;--> statement-breakpoint
ALTER TABLE "workspace_leases" ADD COLUMN "response_id" uuid;--> statement-breakpoint
ALTER TABLE "workspace_leases" ADD COLUMN "capacity_state" text;--> statement-breakpoint
ALTER TABLE "workspace_leases" ADD CONSTRAINT "workspace_leases_response_id_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."responses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_leases_queue_idx" ON "workspace_leases" USING btree ("capacity_state","created_at");
