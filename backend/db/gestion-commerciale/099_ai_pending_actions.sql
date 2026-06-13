CREATE TABLE IF NOT EXISTS ai_pending_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  user_id uuid NOT NULL,
  action_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  executed_at timestamptz,
  CONSTRAINT ai_pending_actions_status_check CHECK (
    status IN ('pending', 'confirmed', 'executed', 'cancelled', 'failed')
  )
);

CREATE INDEX IF NOT EXISTS idx_ai_pending_actions_store_status
  ON ai_pending_actions(store_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_pending_actions_user_status
  ON ai_pending_actions(user_id, status, created_at DESC);
