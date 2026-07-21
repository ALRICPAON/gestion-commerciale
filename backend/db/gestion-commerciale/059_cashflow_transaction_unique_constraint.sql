DO $$
BEGIN
  IF to_regclass('public.cashflow_bank_transactions') IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM cashflow_bank_transactions t
  USING (
    SELECT ctid
    FROM (
      SELECT
        ctid,
        ROW_NUMBER() OVER (
          PARTITION BY store_id, pennylane_transaction_id
          ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
        ) AS duplicate_rank
      FROM cashflow_bank_transactions
      WHERE pennylane_transaction_id IS NOT NULL
    ) ranked
    WHERE ranked.duplicate_rank > 1
  ) duplicate_rows
  WHERE t.ctid = duplicate_rows.ctid;

  DROP INDEX IF EXISTS cashflow_bank_transactions_pennylane_uidx;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cashflow_bank_transactions_store_pennylane_uidx'
      AND conrelid = 'cashflow_bank_transactions'::regclass
  ) THEN
    ALTER TABLE cashflow_bank_transactions
      ADD CONSTRAINT cashflow_bank_transactions_store_pennylane_uidx
      UNIQUE (store_id, pennylane_transaction_id);
  END IF;
END $$;
