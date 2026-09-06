ALTER TABLE "queued_messages" ADD COLUMN "request_received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "responses" ADD COLUMN "request_received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "responses" ADD COLUMN "first_reply_text_at" timestamp with time zone;