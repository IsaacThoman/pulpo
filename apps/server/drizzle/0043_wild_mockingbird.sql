ALTER TABLE "queued_messages" ADD COLUMN "billing_user_id" uuid;--> statement-breakpoint
ALTER TABLE "queued_messages" ADD COLUMN "actor_user_id" uuid;--> statement-breakpoint
ALTER TABLE "request_logs" ADD COLUMN "actor_user_id" uuid;--> statement-breakpoint
ALTER TABLE "queued_messages" ADD CONSTRAINT "queued_messages_billing_user_id_users_id_fk" FOREIGN KEY ("billing_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queued_messages" ADD CONSTRAINT "queued_messages_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_logs" ADD CONSTRAINT "request_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;