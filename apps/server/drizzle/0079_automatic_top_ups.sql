CREATE TABLE "auto_top_up_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"settings_revision" integer NOT NULL,
	"customer_id" text NOT NULL,
	"payment_method_id" text NOT NULL,
	"credit_cents" integer NOT NULL,
	"charge_cents" integer NOT NULL,
	"reserved_cents" integer DEFAULT 0 NOT NULL,
	"charged_cents" integer DEFAULT 0 NOT NULL,
	"charged_at" timestamp with time zone,
	"invoice_id" text,
	"status" text DEFAULT 'creating' NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auto_top_up_status_check" CHECK ("auto_top_up_attempts"."status" in ('creating', 'ready', 'paying', 'succeeded', 'failed', 'canceled')),
	CONSTRAINT "auto_top_up_amounts_check" CHECK ("auto_top_up_attempts"."credit_cents" between 500 and 50000 and "auto_top_up_attempts"."charge_cents" > 0 and "auto_top_up_attempts"."reserved_cents" >= 0 and "auto_top_up_attempts"."charged_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "auto_top_up_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"threshold_cents" integer DEFAULT 500 NOT NULL,
	"credit_cents" integer DEFAULT 2500 NOT NULL,
	"monthly_limit_cents" integer DEFAULT 10000 NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"payment_method_id" text,
	"card" jsonb,
	"consent_at" timestamp with time zone,
	"setup_id" uuid,
	"setup_session_id" text,
	"setup_enable" boolean DEFAULT false NOT NULL,
	"paused_reason" text,
	"limit_reached" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auto_top_up_settings_amounts" CHECK ("auto_top_up_settings"."credit_cents" between 500 and 50000 and "auto_top_up_settings"."threshold_cents" > 0 and "auto_top_up_settings"."threshold_cents" <= "auto_top_up_settings"."credit_cents" and "auto_top_up_settings"."monthly_limit_cents" >= ceil(("auto_top_up_settings"."credit_cents" + 50) / 0.95))
);
--> statement-breakpoint
ALTER TABLE "auto_top_up_attempts" ADD CONSTRAINT "auto_top_up_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_top_up_settings" ADD CONSTRAINT "auto_top_up_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auto_top_up_one_active" ON "auto_top_up_attempts" USING btree ("user_id") WHERE "auto_top_up_attempts"."status" in ('creating', 'ready', 'paying');--> statement-breakpoint
CREATE UNIQUE INDEX "auto_top_up_invoice_unique" ON "auto_top_up_attempts" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "auto_top_up_user_charged_idx" ON "auto_top_up_attempts" USING btree ("user_id","charged_at");