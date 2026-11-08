-- Root application routes take precedence over /:username profiles. Move any existing
-- collisions to the same pulpo<number> fallback used for accounts without usernames.
DO $$
DECLARE
	"account" record;
	"candidate" text;
BEGIN
	FOR "account" IN
		SELECT "id"
		FROM "users"
		WHERE lower("username") IN (
			'account-deletion', 'admin', 'api', 'api-keys', 'assets', 'attachments',
			'billing', 'c', 'files', 'forgot-password', 'friends', 'health', 'login',
			'mobile', 'pending', 'privacy', 'ready', 'reset-password', 'setup', 'share',
			'signup', 'support', 'usage', 'v1'
		)
		ORDER BY "id"
	LOOP
		LOOP
			"candidate" := 'pulpo' || ((floor(random() * 2147483647) + 1)::bigint)::text;
			EXIT WHEN NOT EXISTS (
				SELECT 1 FROM "users" WHERE lower("username") = "candidate"
			);
		END LOOP;

		UPDATE "users"
		SET "username" = "candidate",
			"updated_at" = now(),
			"state_revision" = "state_revision" + 1
		WHERE "id" = "account"."id";
	END LOOP;
END $$;
