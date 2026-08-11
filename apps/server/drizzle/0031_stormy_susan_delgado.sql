DO $$
BEGIN
	CREATE TYPE "public"."friendship_status" AS ENUM('pending', 'accepted');
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "friendships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_a_id" uuid NOT NULL,
	"user_b_id" uuid NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"status" "friendship_status" DEFAULT 'pending' NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friendships_ordered_pair_check" CHECK ("friendships"."user_a_id" < "friendships"."user_b_id"),
	CONSTRAINT "friendships_requester_member_check" CHECK ("friendships"."requested_by_user_id" in ("friendships"."user_a_id", "friendships"."user_b_id"))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_blocks" (
	"blocker_user_id" uuid NOT NULL,
	"blocked_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_blocks_blocker_user_id_blocked_user_id_pk" PRIMARY KEY("blocker_user_id","blocked_user_id"),
	CONSTRAINT "user_blocks_not_self_check" CHECK ("user_blocks"."blocker_user_id" <> "user_blocks"."blocked_user_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "username" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "profile_color" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_object_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'friendships_user_a_id_users_id_fk') THEN
		ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_a_id_users_id_fk" FOREIGN KEY ("user_a_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'friendships_user_b_id_users_id_fk') THEN
		ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_b_id_users_id_fk" FOREIGN KEY ("user_b_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'friendships_requested_by_user_id_users_id_fk') THEN
		ALTER TABLE "friendships" ADD CONSTRAINT "friendships_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_blocks_blocker_user_id_users_id_fk') THEN
		ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocker_user_id_users_id_fk" FOREIGN KEY ("blocker_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_blocks_blocked_user_id_users_id_fk') THEN
		ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocked_user_id_users_id_fk" FOREIGN KEY ("blocked_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "friendships_pair_unique" ON "friendships" USING btree ("user_a_id","user_b_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "friendships_user_a_status_idx" ON "friendships" USING btree ("user_a_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "friendships_user_b_status_idx" ON "friendships" USING btree ("user_b_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_blocks_blocked_idx" ON "user_blocks" USING btree ("blocked_user_id");--> statement-breakpoint
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
CREATE UNIQUE INDEX IF NOT EXISTS "users_username_unique" ON "users" USING btree (lower("username"));--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "leaderboard_visible";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "leaderboard_color";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "nickname";
