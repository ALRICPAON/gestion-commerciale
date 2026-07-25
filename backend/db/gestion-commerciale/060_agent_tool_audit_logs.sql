CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS agent_tool_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  user_id uuid NULL,
  conversation_id text NULL,
  request_id text NULL,
  tool_name text NOT NULL,
  domain text NOT NULL,
  risk_level integer NOT NULL CHECK (risk_level BETWEEN 0 AND 3),
  input_summary text NULL,
  input_payload jsonb NULL,
  output_summary text NULL,
  target_type text NULL,
  target_id text NULL,
  pending_action_id uuid NULL,
  status text NOT NULL DEFAULT 'running',
  error_code text NULL,
  error_message text NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_tool_audit_logs_store_created
  ON agent_tool_audit_logs(store_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_tool_audit_logs_tool
  ON agent_tool_audit_logs(store_id, tool_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_tool_audit_logs_pending
  ON agent_tool_audit_logs(store_id, pending_action_id)
  WHERE pending_action_id IS NOT NULL;

ALTER TABLE agent_pending_actions
  ADD COLUMN IF NOT EXISTS domain text,
  ADD COLUMN IF NOT EXISTS final_tool_name text,
  ADD COLUMN IF NOT EXISTS frozen_payload jsonb,
  ADD COLUMN IF NOT EXISTS human_summary text,
  ADD COLUMN IF NOT EXISTS impact_summary text,
  ADD COLUMN IF NOT EXISTS target_objects jsonb,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS payload_hash text,
  ADD COLUMN IF NOT EXISTS execution_result jsonb,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_pending_actions_idempotency
  ON agent_pending_actions(store_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
