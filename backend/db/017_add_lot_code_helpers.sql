BEGIN;

-- =========================================================
-- 1) TABLE DE SEQUENCE POUR LES LOTS
-- =========================================================

-- Cette table sert à gérer le compteur N dans :
-- {PLU}-{AA}{JJJ}-{FOUR}-{N}

CREATE TABLE IF NOT EXISTS lot_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL,
  article_id UUID NOT NULL,
  supplier_id UUID NOT NULL,
  year SMALLINT NOT NULL,
  day_of_year SMALLINT NOT NULL,
  current_value INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),

  UNIQUE (store_id, article_id, supplier_id, year, day_of_year)
);

CREATE INDEX IF NOT EXISTS idx_lot_sequences_lookup
  ON lot_sequences(store_id, article_id, supplier_id, year, day_of_year);

-- =========================================================
-- 2) FONCTION : JOUR DE L’ANNÉE
-- =========================================================

CREATE OR REPLACE FUNCTION get_day_of_year(input_date DATE)
RETURNS INTEGER AS $$
BEGIN
  RETURN EXTRACT(DOY FROM input_date);
END;
$$ LANGUAGE plpgsql;

-- =========================================================
-- 3) FONCTION : ANNEE COURTE (AA)
-- =========================================================

CREATE OR REPLACE FUNCTION get_short_year(input_date DATE)
RETURNS INTEGER AS $$
BEGIN
  RETURN EXTRACT(YEAR FROM input_date) % 100;
END;
$$ LANGUAGE plpgsql;

-- =========================================================
-- 4) FONCTION : GENERER LE PROCHAIN INDEX DE LOT
-- =========================================================

CREATE OR REPLACE FUNCTION get_next_lot_sequence(
  p_store_id UUID,
  p_article_id UUID,
  p_supplier_id UUID,
  p_date DATE
)
RETURNS INTEGER AS $$
DECLARE
  v_year INTEGER;
  v_day INTEGER;
  v_current INTEGER;
BEGIN
  v_year := get_short_year(p_date);
  v_day := get_day_of_year(p_date);

  LOOP
    -- essayer de récupérer et incrémenter
    UPDATE lot_sequences
    SET current_value = current_value + 1
    WHERE store_id = p_store_id
      AND article_id = p_article_id
      AND supplier_id = p_supplier_id
      AND year = v_year
      AND day_of_year = v_day
    RETURNING current_value INTO v_current;

    IF FOUND THEN
      RETURN v_current;
    END IF;

    -- sinon on crée la ligne
    BEGIN
      INSERT INTO lot_sequences (
        store_id,
        article_id,
        supplier_id,
        year,
        day_of_year,
        current_value
      )
      VALUES (
        p_store_id,
        p_article_id,
        p_supplier_id,
        v_year,
        v_day,
        1
      )
      RETURNING current_value INTO v_current;

      RETURN v_current;

    EXCEPTION WHEN unique_violation THEN
      -- quelqu’un a créé la ligne en même temps → on boucle
    END;

  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- =========================================================
-- 5) COMMENTAIRES METIER
-- =========================================================

COMMENT ON TABLE lot_sequences IS 'Compteur de génération des codes lots par article / fournisseur / jour';
COMMENT ON FUNCTION get_next_lot_sequence IS 'Retourne le prochain index N pour le code lot';

COMMIT;