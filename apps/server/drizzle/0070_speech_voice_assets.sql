CREATE TABLE "speech_resource_cleanup" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider_connection_id" uuid,
	"upstream_voice_id" text,
	"slug" text,
	"object_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ready_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "speech_models" ADD COLUMN "voice_assets" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "speech_resource_cleanup" ADD CONSTRAINT "speech_resource_cleanup_provider_connection_id_provider_connections_id_fk" FOREIGN KEY ("provider_connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE restrict ON UPDATE no action;