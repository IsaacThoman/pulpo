CREATE TABLE "codex_login_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"user_code" text,
	"verification_uri" text,
	"interval_seconds" integer,
	"expires_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_provider_credentials" (
	"user_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"encrypted_credential" text NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"plan_type" text DEFAULT 'unknown' NOT NULL,
	"last_error" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_provider_credentials_user_id_provider_id_pk" PRIMARY KEY("user_id","provider_id")
);
--> statement-breakpoint
ALTER TABLE "codex_login_attempts" ADD CONSTRAINT "codex_login_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_provider_credentials" ADD CONSTRAINT "user_provider_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "codex_login_attempts_user_status_idx" ON "codex_login_attempts" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "codex_login_attempts_expiry_idx" ON "codex_login_attempts" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "user_provider_credentials_provider_status_idx" ON "user_provider_credentials" USING btree ("provider_id","status");