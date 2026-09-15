CREATE TABLE diagnostic_policy (
 id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
 epoch bigint NOT NULL DEFAULT 0,
 enabled boolean NOT NULL DEFAULT false,
 retention_seconds integer, expired_before timestamptz
);
--> statement-breakpoint
INSERT INTO diagnostic_policy (id, enabled, retention_seconds)
SELECT 1, coalesce((value->>'logDetailedPayloads')::boolean, false),
 CASE value->>'payloadRetention' WHEN '1h' THEN 3600 WHEN '24h' THEN 86400 WHEN '30d' THEN 2592000
 WHEN '90d' THEN 7776000 WHEN 'indefinite' THEN NULL ELSE 604800 END
FROM (SELECT (SELECT value FROM application_settings WHERE key = 'logging') AS value) settings;
--> statement-breakpoint
ALTER TABLE provider_diagnostics ADD COLUMN payload_epoch bigint NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE INDEX provider_diagnostics_retained_idx ON provider_diagnostics (payload_expires_at, id) WHERE request_payload IS NOT NULL OR response_payload IS NOT NULL;
--> statement-breakpoint
CREATE INDEX provider_diagnostics_epoch_idx ON provider_diagnostics (payload_epoch, id) WHERE request_payload IS NOT NULL OR response_payload IS NOT NULL;
--> statement-breakpoint
CREATE INDEX request_logs_retained_idx ON request_logs (payload_expires_at, id) WHERE capture_detailed_payloads OR request_payload IS NOT NULL OR response_payload IS NOT NULL;
--> statement-breakpoint
CREATE INDEX ocr_attempts_retained_idx ON ocr_attempts (request_log_id, id) WHERE request_payload IS NOT NULL OR response_payload IS NOT NULL;
