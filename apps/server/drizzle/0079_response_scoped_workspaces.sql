DROP INDEX "workspace_leases_chat_active_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_leases_response_active_unique" ON "workspace_leases" USING btree ("response_id") WHERE "workspace_leases"."status" in ('provisioning', 'ready');--> statement-breakpoint
CREATE INDEX "workspace_leases_response_idx" ON "workspace_leases" USING btree ("response_id");--> statement-breakpoint
CREATE INDEX "workspace_leases_chat_idx" ON "workspace_leases" USING btree ("chat_id");