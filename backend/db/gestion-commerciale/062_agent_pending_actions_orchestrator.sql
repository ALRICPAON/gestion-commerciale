ALTER TABLE agent_pending_actions
  DROP CONSTRAINT IF EXISTS agent_pending_actions_status_check;

ALTER TABLE agent_pending_actions
  ADD CONSTRAINT agent_pending_actions_status_check
  CHECK (status IN (
    'pending',
    'prepared',
    'awaiting_confirmation',
    'executing',
    'executed',
    'failed',
    'cancelled'
  ));

ALTER TABLE agent_pending_actions
  ADD COLUMN IF NOT EXISTS module text,
  ADD COLUMN IF NOT EXISTS confirmed_payload_hash text,
  ADD COLUMN IF NOT EXISTS business_result jsonb,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_agent_pending_actions_orchestrator_status
  ON agent_pending_actions(store_id, status, created_at DESC);
