DROP INDEX "workspace_leases_chat_active_unique";--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "workspace_scope_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "responses" ADD COLUMN "workspace_scope_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_leases" ADD COLUMN "workspace_scope_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_leases_scope_active_unique" ON "workspace_leases" USING btree ("workspace_scope_id") WHERE "workspace_leases"."status" in ('provisioning', 'ready');