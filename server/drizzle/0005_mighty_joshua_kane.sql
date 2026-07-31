ALTER TABLE "responses" ADD COLUMN "user_message_id" uuid;--> statement-breakpoint
UPDATE "responses" AS r
SET "user_message_id" = (
  SELECT s."id"
  FROM "responses" AS s
  WHERE s."chat_id" = r."chat_id"
    AND s."parent_response_id" IS NOT DISTINCT FROM r."parent_response_id"
    AND s."input" = r."input"
  ORDER BY s."created_at", s."id"
  LIMIT 1
);--> statement-breakpoint
ALTER TABLE "responses" ADD COLUMN "deleted_at" timestamp with time zone;
