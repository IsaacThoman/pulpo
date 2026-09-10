ALTER TABLE "speech_models" ADD COLUMN "voice_previews" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
UPDATE speech_models SET voice_previews = jsonb_build_array(jsonb_build_object(
  'voiceId', config->>'defaultVoice', 'objectKey', preview_object_key,
  'contentType', preview_content_type, 'checksum', preview_checksum
)), preview_object_key = NULL, preview_content_type = NULL, preview_checksum = NULL
WHERE preview_object_key IS NOT NULL;
