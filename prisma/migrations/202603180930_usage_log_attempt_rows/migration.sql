ALTER TABLE "UsageLog"
DROP CONSTRAINT IF EXISTS "UsageLog_requestId_key";

ALTER TABLE "UsageLog"
ADD COLUMN IF NOT EXISTS "isRetryAttempt" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "UsageLog_requestId_createdAt_idx"
ON "UsageLog"("requestId", "createdAt");
