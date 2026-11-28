CREATE TABLE "search_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"category" text NOT NULL,
	"page" integer DEFAULT 1 NOT NULL,
	"outcome" text NOT NULL,
	"provider" text,
	"fallback" boolean DEFAULT false NOT NULL,
	"result_count" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer NOT NULL,
	"phases" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"query_length" integer DEFAULT 0 NOT NULL,
	"filters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "search_requests" ADD CONSTRAINT "search_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "search_requests_created_idx" ON "search_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "search_requests_user_idx" ON "search_requests" USING btree ("user_id");