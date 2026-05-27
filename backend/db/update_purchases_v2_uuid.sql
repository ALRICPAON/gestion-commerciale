BEGIN;

-- =========================================================
-- EXTENSION UUID
-- =========================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================================================
-- PURCHASES
-- =========================================================

CREATE TABLE IF NOT EXISTS purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
    department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
    supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,

    purchase_date DATE NOT NULL,
    document_number VARCHAR(120),
    document_type VARCHAR(30) NOT NULL DEFAULT 'manual',
    source_type VARCHAR(30) NOT NULL DEFAULT 'manual',
    status VARCHAR(20) NOT NULL DEFAULT 'draft',

    currency VARCHAR(10) NOT NULL DEFAULT 'EUR',
    notes TEXT,

    total_amount_ex_vat NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_amount_inc_vat NUMERIC(12,2) NOT NULL DEFAULT 0,

    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    validated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    validated_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (document_type IN ('delivery_note', 'invoice', 'auction_slip', 'manual')),
    CHECK (source_type IN ('manual', 'import', 'api')),
    CHECK (status IN ('draft', 'validated', 'cancelled'))
);

-- =========================================================
-- PURCHASE LINES
-- =========================================================

CREATE TABLE IF NOT EXISTS purchase_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    purchase_id UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,

    store_id UUID NOT NULL REFERENCES stores(id),
    department_id UUID NOT NULL REFERENCES departments(id),
    supplier_id UUID NOT NULL REFERENCES suppliers(id),

    line_number INTEGER NOT NULL,

    supplier_article_mapping_id UUID,
    article_id UUID REFERENCES articles(id),

    supplier_reference VARCHAR(120),
    supplier_label VARCHAR(255),

    received_quantity NUMERIC(12,3) NOT NULL,
    stock_quantity NUMERIC(12,3) NOT NULL,

    unit_price_ex_vat NUMERIC(12,4) NOT NULL,
    vat_rate NUMERIC(5,2) DEFAULT 0,

    line_amount_ex_vat NUMERIC(12,2),
    line_amount_inc_vat NUMERIC(12,2),

    batch_number_supplier VARCHAR(120),
    origin_country VARCHAR(120),

    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    lot_id UUID,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CHECK (status IN ('draft', 'validated', 'cancelled'))
);

-- =========================================================
-- METADATA
-- =========================================================

CREATE TABLE IF NOT EXISTS purchase_line_metadata (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    purchase_line_id UUID NOT NULL REFERENCES purchase_lines(id) ON DELETE CASCADE,
    meta_key VARCHAR(100) NOT NULL,
    meta_value TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================================
-- TRIGGER updated_at
-- =========================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_purchases_updated
BEFORE UPDATE ON purchases
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_purchase_lines_updated
BEFORE UPDATE ON purchase_lines
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =========================================================
-- CALCUL AUTO LIGNE
-- =========================================================

CREATE OR REPLACE FUNCTION compute_line_amounts()
RETURNS TRIGGER AS $$
BEGIN
    NEW.line_amount_ex_vat := ROUND(NEW.received_quantity * NEW.unit_price_ex_vat, 2);
    NEW.line_amount_inc_vat := ROUND(NEW.line_amount_ex_vat * (1 + NEW.vat_rate / 100), 2);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_compute_line_amounts
BEFORE INSERT OR UPDATE ON purchase_lines
FOR EACH ROW EXECUTE FUNCTION compute_line_amounts();

-- =========================================================
-- RECALCUL TOTAL PURCHASE
-- =========================================================

CREATE OR REPLACE FUNCTION recalc_purchase_totals()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE purchases
    SET
        total_amount_ex_vat = (
            SELECT COALESCE(SUM(line_amount_ex_vat), 0)
            FROM purchase_lines
            WHERE purchase_id = NEW.purchase_id
        ),
        total_amount_inc_vat = (
            SELECT COALESCE(SUM(line_amount_inc_vat), 0)
            FROM purchase_lines
            WHERE purchase_id = NEW.purchase_id
        )
    WHERE id = NEW.purchase_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_recalc_purchase
AFTER INSERT OR UPDATE OR DELETE ON purchase_lines
FOR EACH ROW EXECUTE FUNCTION recalc_purchase_totals();

-- =========================================================
-- VERROUILLAGE SI VALIDÉ
-- =========================================================

CREATE OR REPLACE FUNCTION block_if_validated()
RETURNS TRIGGER AS $$
DECLARE
    v_status VARCHAR;
BEGIN
    SELECT status INTO v_status FROM purchases WHERE id = NEW.purchase_id;

    IF v_status = 'validated' THEN
        RAISE EXCEPTION 'Modification impossible : purchase validé';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_block_lines_if_validated
BEFORE UPDATE OR DELETE ON purchase_lines
FOR EACH ROW EXECUTE FUNCTION block_if_validated();

COMMIT;