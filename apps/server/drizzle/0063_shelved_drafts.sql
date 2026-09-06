ALTER TABLE "attachments" ADD COLUMN "shelved_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE "shelf_operations" (
	"user_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	CONSTRAINT "shelf_operations_user_id_operation_id_pk" PRIMARY KEY("user_id","operation_id")
);
--> statement-breakpoint
CREATE TABLE "shelved_draft_attachments" (
	"draft_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	CONSTRAINT "shelved_draft_attachments_draft_id_attachment_id_pk" PRIMARY KEY("draft_id","attachment_id")
);
--> statement-breakpoint
CREATE TABLE "shelved_drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"content" text NOT NULL,
	"attachment_data" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shelf_operations" ADD CONSTRAINT "shelf_operations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shelved_draft_attachments" ADD CONSTRAINT "shelved_draft_attachments_draft_id_shelved_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."shelved_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shelved_draft_attachments" ADD CONSTRAINT "shelved_draft_attachments_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shelved_drafts" ADD CONSTRAINT "shelved_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shelf_attachment_reference" ON "shelved_draft_attachments" USING btree ("attachment_id");--> statement-breakpoint
CREATE INDEX "shelved_drafts_account_order" ON "shelved_drafts" USING btree ("user_id","position");
--> statement-breakpoint
CREATE TRIGGER reject_deleted_account_work BEFORE INSERT ON shelved_drafts FOR EACH ROW EXECUTE FUNCTION pulpo_reject_deleted_account_work('user_id');
--> statement-breakpoint
CREATE TRIGGER reject_deleted_account_work BEFORE INSERT ON shelf_operations FOR EACH ROW EXECUTE FUNCTION pulpo_reject_deleted_account_work('user_id');
