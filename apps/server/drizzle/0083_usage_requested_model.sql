ALTER TABLE "usage_events" ADD COLUMN "requested_model_id" text;--> statement-breakpoint
UPDATE "usage_events" AS "usage"
SET "requested_model_id" = "log"."requested_model_id"
FROM "request_logs" AS "log"
WHERE "log"."response_id" = "usage"."response_id";--> statement-breakpoint
UPDATE "usage_events" AS "usage"
SET "requested_model_id" = "response"."model_id"
FROM "responses" AS "response"
WHERE "usage"."requested_model_id" IS NULL AND "response"."id" = "usage"."response_id";--> statement-breakpoint
-- Purging a chat removed its request logs, leaving only the responder on the
-- usage event. A hidden model that is the fallback of exactly one model is
-- attributed to the start of that fallback chain.
WITH RECURSIVE "sole_source" AS (
  SELECT "target"."id" AS "model_id", min("source"."id") AS "source_id"
  FROM "models" AS "target"
  JOIN "models" AS "source" ON "source"."fallback_model_id" = "target"."id" AND "source"."id" <> "target"."id"
  WHERE "target"."visible" = false
  GROUP BY "target"."id"
  HAVING count(*) = 1
), "chain" AS (
  SELECT "model_id", "source_id", 1 AS "depth" FROM "sole_source"
  UNION ALL
  SELECT "chain"."model_id", "sole_source"."source_id", "chain"."depth" + 1
  FROM "chain"
  JOIN "sole_source" ON "sole_source"."model_id" = "chain"."source_id"
  WHERE "chain"."depth" < 8
), "root" AS (
  SELECT DISTINCT ON ("model_id") "model_id", "source_id"
  FROM "chain"
  ORDER BY "model_id", "depth" DESC
)
UPDATE "usage_events" AS "usage"
SET "requested_model_id" = "root"."source_id"
FROM "root"
WHERE "usage"."requested_model_id" IS NULL AND "usage"."response_id" IS NULL AND "root"."model_id" = "usage"."model_id";--> statement-breakpoint
UPDATE "usage_events" SET "requested_model_id" = "model_id" WHERE "requested_model_id" IS NULL;--> statement-breakpoint
ALTER TABLE "usage_events" ALTER COLUMN "requested_model_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_requested_model_id_models_id_fk" FOREIGN KEY ("requested_model_id") REFERENCES "public"."models"("id") ON DELETE no action ON UPDATE no action;
