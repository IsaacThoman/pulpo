CREATE TABLE "billing_custom_limits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"period" text NOT NULL,
	"limit_micros" bigint NOT NULL,
	"model_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target" text NOT NULL,
	"plans" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_custom_limits_period_check" CHECK ("billing_custom_limits"."period" in ('five_hour', 'daily', 'weekly')),
	CONSTRAINT "billing_custom_limits_target_check" CHECK ("billing_custom_limits"."target" in ('everyone', 'plans', 'users')),
	CONSTRAINT "billing_custom_limits_amount_check" CHECK ("billing_custom_limits"."limit_micros" >= 0)
);
--> statement-breakpoint
ALTER TABLE "billing_custom_limits" ADD CONSTRAINT "billing_custom_limits_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;