-- Model choices still equal to the current new-account defaults become null so they follow future default changes.
WITH "defaults" AS (
	SELECT
		CASE WHEN jsonb_typeof(s."value"->'newAccountModelDefaults'->'favoriteModelIds') = 'array'
			THEN s."value"->'newAccountModelDefaults'->'favoriteModelIds' ELSE '[]'::jsonb END AS "favorite_model_ids",
		nullif(s."value"->'newAccountModelDefaults'->>'defaultModelId', '') AS "default_model_id"
	FROM (SELECT 1) AS "one"
	LEFT JOIN "application_settings" AS s ON s."key" = 'auth'
)
UPDATE "user_preferences" AS p
SET "values" = p."values"
	|| CASE WHEN p."values"->'favoriteModelIds' = d."favorite_model_ids"
		THEN '{"favoriteModelIds":null}'::jsonb ELSE '{}'::jsonb END
	|| CASE WHEN nullif(p."values"->>'defaultModelId', '') IS NOT DISTINCT FROM d."default_model_id"
		THEN '{"defaultModelId":null}'::jsonb ELSE '{}'::jsonb END
FROM "defaults" AS d
WHERE p."values"->'favoriteModelIds' = d."favorite_model_ids"
	OR nullif(p."values"->>'defaultModelId', '') IS NOT DISTINCT FROM d."default_model_id";
