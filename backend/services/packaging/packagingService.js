const { recomputeArticleStock } = require('../stockService');

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

function articleTypeForPackagingCategory(category) {
  if (category === 'returnable') return 'PACKAGING_RETURNABLE';
  return 'PACKAGING_CONSUMABLE';
}

function packagingArticleIdOf(line = {}) {
  return clean(line.packaging_article_id || line.packaging_item_id);
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
    const packagingArticleId = packagingArticleIdOf(line);
    const currentStock = Number(stocksByItemId.get(String(packagingArticleId)) || 0);
    const needed = Number(line.quantity || 0);
    if (currentStock < needed) {
      missing.push({
        packaging_article_id: packagingArticleId,
        packaging_item_id: packagingArticleId,
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
    const packagingArticleId = packagingArticleIdOf(component);
    if (!packagingArticleId) {
      const error = new Error('Emballage obligatoire sur chaque ligne du modele');
      error.status = 400;
      throw error;
    }
    if (seen.has(packagingArticleId)) {
      const error = new Error('Un emballage ne peut pas etre ajoute deux fois au meme modele');
      error.status = 400;
      throw error;
    }
    seen.add(packagingArticleId);
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

async function consumePackagingArticleStock(client, {
  storeId,
  clientKey,
  packagingArticleId,
  quantity,
  unitCostExVat,
  operationId,
  userId,
  notes,
}) {
  let remaining = Number(quantity || 0);
  assertPositive(remaining, 'Quantite emballage consommee');

  const lots = await client.query(
    `
    SELECT id, qty_remaining, unit_cost_ex_vat
    FROM lots
    WHERE store_id = $1
      AND article_id = $2
      AND qty_remaining > 0
    ORDER BY COALESCE(dlc, DATE '9999-12-31'), created_at, id
    FOR UPDATE
    `,
    [storeId, packagingArticleId]
  );

  const movements = [];
  for (const lot of lots.rows) {
    if (remaining <= 0) break;
    const consumed = Math.min(remaining, Number(lot.qty_remaining || 0));
    if (consumed <= 0) continue;

    await client.query(
      'UPDATE lots SET qty_remaining = qty_remaining - $1, updated_at = NOW() WHERE id = $2',
      [consumed, lot.id]
    );

    const movement = await client.query(
      `
      INSERT INTO stock_movements (
        id, store_id, client_key, article_id, lot_id, movement_type, quantity,
        unit_cost_ex_vat, source_table, source_id, notes, created_by
      )
      VALUES (gen_random_uuid(), $1, $2, $3, $4, 'packaging_consumption', $5, $6,
              'packaging_operations', $7, $8, $9)
      RETURNING id
      `,
      [
        storeId,
        clientKey || null,
        packagingArticleId,
        lot.id,
        -consumed,
        unitCostExVat,
        operationId,
        notes || 'Validation operation de conditionnement',
        userId,
      ]
    );

    movements.push(movement.rows[0].id);
    remaining = round(remaining - consumed, 3);
  }

  if (remaining > 0) {
    const error = new Error('Stock emballage insuffisant');
    error.status = 409;
    error.details = {
      packaging_article_id: packagingArticleId,
      missing_quantity: remaining,
    };
    throw error;
  }

  await recomputeArticleStock(client, packagingArticleId, storeId);
  return movements;
}

async function listItems(db, storeId, filters = {}) {
  const params = [storeId];
  const where = ["a.store_id = $1", "a.article_type IN ('PACKAGING_CONSUMABLE', 'PACKAGING_RETURNABLE')"];

  if (filters.active !== undefined) {
    params.push(filters.active === true || filters.active === 'true');
    where.push(`a.is_active = $${params.length}`);
  }

  if (filters.category) {
    params.push(articleTypeForPackagingCategory(filters.category));
    where.push(`a.article_type = $${params.length}`);
  }

  if (filters.id) {
    params.push(filters.id);
    where.push(`a.id = $${params.length}`);
  }

  if (filters.search) {
    params.push(`%${String(filters.search).trim()}%`);
    where.push(`(a.plu ILIKE $${params.length} OR a.designation ILIKE $${params.length})`);
  }

  const result = await db.query(
    `
    SELECT
      a.id,
      a.store_id,
      a.plu AS code,
      a.designation,
      a.article_type,
      CASE
        WHEN a.article_type = 'PACKAGING_RETURNABLE' THEN 'returnable'
        ELSE 'consumable'
      END AS category,
      COALESCE(a.stock_unit, a.unit, 'unit') AS management_unit,
      a.format_label,
      a.primary_supplier_id,
      COALESCE(ss.pma, 0) AS current_unit_cost_ex_vat,
      COALESCE(a.deposit_unit_value, 0) AS deposit_unit_value,
      COALESCE(a.alert_threshold, 0) AS alert_threshold,
      COALESCE(ss.stock_quantity, 0) AS current_stock,
      a.is_active AS active,
      s.name AS supplier_name
    FROM articles a
    LEFT JOIN stock_summary ss ON ss.article_id = a.id AND ss.store_id = a.store_id
    LEFT JOIN suppliers s ON s.id = a.primary_supplier_id AND s.store_id = a.store_id
    WHERE ${where.join(' AND ')}
    ORDER BY a.is_active DESC, a.article_type ASC, a.plu ASC
    `,
    params
  );

  return mapRows(result);
}

async function listStockMovements(db, storeId, filters = {}) {
  const params = [storeId];
  const where = ["sm.store_id = $1", "a.article_type IN ('PACKAGING_CONSUMABLE', 'PACKAGING_RETURNABLE')"];

  if (filters.packaging_item_id) {
    params.push(filters.packaging_item_id);
    where.push(`sm.article_id = $${params.length}`);
  }

  if (filters.id) {
    params.push(filters.id);
    where.push(`sm.id = $${params.length}`);
  }

  const result = await db.query(
    `
    SELECT
      sm.id,
      sm.store_id,
      sm.article_id AS packaging_article_id,
      sm.article_id AS packaging_item_id,
      sm.movement_type,
      sm.quantity,
      sm.unit_cost_ex_vat,
      sm.source_table,
      sm.source_id,
      sm.created_at::date AS movement_date,
      sm.notes,
      sm.created_by,
      sm.created_at,
      NULL::timestamptz AS cancelled_at,
      NULL::uuid AS cancelled_by,
      NULL::text AS cancellation_reason,
      NULL::uuid AS reversal_movement_id,
      a.plu AS code,
      a.designation,
      COALESCE(a.stock_unit, a.unit, 'unit') AS management_unit,
      'active' AS status,
      creator.email AS created_by_email,
      NULL::text AS cancelled_by_email
    FROM stock_movements sm
    JOIN articles a ON a.id = sm.article_id AND a.store_id = sm.store_id
    LEFT JOIN users creator ON creator.id = sm.created_by
    WHERE ${where.join(' AND ')}
    ORDER BY sm.created_at DESC
    LIMIT $${params.length + 1}
    `,
    [...params, Math.min(Number(filters.limit) || 100, 300)]
  );

  return mapRows(result);
}

async function cancelStockMovement(db, storeId, userId, movementId, input = {}) {
  const reason = assertCancellationReason(input.reason || input.notes);
  const error = new Error('Annulation directe des mouvements stock ALTA non supportee ici. Annule le document source ou cree une regularisation stock article documentee.');
  error.status = 409;
  error.details = { movement_id: movementId, store_id: storeId, requested_by: userId, reason };
  throw error;
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
            'packaging_article_id', c.packaging_article_id,
            'packaging_item_id', c.packaging_article_id,
            'code', pa.plu,
            'designation', pa.designation,
            'category', CASE WHEN pa.article_type = 'PACKAGING_RETURNABLE' THEN 'returnable' ELSE 'consumable' END,
            'quantity', c.quantity,
            'consumption_rule', c.consumption_rule,
            'is_primary_packaging', c.is_primary_packaging,
            'management_unit', COALESCE(pa.stock_unit, pa.unit, 'unit'),
            'current_unit_cost_ex_vat', COALESCE(ss.pma, 0),
            'current_stock', COALESCE(ss.stock_quantity, 0)
          )
          ORDER BY c.is_primary_packaging DESC, pa.plu ASC
        ) FILTER (WHERE c.id IS NOT NULL),
        '[]'::json
      ) AS components
    FROM article_packaging_profiles p
    LEFT JOIN article_packaging_profile_components c
      ON c.profile_id = p.id
     AND c.store_id = p.store_id
    LEFT JOIN articles pa
      ON pa.id = c.packaging_article_id
     AND pa.store_id = c.store_id
    LEFT JOIN stock_summary ss
      ON ss.article_id = pa.id
     AND ss.store_id = pa.store_id
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
            'packaging_article_id', c.packaging_article_id,
            'packaging_item_id', c.packaging_article_id,
            'code', pa.plu,
            'designation', pa.designation,
            'category', CASE WHEN pa.article_type = 'PACKAGING_RETURNABLE' THEN 'returnable' ELSE 'consumable' END,
            'quantity', c.quantity,
            'management_unit', COALESCE(pa.stock_unit, pa.unit, 'unit'),
            'consumption_rule', c.consumption_rule,
            'is_primary_packaging', c.is_primary_packaging,
            'current_unit_cost_ex_vat', COALESCE(ss.pma, 0),
            'current_stock', COALESCE(ss.stock_quantity, 0)
          )
          ORDER BY c.is_primary_packaging DESC, pa.plu ASC
        ) FILTER (WHERE c.id IS NOT NULL),
        '[]'::json
      ) AS components
    FROM article_packaging_profiles p
    JOIN articles a ON a.id = p.article_id AND a.store_id = p.store_id
    LEFT JOIN article_packaging_profile_components c
      ON c.profile_id = p.id
     AND c.store_id = p.store_id
    LEFT JOIN articles pa
      ON pa.id = c.packaging_article_id
     AND pa.store_id = c.store_id
    LEFT JOIN stock_summary ss
      ON ss.article_id = pa.id
     AND ss.store_id = pa.store_id
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

async function assertProductLotTraceability(db, storeId, articleId, lotId) {
  if (!clean(lotId)) return null;
  const result = await db.query(
    `
    SELECT id, lot_code, supplier_lot_number, qty_remaining, unit_cost_ex_vat
    FROM lots
    WHERE id = $1
      AND store_id = $2
      AND article_id = $3
      AND qty_remaining > 0
    LIMIT 1
    `,
    [lotId, storeId, articleId]
  );
  if (!result.rows[0]) {
    const error = new Error('Lot produit introuvable ou sans stock disponible pour cet article');
    error.status = 409;
    throw error;
  }
  return result.rows[0];
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
      const packagingArticleId = packagingArticleIdOf(component);
      const quantity = parseDecimal(component.quantity);
      assertPositive(quantity, 'Quantite composant');

      const packagingArticle = await client.query(
        `
        SELECT id, article_type
        FROM articles
        WHERE id = $1
          AND store_id = $2
          AND is_active = true
          AND article_type IN ('PACKAGING_CONSUMABLE', 'PACKAGING_RETURNABLE')
          AND stock_managed = true
        LIMIT 1
        `,
        [packagingArticleId, storeId]
      );
      if (!packagingArticle.rows[0]) {
        const error = new Error('Article emballage actif introuvable pour le modele');
        error.status = 400;
        throw error;
      }

      await client.query(
        `
        INSERT INTO article_packaging_profile_components (
          store_id, profile_id, packaging_article_id, quantity, consumption_rule, is_primary_packaging
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          storeId,
          profile.id,
          packagingArticleId,
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

  const selectedLot = await assertProductLotTraceability(db, storeId, input.article_id, input.lot_id);

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

  return { profile, article_stock: articleStock, selected_lot: selectedLot, ...costs };
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
            'packaging_article_id', l.packaging_article_id,
            'packaging_item_id', l.packaging_article_id,
            'designation', pa.designation,
            'code', pa.plu,
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
    LEFT JOIN articles pa ON pa.id = l.packaging_article_id AND pa.store_id = l.store_id
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
          store_id, operation_id, packaging_article_id, quantity, unit_cost_ex_vat,
          total_cost_ex_vat, consumption_rule
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          storeId,
          operation.rows[0].id,
          packagingArticleIdOf(line),
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
    await assertProductLotTraceability(client, storeId, operation.article_id, operation.lot_id);

    const linesResult = await client.query(
      `
      SELECT
        l.*,
        pa.article_type,
        CASE WHEN pa.article_type = 'PACKAGING_RETURNABLE' THEN 'returnable' ELSE 'consumable' END AS category,
        pa.designation,
        COALESCE(ss.stock_quantity, 0) AS current_stock
      FROM packaging_operation_lines l
      JOIN articles pa ON pa.id = l.packaging_article_id AND pa.store_id = l.store_id
      LEFT JOIN stock_summary ss ON ss.article_id = pa.id AND ss.store_id = pa.store_id
      WHERE l.operation_id = $1
        AND l.store_id = $2
        AND pa.article_type IN ('PACKAGING_CONSUMABLE', 'PACKAGING_RETURNABLE')
      FOR UPDATE OF pa
      `,
      [operationId, storeId]
    );
    const lines = linesResult.rows;
    const stocks = new Map(lines.map((line) => [String(line.packaging_article_id), Number(line.current_stock)]));
    assertSufficientStock(lines, stocks);

    const packagingCostAddedPerKg = round(
      Number(operation.packaging_cost_total_ex_vat || 0) / Number(operation.product_quantity_kg || 1),
      4
    );
    const productCostBefore = Number(articleStock.pma || operation.product_cost_before_packaging || 0);
    const costAfterPackaging = round(productCostBefore + packagingCostAddedPerKg, 4);

    for (const line of lines) {
      if (line.category === 'returnable') continue;
      await consumePackagingArticleStock(client, {
        storeId,
        clientKey: operation.client_key,
        packagingArticleId: line.packaging_article_id,
        quantity: Number(line.quantity),
        unitCostExVat: Number(line.unit_cost_ex_vat || 0),
        operationId,
        userId,
        notes: 'Validation operation de conditionnement',
      });

      await client.query(
        `
        UPDATE packaging_operation_lines
        SET stock_movement_id = NULL
        WHERE id = $1
          AND store_id = $2
        `,
        [line.id, storeId]
      );
    }

    await client.query(
      `
      INSERT INTO packaging_cost_impacts (
        store_id, packaging_operation_id, article_id, stock_quantity_at_validation,
        product_cost_before_packaging, packaging_cost_total_ex_vat,
        packaging_cost_added_per_kg, cost_after_packaging_per_kg, lot_id, cost_component, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PACKAGING', $10)
      ON CONFLICT (store_id, packaging_operation_id)
      DO UPDATE SET
        stock_quantity_at_validation = EXCLUDED.stock_quantity_at_validation,
        product_cost_before_packaging = EXCLUDED.product_cost_before_packaging,
        packaging_cost_total_ex_vat = EXCLUDED.packaging_cost_total_ex_vat,
        packaging_cost_added_per_kg = EXCLUDED.packaging_cost_added_per_kg,
        cost_after_packaging_per_kg = EXCLUDED.cost_after_packaging_per_kg,
        lot_id = EXCLUDED.lot_id,
        cost_component = 'PACKAGING',
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
        operation.lot_id,
        userId,
      ]
    );

    await client.query(
      `
      INSERT INTO stock_cost_components (
        store_id, article_id, lot_id, source_table, source_id, component_type,
        quantity_reference, amount_ex_vat, unit_cost_delta_ex_vat, status, notes, created_by
      )
      VALUES ($1, $2, $3, 'packaging_operations', $4, 'PACKAGING',
              $5, $6, $7, 'active', $8, $9)
      ON CONFLICT (store_id, source_table, source_id, component_type)
      DO UPDATE SET
        article_id = EXCLUDED.article_id,
        lot_id = EXCLUDED.lot_id,
        quantity_reference = EXCLUDED.quantity_reference,
        amount_ex_vat = EXCLUDED.amount_ex_vat,
        unit_cost_delta_ex_vat = EXCLUDED.unit_cost_delta_ex_vat,
        status = 'active',
        notes = EXCLUDED.notes,
        updated_at = now()
      `,
      [
        storeId,
        operation.article_id,
        operation.lot_id,
        operationId,
        operation.product_quantity_kg,
        operation.packaging_cost_total_ex_vat,
        packagingCostAddedPerKg,
        'Cout conditionnement incorpore au stock produit',
        userId,
      ]
    );
    await recomputeArticleStock(client, operation.article_id, storeId);

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

async function cancelOperation(db, storeId, userId, operationId, input = {}) {
  const reason = assertCancellationReason(input.reason || input.notes);

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
    if (!operation) {
      const error = new Error('Operation de conditionnement introuvable');
      error.status = 404;
      throw error;
    }
    if (operation.status === 'cancelled') {
      const error = new Error('Operation deja annulee');
      error.status = 409;
      throw error;
    }

    const movements = await client.query(
      `
      SELECT sm.*
      FROM stock_movements sm
      JOIN articles a ON a.id = sm.article_id AND a.store_id = sm.store_id
      WHERE sm.store_id = $1
        AND sm.source_table = 'packaging_operations'
        AND sm.source_id = $2
        AND sm.quantity < 0
        AND a.article_type = 'PACKAGING_CONSUMABLE'
      ORDER BY sm.created_at ASC, sm.id ASC
      FOR UPDATE OF sm
      `,
      [storeId, operationId]
    );

    const impactedPackagingArticles = new Set();
    for (const movement of movements.rows) {
      const quantity = Math.abs(Number(movement.quantity || 0));
      if (quantity <= 0) continue;
      await client.query(
        'UPDATE lots SET qty_remaining = qty_remaining + $1, updated_at = NOW() WHERE id = $2 AND store_id = $3',
        [quantity, movement.lot_id, storeId]
      );
      await client.query(
        `
        INSERT INTO stock_movements (
          id, store_id, client_key, article_id, lot_id, movement_type, quantity,
          unit_cost_ex_vat, source_table, source_id, notes, created_by
        )
        VALUES (gen_random_uuid(), $1, $2, $3, $4, 'packaging_consumption_reversal',
                $5, $6, 'packaging_operations', $7, $8, $9)
        `,
        [
          storeId,
          movement.client_key,
          movement.article_id,
          movement.lot_id,
          quantity,
          movement.unit_cost_ex_vat,
          operationId,
          `Annulation conditionnement: ${reason}`,
          userId,
        ]
      );
      impactedPackagingArticles.add(String(movement.article_id));
    }

    await client.query(
      `
      UPDATE stock_cost_components
      SET status = 'cancelled',
          cancelled_by = $3,
          cancellation_reason = $4,
          cancelled_at = now(),
          updated_at = now()
      WHERE store_id = $1
        AND source_table = 'packaging_operations'
        AND source_id = $2
        AND component_type = 'PACKAGING'
        AND status = 'active'
      `,
      [storeId, operationId, userId, reason]
    );

    await client.query(
      `
      UPDATE packaging_cost_impacts
      SET status = 'cancelled',
          cancelled_by = $3,
          cancellation_reason = $4,
          cancelled_at = now()
      WHERE store_id = $1
        AND packaging_operation_id = $2
        AND status = 'active'
      `,
      [storeId, operationId, userId, reason]
    );

    const updated = await client.query(
      `
      UPDATE packaging_operations
      SET status = 'cancelled',
          notes = CONCAT(COALESCE(notes, ''), CASE WHEN COALESCE(notes, '') = '' THEN '' ELSE E'\n' END, $3),
          updated_by = $4,
          updated_at = now()
      WHERE id = $1
        AND store_id = $2
      RETURNING *
      `,
      [operationId, storeId, `Annulation: ${reason}`, userId]
    );

    for (const articleId of impactedPackagingArticles) {
      await recomputeArticleStock(client, articleId, storeId);
    }
    await recomputeArticleStock(client, operation.article_id, storeId);

    return updated.rows[0];
  });
}

async function listReturnableBalances(db, storeId) {
  const result = await db.query(
    `
    SELECT
      rpm.packaging_article_id,
      rpm.packaging_article_id AS packaging_item_id,
      a.plu AS code,
      a.designation,
      rpm.supplier_id,
      s.name AS supplier_name,
      SUM(rpm.quantity) AS balance_quantity,
      COALESCE(MAX(NULLIF(rpm.deposit_unit_value, 0)), a.deposit_unit_value, 0) AS deposit_unit_value,
      SUM(rpm.quantity) * COALESCE(MAX(NULLIF(rpm.deposit_unit_value, 0)), a.deposit_unit_value, 0) AS deposit_balance_value
    FROM returnable_packaging_movements rpm
    JOIN articles a ON a.id = rpm.packaging_article_id AND a.store_id = rpm.store_id
    LEFT JOIN suppliers s ON s.id = rpm.supplier_id AND s.store_id = rpm.store_id
    WHERE rpm.store_id = $1
      AND a.article_type = 'PACKAGING_RETURNABLE'
    GROUP BY rpm.packaging_article_id, a.plu, a.designation, a.deposit_unit_value, rpm.supplier_id, s.name
    ORDER BY a.plu ASC, s.name ASC NULLS LAST
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
      rpm.packaging_article_id AS packaging_item_id,
      a.plu AS code,
      a.designation,
      s.name AS supplier_name
    FROM returnable_packaging_movements rpm
    JOIN articles a ON a.id = rpm.packaging_article_id AND a.store_id = rpm.store_id
    LEFT JOIN suppliers s ON s.id = rpm.supplier_id AND s.store_id = rpm.store_id
    WHERE rpm.store_id = $1
      AND a.article_type = 'PACKAGING_RETURNABLE'
    ORDER BY rpm.movement_date DESC, rpm.created_at DESC
    LIMIT $2
    `,
    [storeId, Math.min(Number(limit) || 100, 300)]
  );

  return mapRows(result);
}

async function createReturnableMovement(db, storeId, userId, input = {}) {
  const signedQuantity = signedQuantityForReturnableMovement(input.movement_type, input.quantity);
  const packagingArticleId = packagingArticleIdOf(input);

  const article = await db.query(
    `
    SELECT id
    FROM articles
    WHERE id = $1
      AND store_id = $2
      AND is_active = true
      AND article_type = 'PACKAGING_RETURNABLE'
    LIMIT 1
    `,
    [packagingArticleId, storeId]
  );
  if (!article.rows[0]) {
    const error = new Error('Article consigne introuvable ou inactif');
    error.status = 400;
    throw error;
  }

  const result = await db.query(
    `
    INSERT INTO returnable_packaging_movements (
      store_id, packaging_article_id, supplier_id, movement_type, quantity,
      deposit_unit_value, source_table, source_id, movement_date, notes, created_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::date, CURRENT_DATE), $10, $11)
    RETURNING *
    `,
    [
      storeId,
      packagingArticleId,
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
  cancelOperation,
  listReturnableBalances,
  listReturnableMovements,
  createReturnableMovement,
};
