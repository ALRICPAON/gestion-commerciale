CREATE TABLE IF NOT EXISTS ai_user_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  memory_key text NOT NULL,
  memory_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence_score numeric(4,3) NOT NULL DEFAULT 0.500,
  source text NOT NULL DEFAULT 'update_user_memory',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, user_id, memory_key),
  CONSTRAINT ai_user_memory_confidence_check
    CHECK (confidence_score >= 0 AND confidence_score <= 1),
  CONSTRAINT ai_user_memory_key_check
    CHECK (memory_key IN (
      'work_habits',
      'order_preferences',
      'confirmation_preferences',
      'negoce_preferences',
      'article_habits',
      'pricing_habits'
    ))
);

CREATE INDEX IF NOT EXISTS idx_ai_user_memory_store_user
  ON ai_user_memory(store_id, user_id, updated_at DESC);
