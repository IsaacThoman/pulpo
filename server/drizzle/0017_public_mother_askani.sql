ALTER TABLE "models" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
WITH "ranked_models" AS (
	SELECT "id", row_number() OVER (PARTITION BY "lab_id" ORDER BY "created_at", "id") - 1 AS "position"
	FROM "models"
)
UPDATE "models"
SET "sort_order" = "ranked_models"."position"
FROM "ranked_models"
WHERE "models"."id" = "ranked_models"."id";
