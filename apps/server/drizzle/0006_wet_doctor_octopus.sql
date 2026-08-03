CREATE TABLE "provider_upstream_models" (
	"provider_connection_id" uuid NOT NULL,
	"model_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_upstream_models_provider_connection_id_model_id_pk" PRIMARY KEY("provider_connection_id","model_id")
);
--> statement-breakpoint
ALTER TABLE "provider_connections" ADD COLUMN "upstream_models_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "provider_upstream_models" ADD CONSTRAINT "provider_upstream_models_provider_connection_id_provider_connections_id_fk" FOREIGN KEY ("provider_connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_upstream_models_provider_idx" ON "provider_upstream_models" USING btree ("provider_connection_id");