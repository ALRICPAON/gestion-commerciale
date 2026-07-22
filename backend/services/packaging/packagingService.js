const STOCK_OUT_TYPES = new Set(['conditioning_out', 'loss', 'destruction']);
const STOCK_IN_TYPES = new Set(['purchase_in']);
const RETURNABLE_IN_TYPES = new Set(['deposit_receipt']);
const RETURNABLE_OUT_TYPES = new Set(['return', 'supplier_credit_note', 'loss', 'breakage']);
const MANUAL_STOCK_MOVEMENT_TYPES = new Set([
  'purchase_in',
  'inventory_adjustment',
  'loss',
  'destruction',
  'manual_correction',
]);

function clean(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

function parseDecimal(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function assertFinite(value, label) {
  if (!Number.isFinite(Number(value))) {
    const error = new Error(`${label} invalide`);
    error.status = 400;
    throw error;
  }
}

function assertPositive(value, label) {
  assertFinite(value, label);
  if (Number(value) <= 0) {
    const error = new Error(`${label} doit etre strictement positif`);
    error.status = 400;
    throw error;
  }
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function normalizePackagingItemInput(input = {}) {
  const code = clean(input.code);
  const designation = clean(input.designation);
  const category = clean(input.category) || 'consumable';
  const allowedCategories = ['consumable', 'returnable', 'reusable_internal'];

  if (!code || !designation) {
    const error = new Error('Code et designation emballage obligatoires');
    error.status = 400;
    throw error;
  }

  if (!allowedCategories.includes(category)) {
    const error = new Error('Categorie emballage invalide');
    error.status = 400;
    throw error;
  }

  const currentUnitCostExVat = parseDecimal(input.current_unit_cost_ex_vat, 0);
  const depositUnitValue = parseDecimal(input.deposit_unit_value, 0);
  const alertThreshold = parseDecimal(input.alert_threshold, 0);

  assertFinite(currentUnitCostExVat, 'Cout unitaire HT');
  assertFinite(depositUnitValue, 'Valeur de consigne');
  assertFinite(alertThreshold, 'Seuil alerte');

  if (currentUnitCostExVat < 0 || depositUnitValue < 0 || alertThreshold < 0) {
    const error = new Error('Les montants et seuils doivent etre positifs');
    error.status = 400;
    throw error;
  }

  return {
    code,
    designation,
    category,
    management_unit: clean(input.management_unit) || 'unit',
    format_label: clean(input.format_label),
    primary_supplier_id: clean(input.primary_supplier_id),
    current_unit_cost_ex_vat: currentUnitCostExVat,
    deposit_unit_value: depositUnitValue,
    alert_threshold: alertThreshold,
    active: input.active === undefined ? true : Boolean(input.active),
  };
}

function signedQuantityForStockMovement(type, quantity) {
  const parsed = parseDecimal(quantity);
  assertFinite(parsed, 'Quantite mouvement');

  if (parsed === 0) {
    const error = new Error('Quantite mouvement ne peut pas etre nulle');
    error.status = 400;
    throw error;
  }

  if (STOCK_OUT_TYPES.has(type)) return -Math.abs(parsed);
  if (STOCK_IN_TYPES.has(type)) return Math.abs(parsed);
  if (type === 'inventory_adjustment' || type === 'manual_correction') return parsed;

  assertPositive(parsed, 'Quantite mouvement');

  const error = new Error('Type de mouvement emballage invalide');
  error.status = 400;
  throw error;
}

function computeProfileConsumption({ components = [], packageCount, productQuantityKg }) {
  const packages = Number(packageCount);
  const kilograms = Number(productQuantityKg);
  assertPositive(packages, 'Nombre de colis');
  assertPositive(kilograms, 'Quantite produit');

  return components.map((component) => {
    const baseQuantity = Number(component.quantity);
    assertPositive(baseQuantity, 'Quantite composant');

    let quantity = baseQuantity;
    if (component.consumption_rule === 'per_package') quantity = baseQuantity * packages;
    if (component.consumption_rule === 'per_kg') quantity = baseQuantity * kilograms;
    if (component.consumption_rule === 'fixed_per_operation') quantity = baseQuantity;

    return {
      ...component,
      quantity: round(quantity, 3),
      unit_cost_ex_vat: Number(component.unit_cost_ex_vat || component.current_unit_cost_ex_vat || 0),
    };
  });
}

function computePackagingCosts({
  lines = [],
  productQuantityKg,
  packageCount,
  productCostBeforePackaging = 0,
}) {
  const kilograms = Number(productQuantityKg);
  const packages = Number(packageCount);
  assertPositive(kilograms, 'Quantite produit');
  assertPositive(packages, 'Nombre de colis');

  const costLines = lines.map((line) => {
    const quantity = Number(line.quantity);
    const unitCost = Number(line.unit_cost_ex_vat || line.current_unit_cost_ex_vat || 0);
    assertFinite(quantity, 'Quantite ligne');
    assertFinite(unitCost, 'Cout ligne');
    const totalCost = line.category === 'returnable' || line.is_deposit_line ? 0 : quantity * unitCost;
    return {
      ...line,
      quantity: round(quantity, 3),
      unit_cost_ex_vat: round(unitCost, 4),
      total_cost_ex_vat: round(totalCost, 4),
    };
  });

  const total = costLines.reduce((sum, line) => sum + Number(line.total_cost_ex_vat || 0), 0);
  const productCost = Number(productCostBeforePackaging || 0);

  return {
    lines: costLines,
    packaging_cost_total_ex_vat: round(total, 4),
    packaging_cost_per_package: round(total / packages, 4),
    packaging_cost_per_kg: round(total / kilograms, 4),
    product_cost_before_packaging: round(productCost, 4),
    cost_after_packaging_per_kg: round(productCost + total / kilograms, 4),
  };
}

function assertSufficientStock(lines, stocksByItemId) {
  const missing = [];

  lines.forEach((line) => {
    const category = line.category;
    if (category === 'returnable') return;
    const currentStock = Number(stocksByItemId.get(String(line.packaging_item_id)) || 0);
    const needed = Number(line.quantity || 0);
    if (currentStock < needed) {
      missing.push({
        packaging_item_id: line.packaging_item_id,
        designation: line.designation,
        current_stock: currentStock,
        required_quantity: needed,
      });
    }
  });

  if (missing.length) {
    const error = new Error('Stock emballage insuffisant');
    error.status = 409;
    error.details = missing;
    throw error;
  }
}

function assertOperationCanBeValidated(operation) {
  if (!operation || operation.status !== 'draft') {
    const error = new Error('Operation deja validee ou indisponible');
    error.status = 409;
    throw error;
  }
}

function signedQuantityForReturnableMovement(type, quantity) {
  const parsed = parseDecimal(quantity);
  assertPositive(Math.abs(parsed), 'Quantite consigne');

  if (RETURNABLE_IN_TYPES.has(type)) return Math.abs(parsed);
  if (RETURNABLE_OUT_TYPES.has(type)) return -Math.abs(parsed);
  if (type === 'adjustment') return parsed;

  const error = new Error('Type de mouvement consigne invalide');
  error.status = 400;
  throw error;
}

function reverseStockMovementType(type) {
  if (!MANUAL_STOCK_MOVEMENT_TYPES.has(type) && type !== 'conditioning_out') {
    const error = new Error('Type de mouvement emballage invalide');
    error.status = 400;
    throw error;
  }
  return 'manual_correction';
}

function assertCancellationReason(reason) {
  const value = clean(reason);
  if (!value) {
    const error = new Error('Justification obligatoire pour annuler un mouvement');
    error.status = 400;
    throw error;
  }
  return value;
}

function assertStockMovementCanBeCancelled(movement) {
  if (!movement) {
    const error = new Error('Mouvement emballage introuvable');
    error.status = 404;
    throw error;
  }

  if (movement.cancelled_at || movement.reversal_movement_id) {
    const error = new Error('Mouvement emballage deja annule');
    error.status = 409;
    throw error;
  }

  if (movement.source_table === 'packaging_operations') {
    const error = new Error(
      'Ce mouvement provient d une operation de conditionnement validee. Corrige ou annule l operation source.'
    );
    error.status = 409;
    throw error;
  }
}

function assertStockMovementCanBeDeleted(movement) {
  if (!movement) {
    const error = new Error('Mouvement emballage introuvable');
    error.status = 404;
    throw error;
  }

  if (movement?.source_table === 'packaging_operations') {
    const error = new Error(
      'Suppression directe bloquee : corrige ou annule l operation de conditionnement source.'
    );
    error.status = 409;
    throw error;
  }

  const error = new Error('Suppression physique non autorisee. Utilise l annulation par mouvement inverse.');
  error.status = 409;
  throw error;
}

async function getStockMovementAuditColumns(db) {
  const result = await db.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'packaging_stock_movements'
      AND column_name IN ('cancelled_at', 'cancelled_by', 'cancellation_reason', 'reversal_movement_id')
    `
  );

  return new Set(result.rows.map((row) => row.column_name));
}

function requireStockMovementAuditColumns(columns) {
  const missing = ['cancelled_at', 'cancelled_by', 'cancellation_reason', 'reversal_movement_id']
    .filter((column) => !columns.has(column));

  if (missing.length) {
    const error = new Error(`Migration 061 non appliquee pour les annulations emballages: ${missing.join(', ')}`);
    error.status = 409;
    error.details = { missing_columns: missing };
    throw error;
  }
}

function summarizeReturnableMovements(movements = []) {
  const balances = new Map();

  movements.forEach((movement) => {
    const itemId = String(movement.packaging_item_id);
    const supplierId = String(movement.supplier_id || 'none');
    const key = `${itemId}:${supplierId}`;
    const quantity = signedQuantityForReturnableMovement(movement.movement_type, movement.quantity);
    const existing = balances.get(key) || {
      packaging_item_id: movement.packaging_item_id,
      supplier_id: movement.supplier_id || null,
      designation: movement.designation,
      supplier_name: movement.supplier_name,
      balance_quantity: 0,
      deposit_unit_value: Number(movement.deposit_unit_value || 0),
      deposit_balance_value: 0,
    };

    existing.balance_quantity = round(existing.balance_quantity + quantity, 3);
    existing.deposit_unit_value = Number(movement.deposit_unit_value || existing.deposit_unit_value || 0);
    existing.deposit_balance_value = round(existing.balance_quantity * existing.deposit_unit_value, 4);
    balances.set(key, existing);
  });

  return Array.from(balances.values());
}

function filterRowsByStore(rows = [], storeId) {
  return rows.filter((row) => String(row.store_id) === String(storeId));
}

function assertNoDuplicatePackagingComponents(components = []) {
  const seen = new Set();
  for (const component of components) {
    const packagingItemId = clean(component.packaging_item_id);
    if (!packagingItemId) {
      const error = new Error('Emballage obligatoire sur chaque ligne du modele');
      error.status = 400;
      throw error;
    }
    if (seen.has(packagingItemId)) {
      const error = new Error('Un emballage ne peut pas etre ajoute deux fois au meme modele');
      error.status = 400;
      throw error;
    }
    seen.add(packagingItemId);
  }
}

function estimateProfileCostPerPackage(components = []) {
  return round(
    components.reduce((sum, component) => (
      sum + Number(component.quantity || 0) * Number(component.current_unit_cost_ex_vat || component.unit_cost_ex_vat || 0)
    ), 0),
    4
  );
}

async function withTransaction(db, callback) {
  const client = await db.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function mapRows(result) {
  return result.rows || [];
}

async function listItems(db, storeId, filters = {}) {
  const params = [storeId];
  const where = ['pi.store_id = $1'];

  if (filters.active !== undefined) {
    params.push(filters.active === true || filters.active === 'true');
    where.push(`pi.active = $${params.length}`);
  }

  if (filters.category) {
    params.push(filters.category);
    where.push(`pi.category = $${params.length}`);
  }

  if (filters.search) {
    params.push(`%${String(filters.search).trim()}%`);
    where.push(`(pi.code ILIKE $${params.length} OR pi.designation ILIKE $${params.length})`);
  }

  const result = await db.query(
    `
    SELECT
      pi.*,
      s.name AS supplier_name
    FROM packaging_items pi
    LEFT JOIN suppliers s ON s.id = pi.primary_supplier_id AND s.store_id = pi.store_id
    WHERE ${where.join(' AND ')}
    ORDER BY pi.active DESC, pi.category ASC, pi.code ASC
    `,
    params
  );

  return mapRows(result);
}

async function createItem(db, storeId, userId, input) {
  const item = normalizePackagingItemInput(input);

  const result = await db.query(
    `
    INSERT INTO packaging_items (
      store_id, code, designation, category, management_unit, format_label,
      primary_supplier_id, current_unit_cost_ex_vat, deposit_unit_value,
      alert_threshold, active, created_by, updated_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
    RETURNING *
    `,
    [
      storeId,
      item.code,
      item.designation,
      item.category,
      item.management_unit,
      item.format_label,
      item.primary_supplier_id,
      item.current_unit_cost_ex_vat,
      item.deposit_unit_value,
      item.alert_threshold,
      item.active,
      userId,
    ]
  );

  return result.rows[0];
}

async function updateItem(db, storeId, itemId, userId, input) {
  const item = normalizePackagingItemInput(input);

  const result = await db.query(
    `
    UPDATE packaging_items
    SET
      code = $3,
      designation = $4,
      category = $5,
      management_unit = $6,
      format_label = $7,
      primary_supplier_id = $8,
      current_unit_cost_ex_vat = $9,
      deposit_unit_value = $10,
      alert_threshold = $11,
      active = $12,
      updated_by = $13,
      updated_at = now()
    WHERE id = $1
      AND store_id = $2
    RETURNING *
    `,
    [
      itemId,
      storeId,
      item.code,
      item.designation,
      item.category,
      item.management_unit,
      item.format_label,
      item.primary_supplier_id,
      item.current_unit_cost_ex_vat,
      item.deposit_unit_value,
      item.alert_threshold,
      item.active,
      userId,
    ]
  );

  return result.rows[0] || null;
}

async function recordStockMovement(db, storeId, userId, input) {
  return withTransaction(db, async (client) => {
    const signedQuantity = signedQuantityForStockMovement(input.movement_type, input.quantity);
    const itemResult = await client.query(
      `
      SELECT *
      FROM packaging_items
      WHERE id = $1
        AND store_id = $2
      FOR UPDATE
      `,
      [input.packaging_item_id, storeId]
    );

    const item = itemResult.rows[0];
    if (!item) {
      const error = new Error('Emballage introuvable');
      error.status = 404;
      throw error;
    }

    if (Number(item.current_stock) + signedQuantity < 0) {
      const error = new Error('Stock emballage insuffisant');
      error.status = 409;
      throw error;
    }

    const movement = await client.query(
      `
      INSERT INTO packaging_stock_movements (
        store_id, packaging_item_id, movement_type, quantity, unit_cost_ex_vat,
        source_table, source_id, movement_date, notes, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::date, CURRENT_DATE), $9, $10)
      RETURNING *
      `,
      [
        storeId,
        input.packaging_item_id,
        input.movement_type,
        signedQuantity,
        parseDecimal(input.unit_cost_ex_vat, item.current_unit_cost_ex_vat || 0),
        clean(input.source_table),
        clean(input.source_id),
        clean(input.movement_date),
        clean(input.notes),
        userId,
      ]
    );

    const updated = await client.query(
      `
      UPDATE packaging_items
      SET current_stock = current_stock + $3,
          updated_by = $4,
          updated_at = now()
      WHERE id = $1
        AND store_id = $2
      RETURNING *
      `,
      [input.packaging_item_id, storeId, signedQuantity, userId]
    );

    return { movement: movement.rows[0], item: updated.rows[0] };
  });
}

async function listStockMovements(db, storeId, filters = {}) {
  const auditColumns = await getStockMovementAuditColumns(db);
  const hasCancelledAt = auditColumns.has('cancelled_at');
  const hasCancelledBy = auditColumns.has('cancelled_by');
  const hasCancellationReason = auditColumns.has('cancellation_reason');
  const hasReversalMovementId = auditColumns.has('reversal_movement_id');
  const params = [storeId];
  const where = ['psm.store_id = $1'];

  if (filters.packaging_item_id) {
    params.push(filters.packaging_item_id);
    where.push(`psm.packaging_item_id = $${params.length}`);
  }

  if (filters.id) {
    params.push(filters.id);
    where.push(`psm.id = $${params.length}`);
  }

  const result = await db.query(
    `
    SELECT
      psm.id,
      psm.store_id,
      psm.packaging_item_id,
      psm.movement_type,
      psm.quantity,
      psm.unit_cost_ex_vat,
      psm.source_table,
      psm.source_id,
      psm.movement_date,
      psm.notes,
      psm.created_by,
      psm.created_at,
      ${hasCancelledAt ? 'psm.cancelled_at' : 'NULL::timestamptz AS cancelled_at'},
      ${hasCancelledBy ? 'psm.cancelled_by' : 'NULL::uuid AS cancelled_by'},
      ${hasCancellationReason ? 'psm.cancellation_reason' : 'NULL::text AS cancellation_reason'},
      ${hasReversalMovementId ? 'psm.reversal_movement_id' : 'NULL::uuid AS reversal_movement_id'},
      pi.code,
      pi.designation,
      pi.management_unit,
      ${hasCancelledAt ? "CASE WHEN psm.cancelled_at IS NULL THEN 'active' ELSE 'cancelled' END" : "'active'"} AS status,
      creator.email AS created_by_email,
      ${hasCancelledBy ? 'canceller.email' : 'NULL::text'} AS cancelled_by_email
    FROM packaging_stock_movements psm
    JOIN packaging_items pi ON pi.id = psm.packaging_item_id AND pi.store_id = psm.store_id
    LEFT JOIN users creator ON creator.id = psm.created_by
    ${hasCancelledBy ? 'LEFT JOIN users canceller ON canceller.id = psm.cancelled_by' : ''}
    WHERE ${where.join(' AND ')}
    ORDER BY psm.movement_date DESC, psm.created_at DESC
    LIMIT $${params.length + 1}
    `,
    [...params, Math.min(Number(filters.limit) || 100, 300)]
  );

  return mapRows(result);
}

async function cancelStockMovement(db, storeId, userId, movementId, input = {}) {
  const reason = assertCancellationReason(input.reason || input.notes);

  return withTransaction(db, async (client) => {
    requireStockMovementAuditColumns(await getStockMovementAuditColumns(client));

    const movementResult = await client.query(
      `
      SELECT psm.*, pi.current_stock
      FROM packaging_stock_movements psm
      JOIN packaging_items pi ON pi.id = psm.packaging_item_id AND pi.store_id = psm.store_id
      WHERE psm.id = $1
        AND psm.store_id = $2
      FOR UPDATE OF psm, pi
      `,
      [movementId, storeId]
    );
    const movement = movementResult.rows[0];
    assertStockMovementCanBeCancelled(movement);

    const inverseQuantity = -Number(movement.quantity);
    if (Number(movement.current_stock) + inverseQuantity < 0) {
      const error = new Error('Annulation impossible : stock emballage insuffisant pour le mouvement inverse');
      error.status = 409;
      throw error;
    }

    const inverseResult = await client.query(
      `
      INSERT INTO packaging_stock_movements (
        store_id, packaging_item_id, movement_type, quantity, unit_cost_ex_vat,
        source_table, source_id, movement_date, notes, created_by
      )
      VALUES ($1, $2, $3, $4, $5, 'packaging_stock_movements', $6, CURRENT_DATE, $7, $8)
      RETURNING *
      `,
      [
        storeId,
        movement.packaging_item_id,
        reverseStockMovementType(movement.movement_type),
        inverseQuantity,
        movement.unit_cost_ex_vat,
        movement.id,
        `Annulation du mouvement ${movement.id}: ${reason}`,
        userId,
      ]
    );

    const updatedMovement = await client.query(
      `
      UPDATE packaging_stock_movements
      SET cancelled_at = now(),
          cancelled_by = $3,
          cancellation_reason = $4,
          reversal_movement_id = $5
      WHERE id = $1
        AND store_id = $2
      RETURNING *
      `,
      [movement.id, storeId, userId, reason, inverseResult.rows[0].id]
    );

    const updatedItem = await client.query(
      `
      UPDATE packaging_items
      SET current_stock = current_stock + $3,
          updated_by = $4,
          updated_at = now()
      WHERE id = $1
        AND store_id = $2
      RETURNING *
      `,
      [movement.packaging_item_id, storeId, inverseQuantity, userId]
    );

    return {
      movement: updatedMovement.rows[0],
      reversal_movement: inverseResult.rows[0],
      item: updatedItem.rows[0],
    };
  });
}

async function listArticleProfiles(db, storeId, articleId, includeInactive = false) {
  const result = await db.query(
    `
    SELECT
      p.*,
      COALESCE(
        json_agg(
          json_build_object(
            'id', c.id,
            'packaging_item_id', c.packaging_item_id,
            'code', pi.code,
            'designation', pi.designation,
            'category', pi.category,
            'quantity', c.quantity,
            'consumption_rule', c.consumption_rule,
            'is_primary_packaging', c.is_primary_packaging,
            'current_unit_cost_ex_vat', pi.current_unit_cost_ex_vat,
            'current_stock', pi.current_stock
          )
          ORDER BY c.is_primary_packaging DESC, pi.code ASC
        ) FILTER (WHERE c.id IS NOT NULL),
        '[]'::json
      ) AS components
    FROM article_packaging_profiles p
    LEFT JOIN article_packaging_profile_components c
      ON c.profile_id = p.id
     AND c.store_id = p.store_id
    LEFT JOIN packaging_items pi
      ON pi.id = c.packaging_item_id
     AND pi.store_id = c.store_id
    WHERE p.store_id = $1
      AND p.article_id = $2
      AND ($3::boolean = true OR p.active = true)
    GROUP BY p.id
    ORDER BY p.is_default DESC, p.active DESC, p.name ASC
    `,
    [storeId, articleId, includeInactive]
  );

  return mapRows(result);
}

async function listProfiles(db, storeId, filters = {}) {
  const params = [storeId];
  const where = ['p.store_id = $1'];

  if (filters.active !== undefined) {
    params.push(filters.active === true || filters.active === 'true');
    where.push(`p.active = $${params.length}`);
  }

  if (filters.article_id) {
    params.push(filters.article_id);
    where.push(`p.article_id = $${params.length}`);
  }

  const result = await db.query(
    `
    SELECT
      p.*,
      a.plu,
      a.designation AS article_designation,
      COALESCE(
        json_agg(
          json_build_object(
            'id', c.id,
            'packaging_item_id', c.packaging_item_id,
            'code', pi.code,
            'designation', pi.designation,
            'category', pi.category,
            'quantity', c.quantity,
            'management_unit', pi.management_unit,
            'consumption_rule', c.consumption_rule,
            'is_primary_packaging', c.is_primary_packaging,
            'current_unit_cost_ex_vat', pi.current_unit_cost_ex_vat,
            'current_stock', pi.current_stock
          )
          ORDER BY c.is_primary_packaging DESC, pi.code ASC
        ) FILTER (WHERE c.id IS NOT NULL),
        '[]'::json
      ) AS components
    FROM article_packaging_profiles p
    JOIN articles a ON a.id = p.article_id AND a.store_id = p.store_id
    LEFT JOIN article_packaging_profile_components c
      ON c.profile_id = p.id
     AND c.store_id = p.store_id
    LEFT JOIN packaging_items pi
      ON pi.id = c.packaging_item_id
     AND pi.store_id = c.store_id
    WHERE ${where.join(' AND ')}
    GROUP BY p.id, a.plu, a.designation
    ORDER BY p.active DESC, p.is_default DESC, a.plu ASC, p.name ASC
    LIMIT $${params.length + 1}
    `,
    [...params, Math.min(Number(filters.limit) || 100, 300)]
  );

  return mapRows(result).map((profile) => ({
    ...profile,
    estimated_cost_per_package: estimateProfileCostPerPackage(profile.components || []),
  }));
}

async function getArticleStockSummary(db, storeId, articleId) {
  const result = await db.query(
    `
    SELECT
      a.id,
      a.plu,
      a.designation,
      COALESCE(a.unit, 'kg') AS unit,
      COALESCE(ss.stock_quantity, 0) AS stock_quantity,
      COALESCE(ss.pma, 0) AS pma,
      COALESCE(ss.stock_value_ex_vat, 0) AS stock_value_ex_vat
    FROM articles a
    LEFT JOIN stock_summary ss ON ss.article_id = a.id AND ss.store_id = a.store_id
    WHERE a.id = $1
      AND a.store_id = $2
      AND a.is_active = true
    LIMIT 1
    `,
    [articleId, storeId]
  );

  return result.rows[0] || null;
}

async function upsertArticleProfile(db, storeId, userId, input = {}) {
  return withTransaction(db, async (client) => {
    const name = clean(input.name);
    let articleId = clean(input.article_id);

    if (input.id && !articleId) {
      const existing = await client.query(
        `
        SELECT article_id
        FROM article_packaging_profiles
        WHERE id = $1
          AND store_id = $2
        LIMIT 1
        `,
        [input.id, storeId]
      );
      articleId = existing.rows[0] ? existing.rows[0].article_id : null;
    }

    if (!articleId || !name) {
      const error = new Error('Article et nom du modele obligatoires');
      error.status = 400;
      throw error;
    }

    const components = input.components || [];
    if (!components.length) {
      const error = new Error('Ajoute au moins un emballage au modele de conditionnement');
      error.status = 400;
      throw error;
    }
    assertNoDuplicatePackagingComponents(components);

    if (input.is_default) {
      await client.query(
        `
        UPDATE article_packaging_profiles
        SET is_default = false,
            updated_by = $3,
            updated_at = now()
        WHERE store_id = $1
          AND article_id = $2
          AND active = true
        `,
        [storeId, articleId, userId]
      );
    }

    const profileResult = input.id
      ? await client.query(
          `
          UPDATE article_packaging_profiles
          SET name = $4,
              target_net_weight_kg = $5,
              target_package_count = $6,
              is_default = $7,
              active = $8,
              notes = $9,
              updated_by = $10,
              updated_at = now()
          WHERE id = $1
            AND store_id = $2
            AND article_id = $3
          RETURNING *
          `,
          [
            input.id,
            storeId,
            articleId,
            name,
            parseDecimal(input.target_net_weight_kg),
            parseDecimal(input.target_package_count),
            Boolean(input.is_default),
            input.active === undefined ? true : Boolean(input.active),
            clean(input.notes),
            userId,
          ]
        )
      : await client.query(
          `
          INSERT INTO article_packaging_profiles (
            store_id, article_id, name, target_net_weight_kg, target_package_count,
            is_default, active, notes, created_by, updated_by
          )
          VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8, $8)
          RETURNING *
          `,
          [
            storeId,
            articleId,
            name,
            parseDecimal(input.target_net_weight_kg),
            parseDecimal(input.target_package_count),
            Boolean(input.is_default),
            clean(input.notes),
            userId,
          ]
        );

    const profile = profileResult.rows[0];
    if (!profile) {
      const error = new Error('Modele de conditionnement introuvable');
      error.status = 404;
      throw error;
    }

    await client.query(
      'DELETE FROM article_packaging_profile_components WHERE store_id = $1 AND profile_id = $2',
      [storeId, profile.id]
    );

    for (const component of components) {
      const packagingItemId = clean(component.packaging_item_id);
      const quantity = parseDecimal(component.quantity);
      assertPositive(quantity, 'Quantite composant');

      const packagingItem = await client.query(
        `
        SELECT id
        FROM packaging_items
        WHERE id = $1
          AND store_id = $2
          AND active = true
        LIMIT 1
        `,
        [packagingItemId, storeId]
      );
      if (!packagingItem.rows[0]) {
        const error = new Error('Emballage actif introuvable pour le modele');
        error.status = 400;
        throw error;
      }

      await client.query(
        `
        INSERT INTO article_packaging_profile_components (
          store_id, profile_id, packaging_item_id, quantity, consumption_rule, is_primary_packaging
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          storeId,
          profile.id,
          packagingItemId,
          quantity,
          clean(component.consumption_rule) || 'per_package',
          Boolean(component.is_primary_packaging),
        ]
      );
    }

    const profiles = await listArticleProfiles(client, storeId, articleId, true);
    return profiles.find((candidate) => String(candidate.id) === String(profile.id));
  });
}

async function deactivateProfile(db, storeId, profileId, userId) {
  const result = await db.query(
    `
    UPDATE article_packaging_profiles
    SET active = false,
        is_default = false,
        updated_by = $3,
        updated_at = now()
    WHERE id = $1
      AND store_id = $2
    RETURNING *
    `,
    [profileId, storeId, userId]
  );

  return result.rows[0] || null;
}

async function buildOperationPreview(db, storeId, input = {}) {
  const profileRows = await listArticleProfiles(db, storeId, input.article_id, false);
  const profile = profileRows.find((row) => String(row.id) === String(input.profile_id));

  if (!profile) {
    const error = new Error('Aucun modele de conditionnement actif n existe pour cet article');
    error.status = 404;
    throw error;
  }

  const articleStock = await getArticleStockSummary(db, storeId, input.article_id);
  if (!articleStock || Number(articleStock.stock_quantity) <= 0) {
    const error = new Error('Article sans stock disponible pour conditionnement');
    error.status = 409;
    throw error;
  }

  const productQuantityKg = parseDecimal(input.product_quantity_kg);
  assertPositive(productQuantityKg, 'Quantite produit concernee');
  if (productQuantityKg > Number(articleStock.stock_quantity)) {
    const error = new Error('Quantite produit concernee superieure au stock disponible');
    error.status = 409;
    error.details = { stock_quantity: Number(articleStock.stock_quantity), requested_quantity: productQuantityKg };
    throw error;
  }

  const consumptionLines = computeProfileConsumption({
    components: profile.components,
    packageCount: input.package_count,
    productQuantityKg,
  });
  const costs = computePackagingCosts({
    lines: consumptionLines,
    productQuantityKg,
    packageCount: input.package_count,
    productCostBeforePackaging: articleStock.pma,
  });

  return { profile, article_stock: articleStock, ...costs };
}

async function listOperations(db, storeId, limit = 50) {
  const result = await db.query(
    `
    SELECT
      op.*,
      a.plu,
      a.designation AS article_designation,
      p.name AS profile_name,
      COALESCE(
        json_agg(
          json_build_object(
            'id', l.id,
            'packaging_item_id', l.packaging_item_id,
            'designation', pi.designation,
            'quantity', l.quantity,
            'unit_cost_ex_vat', l.unit_cost_ex_vat,
            'total_cost_ex_vat', l.total_cost_ex_vat,
            'consumption_rule', l.consumption_rule
          )
        ) FILTER (WHERE l.id IS NOT NULL),
        '[]'::json
      ) AS lines
    FROM packaging_operations op
    JOIN articles a ON a.id = op.article_id AND a.store_id = op.store_id
    LEFT JOIN article_packaging_profiles p ON p.id = op.profile_id AND p.store_id = op.store_id
    LEFT JOIN packaging_operation_lines l ON l.operation_id = op.id AND l.store_id = op.store_id
    LEFT JOIN packaging_items pi ON pi.id = l.packaging_item_id AND pi.store_id = l.store_id
    WHERE op.store_id = $1
    GROUP BY op.id, a.plu, a.designation, p.name
    ORDER BY op.operation_date DESC, op.created_at DESC
    LIMIT $2
    `,
    [storeId, Math.min(Number(limit) || 50, 200)]
  );

  return mapRows(result);
}

async function createOperation(db, storeId, userId, input = {}) {
  return withTransaction(db, async (client) => {
    const preview = await buildOperationPreview(client, storeId, input);
    const average = Number(input.product_quantity_kg) / Number(input.package_count);

    const operation = await client.query(
      `
      INSERT INTO packaging_operations (
        store_id, article_id, lot_id, profile_id, operation_date, product_quantity_kg,
        package_count, average_net_weight_kg, operator_user_id, status, notes,
        packaging_cost_total_ex_vat, packaging_cost_per_package, packaging_cost_per_kg,
        product_cost_before_packaging, cost_after_packaging_per_kg, created_by, updated_by
      )
      VALUES (
        $1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE), $6, $7, $8, $9, 'draft', $10,
        $11, $12, $13, $14, $15, $16, $16
      )
      RETURNING *
      `,
      [
        storeId,
        input.article_id,
        clean(input.lot_id),
        preview.profile.id,
        clean(input.operation_date),
        parseDecimal(input.product_quantity_kg),
        parseDecimal(input.package_count),
        round(average, 4),
        clean(input.operator_user_id) || userId,
        clean(input.notes),
        preview.packaging_cost_total_ex_vat,
        preview.packaging_cost_per_package,
        preview.packaging_cost_per_kg,
        preview.product_cost_before_packaging,
        preview.cost_after_packaging_per_kg,
        userId,
      ]
    );

    for (const line of preview.lines) {
      await client.query(
        `
        INSERT INTO packaging_operation_lines (
          store_id, operation_id, packaging_item_id, quantity, unit_cost_ex_vat,
          total_cost_ex_vat, consumption_rule
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          storeId,
          operation.rows[0].id,
          line.packaging_item_id,
          line.quantity,
          line.unit_cost_ex_vat,
          line.total_cost_ex_vat,
          line.consumption_rule,
        ]
      );
    }

    return operation.rows[0];
  });
}

async function validateOperation(db, storeId, userId, operationId) {
  return withTransaction(db, async (client) => {
    const operationResult = await client.query(
      `
      SELECT *
      FROM packaging_operations
      WHERE id = $1
        AND store_id = $2
      FOR UPDATE
      `,
      [operationId, storeId]
    );
    const operation = operationResult.rows[0];
    assertOperationCanBeValidated(operation);

    const articleStock = await getArticleStockSummary(client, storeId, operation.article_id);
    if (!articleStock || Number(articleStock.stock_quantity) <= 0) {
      const error = new Error('Article sans stock disponible pour conditionnement');
      error.status = 409;
      throw error;
    }
    if (Number(operation.product_quantity_kg) > Number(articleStock.stock_quantity)) {
      const error = new Error('Quantite produit concernee superieure au stock disponible');
      error.status = 409;
      error.details = {
        stock_quantity: Number(articleStock.stock_quantity),
        requested_quantity: Number(operation.product_quantity_kg),
      };
      throw error;
    }

    const linesResult = await client.query(
      `
      SELECT l.*, pi.category, pi.designation, pi.current_stock
      FROM packaging_operation_lines l
      JOIN packaging_items pi ON pi.id = l.packaging_item_id AND pi.store_id = l.store_id
      WHERE l.operation_id = $1
        AND l.store_id = $2
      FOR UPDATE OF pi
      `,
      [operationId, storeId]
    );
    const lines = linesResult.rows;
    const stocks = new Map(lines.map((line) => [String(line.packaging_item_id), Number(line.current_stock)]));
    assertSufficientStock(lines, stocks);

    const packagingCostAddedPerKg = round(
      Number(operation.packaging_cost_total_ex_vat || 0) / Number(operation.product_quantity_kg || 1),
      4
    );
    const productCostBefore = Number(articleStock.pma || operation.product_cost_before_packaging || 0);
    const costAfterPackaging = round(productCostBefore + packagingCostAddedPerKg, 4);

    for (const line of lines) {
      if (line.category === 'returnable') continue;
      const movement = await client.query(
        `
        INSERT INTO packaging_stock_movements (
          store_id, packaging_item_id, movement_type, quantity, unit_cost_ex_vat,
          source_table, source_id, movement_date, notes, created_by
        )
        VALUES ($1, $2, 'conditioning_out', $3, $4, 'packaging_operations', $5, $6, $7, $8)
        RETURNING id
        `,
        [
          storeId,
          line.packaging_item_id,
          -Math.abs(Number(line.quantity)),
          line.unit_cost_ex_vat,
          operationId,
          operation.operation_date,
          'Validation operation de conditionnement',
          userId,
        ]
      );

      await client.query(
        `
        UPDATE packaging_items
        SET current_stock = current_stock - $3,
            updated_by = $4,
            updated_at = now()
        WHERE id = $1
          AND store_id = $2
        `,
        [line.packaging_item_id, storeId, Number(line.quantity), userId]
      );

      await client.query(
        `
        UPDATE packaging_operation_lines
        SET stock_movement_id = $3
        WHERE id = $1
          AND store_id = $2
        `,
        [line.id, storeId, movement.rows[0].id]
      );
    }

    await client.query(
      `
      INSERT INTO packaging_cost_impacts (
        store_id, packaging_operation_id, article_id, stock_quantity_at_validation,
        product_cost_before_packaging, packaging_cost_total_ex_vat,
        packaging_cost_added_per_kg, cost_after_packaging_per_kg, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (store_id, packaging_operation_id)
      DO UPDATE SET
        stock_quantity_at_validation = EXCLUDED.stock_quantity_at_validation,
        product_cost_before_packaging = EXCLUDED.product_cost_before_packaging,
        packaging_cost_total_ex_vat = EXCLUDED.packaging_cost_total_ex_vat,
        packaging_cost_added_per_kg = EXCLUDED.packaging_cost_added_per_kg,
        cost_after_packaging_per_kg = EXCLUDED.cost_after_packaging_per_kg,
        status = 'active'
      `,
      [
        storeId,
        operationId,
        operation.article_id,
        articleStock.stock_quantity,
        productCostBefore,
        operation.packaging_cost_total_ex_vat,
        packagingCostAddedPerKg,
        costAfterPackaging,
        userId,
      ]
    );

    const updated = await client.query(
      `
      UPDATE packaging_operations
      SET status = 'validated',
          validated_at = now(),
          product_cost_before_packaging = $4,
          cost_after_packaging_per_kg = $5,
          updated_by = $3,
          updated_at = now()
      WHERE id = $1
        AND store_id = $2
      RETURNING *
      `,
      [operationId, storeId, userId, productCostBefore, costAfterPackaging]
    );

    return updated.rows[0];
  });
}

async function listReturnableBalances(db, storeId) {
  const result = await db.query(
    `
    SELECT
      rpm.packaging_item_id,
      pi.code,
      pi.designation,
      rpm.supplier_id,
      s.name AS supplier_name,
      SUM(rpm.quantity) AS balance_quantity,
      COALESCE(MAX(NULLIF(rpm.deposit_unit_value, 0)), pi.deposit_unit_value, 0) AS deposit_unit_value,
      SUM(rpm.quantity) * COALESCE(MAX(NULLIF(rpm.deposit_unit_value, 0)), pi.deposit_unit_value, 0) AS deposit_balance_value
    FROM returnable_packaging_movements rpm
    JOIN packaging_items pi ON pi.id = rpm.packaging_item_id AND pi.store_id = rpm.store_id
    LEFT JOIN suppliers s ON s.id = rpm.supplier_id AND s.store_id = rpm.store_id
    WHERE rpm.store_id = $1
    GROUP BY rpm.packaging_item_id, pi.code, pi.designation, pi.deposit_unit_value, rpm.supplier_id, s.name
    ORDER BY pi.code ASC, s.name ASC NULLS LAST
    `,
    [storeId]
  );

  return mapRows(result);
}

async function listReturnableMovements(db, storeId, limit = 100) {
  const result = await db.query(
    `
    SELECT
      rpm.*,
      pi.code,
      pi.designation,
      s.name AS supplier_name
    FROM returnable_packaging_movements rpm
    JOIN packaging_items pi ON pi.id = rpm.packaging_item_id AND pi.store_id = rpm.store_id
    LEFT JOIN suppliers s ON s.id = rpm.supplier_id AND s.store_id = rpm.store_id
    WHERE rpm.store_id = $1
    ORDER BY rpm.movement_date DESC, rpm.created_at DESC
    LIMIT $2
    `,
    [storeId, Math.min(Number(limit) || 100, 300)]
  );

  return mapRows(result);
}

async function createReturnableMovement(db, storeId, userId, input = {}) {
  const signedQuantity = signedQuantityForReturnableMovement(input.movement_type, input.quantity);

  const result = await db.query(
    `
    INSERT INTO returnable_packaging_movements (
      store_id, packaging_item_id, supplier_id, movement_type, quantity,
      deposit_unit_value, source_table, source_id, movement_date, notes, created_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::date, CURRENT_DATE), $10, $11)
    RETURNING *
    `,
    [
      storeId,
      clean(input.packaging_item_id),
      clean(input.supplier_id),
      clean(input.movement_type),
      signedQuantity,
      parseDecimal(input.deposit_unit_value, 0),
      clean(input.source_table),
      clean(input.source_id),
      clean(input.movement_date),
      clean(input.notes),
      userId,
    ]
  );

  return result.rows[0];
}

module.exports = {
  normalizePackagingItemInput,
  signedQuantityForStockMovement,
  computeProfileConsumption,
  computePackagingCosts,
  assertSufficientStock,
  assertOperationCanBeValidated,
  signedQuantityForReturnableMovement,
  reverseStockMovementType,
  assertCancellationReason,
  assertStockMovementCanBeCancelled,
  assertStockMovementCanBeDeleted,
  summarizeReturnableMovements,
  filterRowsByStore,
  assertNoDuplicatePackagingComponents,
  estimateProfileCostPerPackage,
  listItems,
  createItem,
  updateItem,
  recordStockMovement,
  listStockMovements,
  cancelStockMovement,
  listProfiles,
  listArticleProfiles,
  upsertArticleProfile,
  deactivateProfile,
  buildOperationPreview,
  listOperations,
  createOperation,
  validateOperation,
  listReturnableBalances,
  listReturnableMovements,
  createReturnableMovement,
};
