ALTER TABLE "labs" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Preserve the current picker order: labs appear where their first model appears in the catalog.
WITH "ranked" AS (
	SELECT l."id", row_number() OVER (
		ORDER BY m."sort_order" ASC NULLS LAST, m."created_at" ASC NULLS LAST, l."created_at" ASC
	) - 1 AS "position"
	FROM "labs" AS l
	LEFT JOIN LATERAL (
		SELECT "sort_order", "created_at" FROM "models"
		WHERE "lab_id" = l."id"
		ORDER BY "sort_order" ASC, "created_at" ASC
		LIMIT 1
	) AS m ON true
)
UPDATE "labs" SET "sort_order" = "ranked"."position"
FROM "ranked" WHERE "labs"."id" = "ranked"."id";
