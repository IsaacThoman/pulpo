ALTER TABLE "api_keys" RENAME COLUMN "revoked_at" TO "disabled_at";--> statement-breakpoint
ALTER TYPE "public"."api_key_status" RENAME VALUE 'revoked' TO 'disabled';
