-- =========================================
-- PERFORMANCE INDEXES — RAYON V2
-- =========================================

-- =========================================
-- LOTS
-- =========================================

CREATE INDEX IF NOT EXISTS idx_lots_article_department
ON lots(article_id, department_id);

CREATE INDEX IF NOT EXISTS idx_lots_remaining
ON lots(qty_remaining);

CREATE INDEX IF NOT EXISTS idx_lots_created
ON lots(created_at);

CREATE INDEX IF NOT EXISTS idx_lots_department
ON lots(department_id);

-- =========================================
-- STOCK MOVEMENTS
-- =========================================

CREATE INDEX IF NOT EXISTS idx_stock_movements_article
ON stock_movements(article_id);

CREATE INDEX IF NOT EXISTS idx_stock_movements_lot
ON stock_movements(lot_id);

CREATE INDEX IF NOT EXISTS idx_stock_movements_created
ON stock_movements(created_at);

CREATE INDEX IF NOT EXISTS idx_stock_movements_department
ON stock_movements(department_id);

-- =========================================
-- PURCHASES
-- =========================================

CREATE INDEX IF NOT EXISTS idx_purchases_department
ON purchases(department_id);

CREATE INDEX IF NOT EXISTS idx_purchases_delivery_date
ON purchases(delivery_date);

CREATE INDEX IF NOT EXISTS idx_purchases_supplier
ON purchases(supplier_id);

CREATE INDEX IF NOT EXISTS idx_purchases_status
ON purchases(status);

-- =========================================
-- PURCHASE LINES
-- =========================================

CREATE INDEX IF NOT EXISTS idx_purchase_lines_purchase
ON purchase_lines(purchase_id);

CREATE INDEX IF NOT EXISTS idx_purchase_lines_article
ON purchase_lines(article_id);

