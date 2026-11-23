ALTER TABLE "workspace_leases" ADD COLUMN IF NOT EXISTS "screen_billed_until" timestamp with time zone;
