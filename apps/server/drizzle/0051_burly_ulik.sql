CREATE TABLE "user_memory_document_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"content" text NOT NULL,
	"editor" text NOT NULL,
	"edit_summary" text NOT NULL,
	"source_response_id" uuid,
	"version_created_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_memory_document_revisions_content_length_check" CHECK (char_length("user_memory_document_revisions"."content") <= 16000),
	CONSTRAINT "user_memory_document_revisions_revision_check" CHECK ("user_memory_document_revisions"."revision" >= 0),
	CONSTRAINT "user_memory_document_revisions_editor_check" CHECK ("user_memory_document_revisions"."editor" in ('user', 'agent'))
);
--> statement-breakpoint
CREATE TABLE "user_memory_documents" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"last_editor" text DEFAULT 'user' NOT NULL,
	"edit_summary" text DEFAULT 'Created memory document' NOT NULL,
	"source_response_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_memory_documents_content_length_check" CHECK (char_length("user_memory_documents"."content") <= 16000),
	CONSTRAINT "user_memory_documents_revision_check" CHECK ("user_memory_documents"."revision" >= 0),
	CONSTRAINT "user_memory_documents_editor_check" CHECK ("user_memory_documents"."last_editor" in ('user', 'agent'))
);
--> statement-breakpoint
DROP TABLE "saved_memory_embeddings";--> statement-breakpoint
DROP TABLE "memories";--> statement-breakpoint
ALTER TABLE "user_memory_document_revisions" ADD CONSTRAINT "user_memory_document_revisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memory_document_revisions" ADD CONSTRAINT "user_memory_document_revisions_source_response_id_responses_id_fk" FOREIGN KEY ("source_response_id") REFERENCES "public"."responses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memory_documents" ADD CONSTRAINT "user_memory_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memory_documents" ADD CONSTRAINT "user_memory_documents_source_response_id_responses_id_fk" FOREIGN KEY ("source_response_id") REFERENCES "public"."responses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_memory_document_revisions_user_revision_unique" ON "user_memory_document_revisions" USING btree ("user_id","revision");--> statement-breakpoint
CREATE INDEX "user_memory_document_revisions_user_superseded_idx" ON "user_memory_document_revisions" USING btree ("user_id","superseded_at");
