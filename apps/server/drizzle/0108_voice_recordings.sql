CREATE TABLE "file_recording_clips" (
	"id" uuid PRIMARY KEY NOT NULL,
	"node_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"object_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"checksum" text,
	"duration_ms" integer NOT NULL,
	"levels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"skips" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"transcript_status" text NOT NULL,
	"transcript" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"transcript_error" text,
	"recorded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_recording_clips_size_check" CHECK ("file_recording_clips"."size_bytes" >= 0),
	CONSTRAINT "file_recording_clips_duration_check" CHECK ("file_recording_clips"."duration_ms" > 0),
	CONSTRAINT "file_recording_clips_transcript_status_check" CHECK ("file_recording_clips"."transcript_status" in ('pending', 'ready', 'failed', 'unavailable'))
);
--> statement-breakpoint
ALTER TABLE "file_nodes" DROP CONSTRAINT "file_nodes_kind_check";--> statement-breakpoint
ALTER TABLE "file_recording_clips" ADD CONSTRAINT "file_recording_clips_node_id_file_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."file_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_recording_clips" ADD CONSTRAINT "file_recording_clips_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "file_recording_clips_node_position_unique" ON "file_recording_clips" USING btree ("node_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "file_recording_clips_object_key_unique" ON "file_recording_clips" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "file_recording_clips_user_idx" ON "file_recording_clips" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "file_nodes" ADD CONSTRAINT "file_nodes_kind_check" CHECK ("file_nodes"."kind" in ('folder', 'doc', 'blob', 'shortcut', 'recording'));