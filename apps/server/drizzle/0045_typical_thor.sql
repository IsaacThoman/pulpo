CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "chat_turn_embeddings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"generation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"chat_id" uuid NOT NULL,
	"response_id" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"chunk_text" text NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("chunk_text", ''))) STORED NOT NULL,
	"embedding" halfvec,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"indexed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_turn_embeddings_status_check" CHECK ("chat_turn_embeddings"."status" in ('pending', 'ready', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "episodic_memory_generations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile" text NOT NULL,
	"model" text NOT NULL,
	"model_digest" text,
	"dimension" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"download_total_bytes" bigint DEFAULT 0 NOT NULL,
	"download_completed_bytes" bigint DEFAULT 0 NOT NULL,
	"total_items" integer DEFAULT 0 NOT NULL,
	"completed_items" integer DEFAULT 0 NOT NULL,
	"failed_items" integer DEFAULT 0 NOT NULL,
	"error" text,
	"cancel_requested_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "episodic_memory_generations_profile_check" CHECK ("episodic_memory_generations"."profile" in ('embeddinggemma', 'qwen3-embedding')),
	CONSTRAINT "episodic_memory_generations_dimension_check" CHECK ("episodic_memory_generations"."dimension" in (768, 1024)),
	CONSTRAINT "episodic_memory_generations_status_check" CHECK ("episodic_memory_generations"."status" in ('pending', 'pulling', 'indexing', 'ready', 'failed', 'cancelled')),
	CONSTRAINT "episodic_memory_generations_progress_check" CHECK ("episodic_memory_generations"."download_total_bytes" >= 0 and "episodic_memory_generations"."download_completed_bytes" >= 0 and "episodic_memory_generations"."total_items" >= 0 and "episodic_memory_generations"."completed_items" >= 0 and "episodic_memory_generations"."failed_items" >= 0)
);
--> statement-breakpoint
CREATE TABLE "episodic_memory_metric_buckets" (
	"bucket_start" timestamp with time zone NOT NULL,
	"metric" text NOT NULL,
	"event_count" bigint DEFAULT 0 NOT NULL,
	"error_count" bigint DEFAULT 0 NOT NULL,
	"fallback_count" bigint DEFAULT 0 NOT NULL,
	"recalled_count" bigint DEFAULT 0 NOT NULL,
	"abstained_count" bigint DEFAULT 0 NOT NULL,
	"item_count" bigint DEFAULT 0 NOT NULL,
	"duration_sum_ms" bigint DEFAULT 0 NOT NULL,
	"duration_min_ms" integer DEFAULT 0 NOT NULL,
	"duration_max_ms" integer DEFAULT 0 NOT NULL,
	"duration_le_10" bigint DEFAULT 0 NOT NULL,
	"duration_le_25" bigint DEFAULT 0 NOT NULL,
	"duration_le_50" bigint DEFAULT 0 NOT NULL,
	"duration_le_100" bigint DEFAULT 0 NOT NULL,
	"duration_le_250" bigint DEFAULT 0 NOT NULL,
	"duration_le_500" bigint DEFAULT 0 NOT NULL,
	"duration_le_1000" bigint DEFAULT 0 NOT NULL,
	"duration_le_2500" bigint DEFAULT 0 NOT NULL,
	"duration_le_5000" bigint DEFAULT 0 NOT NULL,
	"duration_gt_5000" bigint DEFAULT 0 NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "episodic_memory_metric_buckets_bucket_start_metric_pk" PRIMARY KEY("bucket_start","metric"),
	CONSTRAINT "episodic_memory_metric_buckets_metric_check" CHECK ("episodic_memory_metric_buckets"."metric" in ('automatic_recall', 'retrieval', 'database_search', 'embedding', 'indexing', 'agent_search', 'agent_read')),
	CONSTRAINT "episodic_memory_metric_buckets_counts_check" CHECK ("episodic_memory_metric_buckets"."event_count" >= 0 and "episodic_memory_metric_buckets"."error_count" >= 0 and "episodic_memory_metric_buckets"."fallback_count" >= 0 and "episodic_memory_metric_buckets"."recalled_count" >= 0 and "episodic_memory_metric_buckets"."abstained_count" >= 0 and "episodic_memory_metric_buckets"."item_count" >= 0 and "episodic_memory_metric_buckets"."duration_sum_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "saved_memory_embeddings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"generation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"memory_id" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"content_text" text NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("content_text", ''))) STORED NOT NULL,
	"embedding" halfvec,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"indexed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_memory_embeddings_status_check" CHECK ("saved_memory_embeddings"."status" in ('pending', 'ready', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "chat_turn_embeddings" ADD CONSTRAINT "chat_turn_embeddings_generation_id_episodic_memory_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."episodic_memory_generations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_turn_embeddings" ADD CONSTRAINT "chat_turn_embeddings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_turn_embeddings" ADD CONSTRAINT "chat_turn_embeddings_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_turn_embeddings" ADD CONSTRAINT "chat_turn_embeddings_response_id_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_memory_embeddings" ADD CONSTRAINT "saved_memory_embeddings_generation_id_episodic_memory_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."episodic_memory_generations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_memory_embeddings" ADD CONSTRAINT "saved_memory_embeddings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_memory_embeddings" ADD CONSTRAINT "saved_memory_embeddings_memory_id_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_turn_embeddings_generation_response_unique" ON "chat_turn_embeddings" USING btree ("generation_id","response_id");--> statement-breakpoint
CREATE INDEX "chat_turn_embeddings_user_generation_idx" ON "chat_turn_embeddings" USING btree ("user_id","generation_id");--> statement-breakpoint
CREATE INDEX "chat_turn_embeddings_chat_idx" ON "chat_turn_embeddings" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "chat_turn_embeddings_search_idx" ON "chat_turn_embeddings" USING gin ("search_vector");--> statement-breakpoint
CREATE UNIQUE INDEX "episodic_memory_generations_active_unique" ON "episodic_memory_generations" USING btree ("active") WHERE "episodic_memory_generations"."active" = true;--> statement-breakpoint
CREATE INDEX "episodic_memory_generations_status_idx" ON "episodic_memory_generations" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "episodic_memory_metric_buckets_metric_time_idx" ON "episodic_memory_metric_buckets" USING btree ("metric","bucket_start");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_memory_embeddings_generation_memory_unique" ON "saved_memory_embeddings" USING btree ("generation_id","memory_id");--> statement-breakpoint
CREATE INDEX "saved_memory_embeddings_user_generation_idx" ON "saved_memory_embeddings" USING btree ("user_id","generation_id");--> statement-breakpoint
CREATE INDEX "saved_memory_embeddings_search_idx" ON "saved_memory_embeddings" USING gin ("search_vector");
