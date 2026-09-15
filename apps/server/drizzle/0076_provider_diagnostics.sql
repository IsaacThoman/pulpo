CREATE TABLE provider_diagnostics (
 id uuid PRIMARY KEY,
 request_log_id uuid CONSTRAINT provider_diagnostics_request_log_id_request_logs_id_fk REFERENCES request_logs(id) ON DELETE CASCADE,
 user_id uuid NOT NULL CONSTRAINT provider_diagnostics_user_id_users_id_fk REFERENCES users(id) ON DELETE CASCADE,
 model_call_id uuid, operation_id text, purpose text NOT NULL,
 provider_id text, model_id text, upstream_model_id text,
 status text NOT NULL DEFAULT 'in_progress', metadata jsonb NOT NULL DEFAULT '{}',
 request_payload text, response_payload text,
 capture_detailed_payloads boolean NOT NULL DEFAULT false,
 payload_expires_at timestamptz, retention_started_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX provider_diagnostics_log_idx ON provider_diagnostics(request_log_id, created_at);
--> statement-breakpoint
CREATE INDEX provider_diagnostics_expiry_idx ON provider_diagnostics(payload_expires_at);
--> statement-breakpoint
CREATE INDEX provider_diagnostics_created_idx ON provider_diagnostics(created_at);
