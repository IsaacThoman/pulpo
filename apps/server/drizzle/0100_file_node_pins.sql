ALTER TABLE "file_nodes" ADD COLUMN "pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "file_nodes_owner_pinned_idx" ON "file_nodes" USING btree ("owner_user_id") WHERE "file_nodes"."pinned";--> statement-breakpoint
ALTER TABLE "file_nodes" ADD CONSTRAINT "file_nodes_pinned_check" CHECK (not "file_nodes"."pinned" or "file_nodes"."system_role" is distinct from 'chats');