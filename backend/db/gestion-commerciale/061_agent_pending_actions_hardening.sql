ALTER TABLE agent_pending_actions
  ADD COLUMN IF NOT EXISTS risk_level integer,
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS confirmed_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_agent_pending_actions_final_tool
  ON agent_pending_actions(store_id, final_tool_name, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_pending_actions_expires
  ON agent_pending_actions(store_id, expires_at)
  WHERE status = 'pending';
