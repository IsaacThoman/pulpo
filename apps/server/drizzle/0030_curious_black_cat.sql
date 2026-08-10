DROP INDEX "users_username_unique";--> statement-breakpoint
DO $$
DECLARE
	target_id uuid;
	candidate text;
BEGIN
	FOR target_id IN SELECT "id" FROM "users" WHERE "username" IS NULL ORDER BY "id" LOOP
		LOOP
			candidate := 'pulpo' || (floor(random() * 2147483646) + 1)::bigint::text;
			EXIT WHEN NOT EXISTS (SELECT 1 FROM "users" WHERE lower("username") = candidate);
		END LOOP;
		UPDATE "users" SET "username" = candidate WHERE "id" = target_id;
	END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_unique" ON "users" USING btree (lower("username"));
