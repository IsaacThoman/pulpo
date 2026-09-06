DROP INDEX "chat_turn_embeddings_generation_response_unique";--> statement-breakpoint
ALTER TABLE "chat_turn_embeddings" ADD COLUMN "chunk_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "episodic_memory_generations" ADD COLUMN "index_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX "chats_title_search_idx" ON "chats" USING gin (to_tsvector('simple', "title"));--> statement-breakpoint
CREATE UNIQUE INDEX "chat_turn_embeddings_generation_response_unique" ON "chat_turn_embeddings" USING btree ("generation_id","response_id","chunk_index");