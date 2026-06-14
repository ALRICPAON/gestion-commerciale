CREATE TABLE IF NOT EXISTS agent_pending_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  created_by_source text NOT NULL DEFAULT 'chatgpt_business',
  action_type text NOT NULL,
  summary text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT NOW(),
  executed_at timestamptz NULL,
  cancelled_at timestamptz NULL,
  CONSTRAINT agent_pending_actions_status_check
    CHECK (status IN ('pending', 'executed', 'cancelled')),
  CONSTRAINT agent_pending_actions_payload_object_check
    CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_agent_pending_actions_store_status
  ON agent_pending_actions (store_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_pending_actions_store_action_type
  ON agent_pending_actions (store_id, action_type, created_at DESC);
