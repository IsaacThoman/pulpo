ALTER TABLE "request_logs" ADD COLUMN "capture_detailed_payloads" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$
DECLARE
	logging_enabled boolean := false;
	retention text := '7d';
	retention_interval interval;
BEGIN
	SELECT
		COALESCE(("value"->>'logDetailedPayloads')::boolean, false),
		COALESCE("value"->>'payloadRetention', '7d')
	INTO logging_enabled, retention
	FROM "application_settings"
	WHERE "key" = 'logging';
	logging_enabled := COALESCE(logging_enabled, false);
	retention := COALESCE(retention, '7d');

	UPDATE "request_logs" AS "log"
	SET "capture_detailed_payloads" = true
	WHERE logging_enabled
		AND (
			"log"."request_payload" IS NOT NULL
			OR "log"."response_payload" IS NOT NULL
			OR EXISTS (
				SELECT 1 FROM "ocr_attempts" AS "ocr"
				WHERE "ocr"."request_log_id" = "log"."id"
					AND ("ocr"."request_payload" IS NOT NULL OR "ocr"."response_payload" IS NOT NULL)
			)
		);

	IF NOT logging_enabled THEN
		UPDATE "request_logs"
		SET "request_payload" = NULL, "response_payload" = NULL, "payload_expires_at" = NULL;
		UPDATE "ocr_attempts" SET "request_payload" = NULL, "response_payload" = NULL;
	ELSIF retention = 'indefinite' THEN
		UPDATE "request_logs"
		SET "payload_expires_at" = NULL
		WHERE "capture_detailed_payloads" = true;
	ELSE
		retention_interval := CASE retention
			WHEN '1h' THEN interval '1 hour'
			WHEN '24h' THEN interval '24 hours'
			WHEN '30d' THEN interval '30 days'
			WHEN '90d' THEN interval '90 days'
			ELSE interval '7 days'
		END;
		UPDATE "request_logs"
		SET "payload_expires_at" = "created_at" + retention_interval
		WHERE "capture_detailed_payloads" = true;
		UPDATE "request_logs"
		SET "capture_detailed_payloads" = false, "request_payload" = NULL, "response_payload" = NULL
		WHERE "capture_detailed_payloads" = true AND "payload_expires_at" <= CURRENT_TIMESTAMP;
		UPDATE "ocr_attempts" AS "ocr"
		SET "request_payload" = NULL, "response_payload" = NULL
		FROM "request_logs" AS "log"
		WHERE "ocr"."request_log_id" = "log"."id" AND "log"."capture_detailed_payloads" = false;
	END IF;
END $$;--> statement-breakpoint
CREATE INDEX "request_logs_payload_expiry_idx" ON "request_logs" USING btree ("payload_expires_at");
