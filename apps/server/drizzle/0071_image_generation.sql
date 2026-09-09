CREATE TABLE "image_generation_requests" (
	"response_id" uuid NOT NULL,
	"operation_id" text NOT NULL,
	"status" text DEFAULT 'claimed' NOT NULL,
	"model" jsonb NOT NULL,
	"attachment_id" uuid,
	"result" jsonb,
	"billed_cost_micros" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "image_generation_requests_response_id_operation_id_pk" PRIMARY KEY("response_id","operation_id")
);
--> statement-breakpoint
CREATE TABLE "image_models" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_connection_id" uuid NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "image_generation_requests" ADD CONSTRAINT "image_generation_requests_response_id_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_generation_requests" ADD CONSTRAINT "image_generation_requests_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_models" ADD CONSTRAINT "image_models_provider_connection_id_provider_connections_id_fk" FOREIGN KEY ("provider_connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE restrict ON UPDATE no action;