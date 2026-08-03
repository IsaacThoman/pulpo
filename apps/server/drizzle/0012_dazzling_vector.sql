ALTER TABLE "attachments" ADD COLUMN "origin" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "source_response_id" uuid;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "source_tool_call_id" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_source_response_id_responses_id_fk" FOREIGN KEY ("source_response_id") REFERENCES "public"."responses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_response_tool_unique" ON "attachments" USING btree ("source_response_id","source_tool_call_id");