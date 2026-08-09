CREATE TABLE "management_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"secret_hash" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "management_tokens" ADD CONSTRAINT "management_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "management_token_prefix_unique" ON "management_tokens" USING btree ("prefix");--> statement-breakpoint
CREATE INDEX "management_tokens_user_idx" ON "management_tokens" USING btree ("user_id");
--> statement-breakpoint
DELETE FROM "application_settings" WHERE "key" = 'publicUrl';
