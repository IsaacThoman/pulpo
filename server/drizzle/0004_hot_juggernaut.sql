CREATE TABLE "backup_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"object_key" text,
	"original_name" text,
	"error" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_import_sources" (
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_chat_id" text NOT NULL,
	"chat_id" uuid NOT NULL,
	"fingerprint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_import_sources_user_id_source_source_chat_id_pk" PRIMARY KEY("user_id","source","source_chat_id")
);
--> statement-breakpoint
CREATE TABLE "generation_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_log_id" uuid NOT NULL,
	"model_id" text NOT NULL,
	"attempt" integer NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"retry_reason" text,
	"fallback_from_model_id" text,
	"upstream_response_id" text,
	"error_category" text,
	"error_message" text,
	"first_token_ms" integer,
	"duration_ms" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ocr_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_log_id" uuid NOT NULL,
	"attachment_id" uuid,
	"source_checksum" text,
	"provider_id" uuid,
	"model_id" text,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"cached" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"request_payload" jsonb,
	"response_payload" jsonb,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ocr_cache_entries" (
	"checksum" text PRIMARY KEY NOT NULL,
	"provider_fingerprint" text NOT NULL,
	"text" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"response_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"api_key_id" uuid,
	"origin" text DEFAULT 'web' NOT NULL,
	"status" "response_status" DEFAULT 'queued' NOT NULL,
	"requested_model_id" text NOT NULL,
	"actual_model_id" text,
	"current_model_id" text,
	"current_attempt" integer DEFAULT 0 NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"fallback_used" boolean DEFAULT false NOT NULL,
	"sticky_fallback_used" boolean DEFAULT false NOT NULL,
	"ocr_status" text DEFAULT 'not_requested' NOT NULL,
	"error_category" text,
	"error_message" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"tokens_per_second" double precision,
	"event_count" integer DEFAULT 0 NOT NULL,
	"request_payload" jsonb,
	"response_payload" jsonb,
	"payload_expires_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "visible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "logo" text;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "system_prompt" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "default_parameters" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "intercept_images_with_ocr" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "max_retries" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "retry_delay_seconds" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "sticky_fallback_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "first_token_timeout_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "first_token_timeout_seconds" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "slow_sticky_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "slow_sticky_min_tokens_per_second" double precision DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "slow_sticky_min_completion_seconds" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "responses" ADD COLUMN "actual_model_id" text;--> statement-breakpoint
ALTER TABLE "responses" ADD COLUMN "origin" text DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "backup_jobs" ADD CONSTRAINT "backup_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_import_sources" ADD CONSTRAINT "chat_import_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_import_sources" ADD CONSTRAINT "chat_import_sources_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD CONSTRAINT "generation_attempts_request_log_id_request_logs_id_fk" FOREIGN KEY ("request_log_id") REFERENCES "public"."request_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD CONSTRAINT "generation_attempts_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD CONSTRAINT "generation_attempts_fallback_from_model_id_models_id_fk" FOREIGN KEY ("fallback_from_model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocr_attempts" ADD CONSTRAINT "ocr_attempts_request_log_id_request_logs_id_fk" FOREIGN KEY ("request_log_id") REFERENCES "public"."request_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocr_attempts" ADD CONSTRAINT "ocr_attempts_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocr_attempts" ADD CONSTRAINT "ocr_attempts_provider_id_provider_connections_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."provider_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_logs" ADD CONSTRAINT "request_logs_response_id_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_logs" ADD CONSTRAINT "request_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_logs" ADD CONSTRAINT "request_logs_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_logs" ADD CONSTRAINT "request_logs_requested_model_id_models_id_fk" FOREIGN KEY ("requested_model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_logs" ADD CONSTRAINT "request_logs_actual_model_id_models_id_fk" FOREIGN KEY ("actual_model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_logs" ADD CONSTRAINT "request_logs_current_model_id_models_id_fk" FOREIGN KEY ("current_model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_import_fingerprint_idx" ON "chat_import_sources" USING btree ("user_id","source","fingerprint");--> statement-breakpoint
CREATE INDEX "generation_attempts_log_idx" ON "generation_attempts" USING btree ("request_log_id","started_at");--> statement-breakpoint
CREATE INDEX "ocr_cache_expiry_idx" ON "ocr_cache_entries" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "request_logs_response_unique" ON "request_logs" USING btree ("response_id");--> statement-breakpoint
CREATE INDEX "request_logs_created_idx" ON "request_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "request_logs_status_idx" ON "request_logs" USING btree ("status");--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_actual_model_id_models_id_fk" FOREIGN KEY ("actual_model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;