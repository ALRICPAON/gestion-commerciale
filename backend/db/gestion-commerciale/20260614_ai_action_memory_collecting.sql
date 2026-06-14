ALTER TABLE ai_pending_actions
  DROP CONSTRAINT IF EXISTS ai_pending_actions_status_check;

ALTER TABLE ai_pending_actions
  ADD CONSTRAINT ai_pending_actions_status_check CHECK (
    status IN ('collecting', 'pending', 'confirmed', 'executed', 'cancelled', 'failed')
  );

CREATE INDEX IF NOT EXISTS idx_ai_pending_actions_store_user_status
  ON ai_pending_actions(store_id, user_id, status, created_at DESC);
