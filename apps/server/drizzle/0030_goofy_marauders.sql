CREATE TABLE "mobile_passkey_auth_codes" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"pkce_challenge" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passkey_ceremonies" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"challenge" text NOT NULL,
	"flow" text NOT NULL,
	"user_id" uuid,
	"initiating_session_id" uuid,
	"name" text,
	"expected_origin" text NOT NULL,
	"rp_id" text NOT NULL,
	"pkce_challenge" text,
	"state" text,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_passkey_credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"credential_id" text NOT NULL,
	"credential_public_key" text NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean DEFAULT false NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mobile_passkey_auth_codes" ADD CONSTRAINT "mobile_passkey_auth_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey_ceremonies" ADD CONSTRAINT "passkey_ceremonies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey_ceremonies" ADD CONSTRAINT "passkey_ceremonies_initiating_session_id_sessions_id_fk" FOREIGN KEY ("initiating_session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_passkey_credentials" ADD CONSTRAINT "user_passkey_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mobile_passkey_auth_codes_expiry_idx" ON "mobile_passkey_auth_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "passkey_ceremonies_user_idx" ON "passkey_ceremonies" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "passkey_ceremonies_expiry_idx" ON "passkey_ceremonies" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_passkey_credentials_credential_unique" ON "user_passkey_credentials" USING btree ("credential_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_passkey_credentials_name_unique" ON "user_passkey_credentials" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE INDEX "user_passkey_credentials_user_idx" ON "user_passkey_credentials" USING btree ("user_id");