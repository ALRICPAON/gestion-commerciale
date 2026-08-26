const {
  getCustomerDisplayedPrice,
  royaleMareeCommissionAmount,
} = require('./royaleMareeCommission');

function expose(status, message) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  return error;
}

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function isoDate(value) {
  const text = clean(value);
  return text ? text.slice(0, 10) : new Date().toISOString().slice(0, 10);
}

function num(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(parsed)) throw expose(400, 'Valeur numerique invalide');
  return parsed;
}

function nonNegative(value, fallback = null) {
  const parsed = num(value, fallback);
  if (parsed !== null && parsed < 0) throw expose(400, 'Valeur negative non autorisee');
  return parsed;
}

function normalizeSupplierDesignation(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9/.,]+/g, ' ')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCode(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
}

function isPool(db) {
  return Boolean(db && typeof db.connect === 'function' && (
    typeof db.query !== 'function'
    || typeof db.totalCount === 'number'
    || typeof db.idleCount === 'number'
    || typeof db.waitingCount === 'number'
  ));
}

function isTransactionClient(db) {
  return Boolean(db && typeof db.query === 'function' && !isPool(db));
}

async function inTransaction(db, fn) {
  if (isTransactionClient(db)) return fn(db);
  if (!isPool(db)) throw expose(500, 'Connexion base indisponible');
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function listTariffLevels(db, storeId, input = {}) {
  const params = [storeId];
  let where = 'WHERE store_id = $1';
  if (input.include_inactive !== true) where += ' AND is_active = true';
  if (clean(input.query)) {
    params.push(`%${clean(input.query)}%`);
    where += ` AND (code ILIKE $${params.length} OR name ILIKE $${params.length})`;
  }
  const result = await db.query(
    `SELECT *
     FROM tariff_levels
     ${where}
     ORDER BY display_order ASC, legacy_level ASC NULLS LAST, name ASC`,
    params
  );
  return { results: result.rows };
}

async function getTariffLevel(db, storeId, input = {}) {
  const id = clean(input.tariff_level_id || input.id);
  const code = clean(input.code);
  const legacy = Number(input.legacy_level || input.tariff_level);
  const params = [storeId];
  let where = 'store_id = $1';
  if (id) {
    params.push(id);
    where += ` AND id = $${params.length}`;
  } else if (code) {
    params.push(code);
    where += ` AND code = $${params.length}`;
  } else if (Number.isInteger(legacy)) {
    params.push(legacy);
    where += ` AND legacy_level = $${params.length}`;
  } else {
    throw expose(400, 'tariff_level_id, code ou legacy_level requis');
  }
  const result = await db.query(`SELECT * FROM tariff_levels WHERE ${where} LIMIT 1`, params);
  return result.rows[0] || null;
}

async function resolveClientTariffLevel(db, storeId, clientId) {
  if (!clean(clientId)) {
    const level = await getTariffLevel(db, storeId, { legacy_level: 1 });
    return { client: null, tariff_level: level };
  }
  const result = await db.query(
    `SELECT c.id, c.code, c.name, c.tariff_level, c.tariff_level_id,
            COALESCE(c.is_royale_maree_member, false) AS is_royale_maree_member,
            COALESCE(parent.tariff_level_id, billed.tariff_level_id, c.tariff_level_id) AS resolved_tariff_level_id,
            COALESCE(parent.tariff_level, billed.tariff_level, c.tariff_level, 1) AS resolved_legacy_level
     FROM clients c
     LEFT JOIN clients parent ON parent.id = c.parent_client_id AND parent.store_id = c.store_id
     LEFT JOIN clients billed ON billed.id = COALESCE(c.billed_client_id, c.id) AND billed.store_id = c.store_id
     WHERE c.store_id = $1 AND c.id = $2 AND COALESCE(c.status, 'active') <> 'inactive'
     LIMIT 1`,
    [storeId, clientId]
  );
  const client = result.rows[0];
  if (!client) throw expose(404, 'Client introuvable pour ce magasin');
  let tariffLevel = null;
  if (client.resolved_tariff_level_id) tariffLevel = await getTariffLevel(db, storeId, { id: client.resolved_tariff_level_id });
  if (!tariffLevel) tariffLevel = await getTariffLevel(db, storeId, { legacy_level: client.resolved_legacy_level || 1 });
  return { client, tariff_level: tariffLevel };
}

async function nextSessionVersion(db, storeId, date) {
  const result = await db.query(
    `SELECT COALESCE(MAX(version_number), 0)::int + 1 AS version
     FROM pricing_sessions
     WHERE store_id = $1 AND pricing_date = $2::date`,
    [storeId, date]
  );
  return result.rows[0].version;
}

async function listPricingSessions(db, storeId, input = {}) {
  const params = [storeId];
  const where = ['ps.store_id = $1'];
  if (clean(input.date)) {
    params.push(isoDate(input.date));
    where.push(`ps.pricing_date = $${params.length}::date`);
  }
  if (clean(input.status) && clean(input.status) !== 'all') {
    params.push(clean(input.status));
    where.push(`ps.status = $${params.length}`);
  }
  params.push(Math.min(Math.max(Number(input.limit) || 50, 1), 200));
  const result = await db.query(
    `SELECT ps.*, COUNT(pl.id)::int AS line_count
     FROM pricing_sessions ps
     LEFT JOIN pricing_lines pl ON pl.pricing_session_id = ps.id AND pl.store_id = ps.store_id
     WHERE ${where.join(' AND ')}
     GROUP BY ps.id
     ORDER BY ps.pricing_date DESC, ps.version_number DESC, ps.created_at DESC
     LIMIT $${params.length}`,
    params
  );
  return { results: result.rows };
}

async function getCurrentPricingSession(db, storeId, input = {}) {
  const date = isoDate(input.date || input.pricing_date);
  const result = await db.query(
    `SELECT *
     FROM pricing_sessions
     WHERE store_id = $1 AND pricing_date = $2::date
       AND status = 'published' AND is_active_publication = true
     LIMIT 1`,
    [storeId, date]
  );
  if (result.rows[0]) return getPricingSession(db, storeId, { id: result.rows[0].id });
  return { exists: false, session: null, lines: [] };
}

async function tariffJsonSelect() {
  return `COALESCE(jsonb_agg(jsonb_build_object(
      'id', plt.id,
      'tariff_level_id', tl.id,
      'code', tl.code,
      'name', tl.name,
      'legacy_level', tl.legacy_level,
      'display_order', tl.display_order,
      'price_ht', plt.price_ht,
      'source', plt.source,
      'margin_ht', CASE WHEN plt.price_ht IS NULL THEN NULL ELSE (plt.price_ht - pl.cost_rendered_ht) END,
      'margin_rate', CASE WHEN plt.price_ht IS NULL OR plt.price_ht = 0 THEN NULL ELSE ((plt.price_ht - pl.cost_rendered_ht) / plt.price_ht) END
    ) ORDER BY tl.display_order ASC) FILTER (WHERE tl.id IS NOT NULL), '[]'::jsonb) AS tariffs`;
}

async function listPricingLines(db, storeId, input = {}) {
  const params = [storeId];
  const where = ['pl.store_id = $1'];
  if (clean(input.session_id || input.pricing_session_id)) {
    params.push(clean(input.session_id || input.pricing_session_id));
    where.push(`pl.pricing_session_id = $${params.length}`);
  }
  if (clean(input.pricing_line_id || input.line_id || input.id)) {
    params.push(clean(input.pricing_line_id || input.line_id || input.id));
    where.push(`pl.id = $${params.length}`);
  }
  if (clean(input.article_id)) {
    params.push(clean(input.article_id));
    where.push(`pl.article_id = $${params.length}`);
  }
  if (clean(input.supplier_id)) {
    params.push(clean(input.supplier_id));
    where.push(`pl.supplier_id = $${params.length}`);
  }
  if (clean(input.query)) {
    params.push(`%${clean(input.query)}%`);
    where.push(`(pl.designation_snapshot ILIKE $${params.length} OR pl.plu_snapshot ILIKE $${params.length} OR s.name ILIKE $${params.length})`);
  }
  if (input.missing_tariff_level_id || input.missing_legacy_level) {
    const level = await getTariffLevel(db, storeId, {
      id: input.missing_tariff_level_id,
      legacy_level: input.missing_legacy_level,
    });
    if (level) {
      params.push(level.id);
      where.push(`NOT EXISTS (
        SELECT 1 FROM pricing_line_tariffs m
        WHERE m.pricing_line_id = pl.id AND m.tariff_level_id = $${params.length} AND m.price_ht IS NOT NULL
      )`);
    }
  }
  params.push(Math.min(Math.max(Number(input.limit) || 300, 1), 1000));
  const result = await db.query(
    `SELECT pl.*, a.designation AS article_designation, s.name AS supplier_name,
            ${await tariffJsonSelect()}
     FROM pricing_lines pl
     LEFT JOIN articles a ON a.id = pl.article_id AND a.store_id = pl.store_id
     LEFT JOIN suppliers s ON s.id = pl.supplier_id AND s.store_id = pl.store_id
     LEFT JOIN pricing_line_tariffs plt ON plt.pricing_line_id = pl.id AND plt.store_id = pl.store_id
     LEFT JOIN tariff_levels tl ON tl.id = plt.tariff_level_id AND tl.store_id = pl.store_id
     WHERE ${where.join(' AND ')}
     GROUP BY pl.id, a.designation, s.name
     ORDER BY pl.display_order ASC, pl.designation_snapshot ASC
     LIMIT $${params.length}`,
    params
  );
  return { results: result.rows };
}

async function getPricingSession(db, storeId, input = {}) {
  const params = [storeId];
  let where;
  if (clean(input.id || input.pricing_session_id)) {
    params.push(clean(input.id || input.pricing_session_id));
    where = `id = $${params.length}`;
  } else {
    params.push(isoDate(input.date || input.pricing_date));
    where = `pricing_date = $${params.length}::date`;
    if (input.status === 'published') where += ` AND status = 'published' AND is_active_publication = true`;
  }
  const header = await db.query(`SELECT * FROM pricing_sessions WHERE store_id = $1 AND ${where} ORDER BY version_number DESC LIMIT 1`, params);
  const session = header.rows[0];
  if (!session) return { exists: false, session: null, lines: [] };
  const lines = await listPricingLines(db, storeId, { pricing_session_id: session.id, limit: input.limit || 1000 });
  return { exists: true, session, lines: lines.results };
}

async function assertDraftSession(db, storeId, sessionId) {
  const result = await db.query(
    `SELECT * FROM pricing_sessions WHERE id = $1 AND store_id = $2 FOR UPDATE`,
    [sessionId, storeId]
  );
  const session = result.rows[0];
  if (!session) throw expose(404, 'Session tarification introuvable');
  if (session.status !== 'draft') throw expose(409, 'Une session publiee ne peut pas etre modifiee');
  return session;
}

async function fetchArticle(db, storeId, articleId) {
  if (!clean(articleId)) return null;
  const result = await db.query(
    `SELECT id, plu, designation, family_code, family_name, sale_unit, unit,
            sale_price_level_1_ht, sale_price_level_2_ht, sale_price_level_3_ht
     FROM articles
     WHERE id = $1 AND store_id = $2 AND is_active = true
     LIMIT 1`,
    [articleId, storeId]
  );
  if (!result.rows[0]) throw expose(404, 'Article introuvable');
  return result.rows[0];
}

async function assertStoreSupplier(db, storeId, supplierId) {
  const id = clean(supplierId);
  if (!id) return null;
  const result = await db.query(
    `SELECT id, name
     FROM suppliers
     WHERE id = $1 AND store_id = $2 AND COALESCE(status, 'active') <> 'inactive'
     LIMIT 1`,
    [id, storeId]
  );
  if (!result.rows[0]) throw expose(404, 'Fournisseur introuvable pour ce magasin');
  return result.rows[0];
}

async function createPricingSession(db, storeId, input = {}, context = {}) {
  return inTransaction(db, async (client) => {
    const date = isoDate(input.pricing_date || input.date);
    const version = await nextSessionVersion(client, storeId, date);
    const result = await client.query(
      `INSERT INTO pricing_sessions (store_id, pricing_date, title, notes, version_number, created_by, updated_by)
       VALUES ($1, $2::date, $3, $4, $5, $6, $6)
       RETURNING *`,
      [storeId, date, clean(input.title) || `Tarification du ${date}`, clean(input.notes), version, context.user_id || null]
    );
    return getPricingSession(client, storeId, { id: result.rows[0].id });
  });
}

async function duplicatePricingSession(db, storeId, input = {}, context = {}) {
  return inTransaction(db, async (client) => {
    const date = isoDate(input.pricing_date || input.date);
    const sourceId = clean(input.source_session_id);
    const source = sourceId
      ? (await client.query('SELECT * FROM pricing_sessions WHERE id = $1 AND store_id = $2', [sourceId, storeId])).rows[0]
      : (await client.query(
        `SELECT * FROM pricing_sessions
         WHERE store_id = $1 AND pricing_date < $2::date
         ORDER BY pricing_date DESC, is_active_publication DESC, version_number DESC
         LIMIT 1`,
        [storeId, date]
      )).rows[0];
    if (!source) throw expose(404, 'Aucune tarification precedente a dupliquer');
    const version = await nextSessionVersion(client, storeId, date);
    const created = await client.query(
      `INSERT INTO pricing_sessions (store_id, pricing_date, title, notes, version_number, source_session_id, created_by, updated_by)
       VALUES ($1, $2::date, $3, $4, $5, $6, $7, $7)
       RETURNING *`,
      [storeId, date, clean(input.title) || `Tarification du ${date}`, clean(input.notes), version, source.id, context.user_id || null]
    );
    const newSessionId = created.rows[0].id;
    const sourceLines = await client.query(
      `SELECT *
       FROM pricing_lines
       WHERE store_id = $1 AND pricing_session_id = $2
       ORDER BY display_order ASC, created_at ASC, id ASC`,
      [storeId, source.id]
    );
    const lineIdMap = new Map();
    for (const line of sourceLines.rows) {
      const copied = await client.query(
        `INSERT INTO pricing_lines (
          store_id, pricing_session_id, article_id, supplier_id, plu_snapshot, designation_snapshot,
          family_code, family_name, sale_unit, price_unit, purchase_price_ht, purchase_price_source,
          supplier_designation_original, transport_cost_ht, transport_cost_source, transport_cost_forced,
          display_order, exclude_from_mercuriale, notes, created_by, updated_by
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'duplicated',$12,$13,$14,$15,$16,$17,$18,$19,$19
        )
        RETURNING id`,
        [
          storeId, newSessionId, line.article_id, line.supplier_id, line.plu_snapshot, line.designation_snapshot,
          line.family_code, line.family_name, line.sale_unit, line.price_unit, line.purchase_price_ht,
          line.supplier_designation_original, line.transport_cost_ht, line.transport_cost_source,
          line.transport_cost_forced === true, line.display_order, line.exclude_from_mercuriale === true,
          line.notes, context.user_id || null,
        ]
      );
      const newLineId = copied.rows[0].id;
      lineIdMap.set(line.id, newLineId);
      const tariffs = await client.query(
        `SELECT tariff_level_id, price_ht
         FROM pricing_line_tariffs
         WHERE store_id = $1 AND pricing_line_id = $2
         ORDER BY tariff_level_id ASC`,
        [storeId, line.id]
      );
      for (const tariff of tariffs.rows) {
        await client.query(
          `INSERT INTO pricing_line_tariffs (store_id, pricing_line_id, tariff_level_id, price_ht, source)
           VALUES ($1, $2, $3, $4, 'duplicated')`,
          [storeId, newLineId, tariff.tariff_level_id, tariff.price_ht]
        );
      }
    }
    return { ...(await getPricingSession(client, storeId, { id: newSessionId })), duplicated_line_count: lineIdMap.size };
  });
}

async function upsertLineTariffs(db, storeId, lineId, tariffs = []) {
  if (!Array.isArray(tariffs)) return;
  for (const item of tariffs) {
    const level = item.tariff_level_id
      ? await getTariffLevel(db, storeId, { id: item.tariff_level_id })
      : await getTariffLevel(db, storeId, { legacy_level: item.legacy_level || item.tariff_level, code: item.code });
    if (!level) throw expose(400, 'Niveau tarifaire introuvable');
    await db.query(
      `INSERT INTO pricing_line_tariffs (store_id, pricing_line_id, tariff_level_id, price_ht, source)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (pricing_line_id, tariff_level_id)
       DO UPDATE SET price_ht = EXCLUDED.price_ht, source = EXCLUDED.source, updated_at = now()`,
      [storeId, lineId, level.id, nonNegative(item.price_ht ?? item.price), clean(item.source) || 'manual']
    );
  }
}

async function addPricingLine(db, storeId, input = {}, context = {}) {
  return inTransaction(db, async (client) => {
    const session = await assertDraftSession(client, storeId, clean(input.pricing_session_id || input.session_id));
    const article = await fetchArticle(client, storeId, clean(input.article_id));
    const supplier = await assertStoreSupplier(client, storeId, input.supplier_id);
    const nextOrder = Number.isInteger(Number(input.display_order)) ? Number(input.display_order) : (await client.query(
      'SELECT COALESCE(MAX(display_order), 0)::int + 1 AS n FROM pricing_lines WHERE store_id = $1 AND pricing_session_id = $2',
      [storeId, session.id]
    )).rows[0].n;
    const designation = clean(input.designation_snapshot || input.designation) || article?.designation;
    if (!designation) throw expose(400, 'designation ou article_id requis');
    const inserted = await client.query(
      `INSERT INTO pricing_lines (
        store_id, pricing_session_id, article_id, supplier_id, plu_snapshot, designation_snapshot,
        family_code, family_name, sale_unit, price_unit, purchase_price_ht, purchase_price_source,
        supplier_designation_original, transport_cost_ht, transport_cost_source, transport_cost_forced,
        display_order, exclude_from_mercuriale, notes, created_by, updated_by
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$20
      ) RETURNING *`,
      [
        storeId, session.id, article?.id || null, supplier?.id || null,
        article?.plu || clean(input.plu), designation,
        article?.family_code || clean(input.family_code), article?.family_name || clean(input.family_name),
        clean(input.sale_unit) || article?.sale_unit || article?.unit || 'kg',
        clean(input.price_unit) || article?.sale_unit || article?.unit || 'kg',
        nonNegative(input.purchase_price_ht ?? input.purchase_price), clean(input.purchase_price_source) || 'manual',
        clean(input.supplier_designation_original),
        nonNegative(input.transport_cost_ht ?? input.transport_cost, 0), clean(input.transport_cost_source) || 'manual',
        input.transport_cost_forced === true,
        nextOrder, input.exclude_from_mercuriale === true, clean(input.notes), context.user_id || null,
      ]
    );
    const line = inserted.rows[0];
    const defaultTariffs = Array.isArray(input.tariffs) ? input.tariffs : [
      { legacy_level: 1, price_ht: input.sale_price_level_1_ht ?? input.tariff_1 },
      { legacy_level: 2, price_ht: input.sale_price_level_2_ht ?? input.tariff_2 },
      { legacy_level: 3, price_ht: input.sale_price_level_3_ht ?? input.tariff_3 },
    ].filter((item) => item.price_ht !== undefined);
    await upsertLineTariffs(client, storeId, line.id, defaultTariffs);
    return getPricingLine(client, storeId, { id: line.id });
  });
}

async function updatePricingLine(db, storeId, input = {}, context = {}) {
  return inTransaction(db, async (client) => {
    const lineId = clean(input.pricing_line_id || input.line_id || input.id);
    const current = (await client.query('SELECT * FROM pricing_lines WHERE id = $1 AND store_id = $2 FOR UPDATE', [lineId, storeId])).rows[0];
    if (!current) throw expose(404, 'Ligne tarification introuvable');
    await assertDraftSession(client, storeId, current.pricing_session_id);
    const article = input.article_id !== undefined ? await fetchArticle(client, storeId, clean(input.article_id)) : null;
    const supplier = input.supplier_id !== undefined ? await assertStoreSupplier(client, storeId, input.supplier_id) : null;
    const next = {
      article_id: input.article_id !== undefined ? article?.id || null : current.article_id,
      supplier_id: input.supplier_id !== undefined ? supplier?.id || null : current.supplier_id,
      plu_snapshot: article?.plu || (input.plu !== undefined ? clean(input.plu) : current.plu_snapshot),
      designation_snapshot: article?.designation || (input.designation_snapshot !== undefined || input.designation !== undefined ? clean(input.designation_snapshot || input.designation) : current.designation_snapshot),
      family_code: article?.family_code || (input.family_code !== undefined ? clean(input.family_code) : current.family_code),
      family_name: article?.family_name || (input.family_name !== undefined ? clean(input.family_name) : current.family_name),
      sale_unit: input.sale_unit !== undefined ? clean(input.sale_unit) : current.sale_unit,
      price_unit: input.price_unit !== undefined ? clean(input.price_unit) : current.price_unit,
      purchase_price_ht: input.purchase_price_ht !== undefined || input.purchase_price !== undefined ? nonNegative(input.purchase_price_ht ?? input.purchase_price) : current.purchase_price_ht,
      purchase_price_source: clean(input.purchase_price_source) || current.purchase_price_source,
      supplier_designation_original: input.supplier_designation_original !== undefined ? clean(input.supplier_designation_original) : current.supplier_designation_original,
      transport_cost_ht: input.transport_cost_ht !== undefined || input.transport_cost !== undefined ? nonNegative(input.transport_cost_ht ?? input.transport_cost, 0) : current.transport_cost_ht,
      transport_cost_source: clean(input.transport_cost_source) || current.transport_cost_source,
      transport_cost_forced: input.transport_cost_forced !== undefined ? input.transport_cost_forced === true : current.transport_cost_forced,
      exclude_from_mercuriale: input.exclude_from_mercuriale !== undefined ? input.exclude_from_mercuriale === true : current.exclude_from_mercuriale,
      notes: input.notes !== undefined ? clean(input.notes) : current.notes,
    };
    if (!next.designation_snapshot) throw expose(400, 'designation requise');
    await client.query(
      `UPDATE pricing_lines
       SET article_id=$3, supplier_id=$4, plu_snapshot=$5, designation_snapshot=$6,
           family_code=$7, family_name=$8, sale_unit=$9, price_unit=$10,
           purchase_price_ht=$11, purchase_price_source=$12, supplier_designation_original=$13,
           transport_cost_ht=$14, transport_cost_source=$15, transport_cost_forced=$16,
           exclude_from_mercuriale=$17, notes=$18, updated_by=$19, updated_at=now()
       WHERE store_id=$1 AND id=$2`,
      [
        storeId, lineId, next.article_id, next.supplier_id, next.plu_snapshot, next.designation_snapshot,
        next.family_code, next.family_name, next.sale_unit, next.price_unit, next.purchase_price_ht,
        next.purchase_price_source, next.supplier_designation_original, next.transport_cost_ht,
        next.transport_cost_source, next.transport_cost_forced, next.exclude_from_mercuriale,
        next.notes, context.user_id || null,
      ]
    );
    await upsertLineTariffs(client, storeId, lineId, input.tariffs || []);
    return getPricingLine(client, storeId, { id: lineId });
  });
}

async function removePricingLine(db, storeId, input = {}) {
  return inTransaction(db, async (client) => {
    const lineId = clean(input.pricing_line_id || input.line_id || input.id);
    const current = (await client.query('SELECT * FROM pricing_lines WHERE id = $1 AND store_id = $2 FOR UPDATE', [lineId, storeId])).rows[0];
    if (!current) throw expose(404, 'Ligne tarification introuvable');
    await assertDraftSession(client, storeId, current.pricing_session_id);
    await client.query('DELETE FROM pricing_lines WHERE id = $1 AND store_id = $2', [lineId, storeId]);
    return { ok: true, deleted: true, before: current };
  });
}

async function getPricingLine(db, storeId, input = {}) {
  const id = clean(input.pricing_line_id || input.line_id || input.id);
  const result = await listPricingLines(db, storeId, { pricing_line_id: id, limit: 1 });
  if (result.results[0]) return result.results[0];
  const byId = await db.query(
    `SELECT pl.*, ${await tariffJsonSelect()}
     FROM pricing_lines pl
     LEFT JOIN pricing_line_tariffs plt ON plt.pricing_line_id = pl.id AND plt.store_id = pl.store_id
     LEFT JOIN tariff_levels tl ON tl.id = plt.tariff_level_id AND tl.store_id = pl.store_id
     WHERE pl.store_id = $1 AND pl.id = $2
     GROUP BY pl.id`,
    [storeId, id]
  );
  return byId.rows[0] || null;
}

async function syncPublishedSessionToCallSheet(db, storeId, sessionId, context = {}) {
  const detail = await getPricingSession(db, storeId, { id: sessionId, limit: 2000 });
  const session = detail.session;
  const legacyLevels = await listTariffLevels(db, storeId, {});
  const byLegacy = new Map(legacyLevels.results.filter((l) => l.legacy_level).map((l) => [Number(l.legacy_level), l.id]));
  const header = await db.query(
    `INSERT INTO quick_order_sheets (store_id, sheet_date, title, notes, created_by, updated_by)
     VALUES ($1, $2::date, $3, $4, $5, $5)
     ON CONFLICT (store_id, sheet_date)
     DO UPDATE SET title = EXCLUDED.title, notes = EXCLUDED.notes, updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING id`,
    [storeId, session.pricing_date, session.title || `Tarification du ${session.pricing_date}`, 'Miroir genere depuis le module Tarification', context.user_id || null]
  );
  const sheetId = header.rows[0].id;
  await db.query('DELETE FROM quick_order_sheet_products WHERE store_id = $1 AND sheet_id = $2', [storeId, sheetId]);
  for (const line of detail.lines) {
    const tariffByLevel = new Map((line.tariffs || []).map((t) => [t.tariff_level_id, t.price_ht]));
    await db.query(
      `INSERT INTO quick_order_sheet_products (
        store_id, sheet_id, column_uid, article_id, supplier_id, plu, designation_snapshot,
        display_order, purchase_price_ht, price_unit,
        sale_price_level_1_ht, sale_price_level_2_ht, sale_price_level_3_ht,
        manual_price_level_1, manual_price_level_2, manual_price_level_3,
        family_code, family_name, sale_unit, pricing_session_id, pricing_line_id,
        tariff_prices, transport_cost_ht, cost_rendered_ht
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,true,true,$14,$15,$16,$17,$18,$19::jsonb,$20,$21
      )`,
      [
        storeId, sheetId, `pricing-${line.id}`, line.article_id, line.supplier_id, line.plu_snapshot,
        line.designation_snapshot, line.display_order, line.purchase_price_ht, line.price_unit,
        tariffByLevel.get(byLegacy.get(1)) ?? null,
        tariffByLevel.get(byLegacy.get(2)) ?? null,
        tariffByLevel.get(byLegacy.get(3)) ?? null,
        line.family_code, line.family_name, line.sale_unit, session.id, line.id,
        JSON.stringify(line.tariffs || []), line.transport_cost_ht || 0, line.cost_rendered_ht || 0,
      ]
    );
  }
  return { sheet_id: sheetId, mirrored_line_count: detail.lines.length };
}

async function publishPricingSession(db, storeId, input = {}, context = {}) {
  return inTransaction(db, async (client) => {
    const sessionId = clean(input.pricing_session_id || input.session_id || input.id);
    const session = await assertDraftSession(client, storeId, sessionId);
    const lines = await listPricingLines(client, storeId, { pricing_session_id: session.id, limit: 2000 });
    if (!lines.results.length) throw expose(400, 'Impossible de publier une session sans ligne');
    const missingArticle = lines.results.find((line) => !line.article_id);
    if (missingArticle) throw expose(400, `Ligne sans article ALTA: ${missingArticle.designation_snapshot}`);
    await client.query(
      `UPDATE pricing_sessions
       SET status = 'superseded', is_active_publication = false, superseded_at = now(), updated_at = now()
       WHERE store_id = $1 AND pricing_date = $2::date AND status = 'published' AND is_active_publication = true AND id <> $3`,
      [storeId, session.pricing_date, session.id]
    );
    await client.query(
      `UPDATE pricing_sessions
       SET status = 'published', is_active_publication = true, published_at = now(), published_by = $3, updated_by = $3, updated_at = now()
       WHERE store_id = $1 AND id = $2`,
      [storeId, session.id, context.user_id || null]
    );
    const mirror = input.sync_call_sheet === false ? null : await syncPublishedSessionToCallSheet(client, storeId, session.id, context);
    return { ...(await getPricingSession(client, storeId, { id: session.id })), mirror };
  });
}

async function resolvePublishedPrice(db, storeId, input = {}) {
  const date = isoDate(input.date || input.pricing_date || input.document_date);
  const { client, tariff_level: level } = await resolveClientTariffLevel(db, storeId, input.client_id);
  if (!level) throw expose(404, 'Niveau tarifaire client introuvable');
  const result = await db.query(
    `SELECT ps.id AS pricing_session_id, pl.id AS pricing_line_id, pl.article_id,
            plt.tariff_level_id, plt.price_ht AS source_tariff_price_ht,
            ss.royale_maree_commission_eur_per_kg
     FROM pricing_sessions ps
     JOIN pricing_lines pl ON pl.pricing_session_id = ps.id AND pl.store_id = ps.store_id
     JOIN pricing_line_tariffs plt ON plt.pricing_line_id = pl.id AND plt.store_id = pl.store_id
     LEFT JOIN store_settings ss ON ss.store_id = ps.store_id
     WHERE ps.store_id = $1
       AND ps.pricing_date = $2::date
       AND ps.status = 'published'
       AND ps.is_active_publication = true
       AND pl.article_id = $3
       AND plt.tariff_level_id = $4
       AND plt.price_ht IS NOT NULL
     LIMIT 1`,
    [storeId, date, clean(input.article_id), level.id]
  );
  const row = result.rows[0];
  if (!row) return { found: false, client, tariff_level: level, date };
  const finalPrice = getCustomerDisplayedPrice({
    price: row.source_tariff_price_ht,
    pricingLevel: level.legacy_level,
    client,
    storeSettings: row,
  });
  const commission = Number((Number(finalPrice || 0) - Number(row.source_tariff_price_ht || 0)).toFixed(4));
  return {
    found: true,
    client,
    tariff_level: level,
    date,
    pricing_session_id: row.pricing_session_id,
    pricing_line_id: row.pricing_line_id,
    tariff_level_id: row.tariff_level_id,
    source_tariff_price_ht: row.source_tariff_price_ht === null ? null : Number(row.source_tariff_price_ht),
    royale_maree_commission_ht: Math.max(0, commission || 0),
    royale_maree_commission_setting: royaleMareeCommissionAmount(row),
    final_unit_price_ht: Number(finalPrice),
  };
}

function salesLineHasPricingSnapshot(line = {}) {
  return Boolean(
    clean(line.pricing_session_id)
    && clean(line.pricing_line_id)
    && clean(line.tariff_level_id)
    && line.source_tariff_price_ht !== undefined
    && line.source_tariff_price_ht !== null
    && line.royale_maree_commission_ht !== undefined
    && line.royale_maree_commission_ht !== null
    && line.final_unit_price_ht !== undefined
    && line.final_unit_price_ht !== null
    && line.unit_sale_price_ht !== undefined
    && line.unit_sale_price_ht !== null
  );
}

function salesLineHasExplicitManualPrice(body = {}) {
  return body.unit_sale_price_ht !== undefined && body.unit_sale_price_ht !== null && body.unit_sale_price_ht !== '';
}

function shouldResolveSalesLinePricing(body = {}, line = {}) {
  if (body.reprice_from_pricing === true || body.resolve_pricing === true) return true;
  if (salesLineHasExplicitManualPrice(body)) return false;
  if (salesLineHasPricingSnapshot(line)) return false;
  return Number(line.unit_sale_price_ht || 0) <= 0;
}

function buildSalesLinePricingTrace(body = {}, line = {}, resolvedPricing = { found: false }, computedUnitPrice = null) {
  if (salesLineHasExplicitManualPrice(body)) {
    return {
      mode: 'manual_override',
      found: false,
      pricing_session_id: null,
      pricing_line_id: null,
      tariff_level_id: null,
      source_tariff_price_ht: null,
      royale_maree_commission_ht: null,
      final_unit_price_ht: computedUnitPrice,
    };
  }
  if (resolvedPricing && resolvedPricing.found) {
    return { mode: 'resolved', ...resolvedPricing };
  }
  if (salesLineHasPricingSnapshot(line)) {
    return {
      mode: 'preserved',
      found: false,
      pricing_session_id: line.pricing_session_id,
      pricing_line_id: line.pricing_line_id,
      tariff_level_id: line.tariff_level_id,
      source_tariff_price_ht: line.source_tariff_price_ht,
      royale_maree_commission_ht: line.royale_maree_commission_ht,
      final_unit_price_ht: line.final_unit_price_ht,
    };
  }
  return {
    mode: 'none',
    found: false,
    pricing_session_id: null,
    pricing_line_id: null,
    tariff_level_id: null,
    source_tariff_price_ht: null,
    royale_maree_commission_ht: null,
    final_unit_price_ht: computedUnitPrice,
  };
}

async function getArticlePricingHistory(db, storeId, input = {}) {
  const articleId = clean(input.article_id);
  if (!articleId) throw expose(400, 'article_id requis');
  const result = await db.query(
    `SELECT ps.pricing_date, ps.status, ps.version_number, ps.is_active_publication,
            pl.*, ${await tariffJsonSelect()}
     FROM pricing_lines pl
     JOIN pricing_sessions ps ON ps.id = pl.pricing_session_id AND ps.store_id = pl.store_id
     LEFT JOIN pricing_line_tariffs plt ON plt.pricing_line_id = pl.id AND plt.store_id = pl.store_id
     LEFT JOIN tariff_levels tl ON tl.id = plt.tariff_level_id AND tl.store_id = pl.store_id
     WHERE pl.store_id = $1 AND pl.article_id = $2
     GROUP BY ps.pricing_date, ps.status, ps.version_number, ps.is_active_publication, pl.id
     ORDER BY ps.pricing_date DESC, ps.version_number DESC
     LIMIT $3`,
    [storeId, articleId, Math.min(Math.max(Number(input.limit) || 100, 1), 500)]
  );
  return { results: result.rows };
}

async function searchSupplierArticleMappings(db, storeId, input = {}) {
  const params = [storeId];
  const where = ['sam.store_id = $1'];
  if (clean(input.supplier_id)) {
    params.push(clean(input.supplier_id));
    where.push(`sam.supplier_id = $${params.length}`);
  }
  if (input.include_inactive !== true) where.push('COALESCE(sam.is_active, true) = true');
  if (clean(input.query)) {
    params.push(`%${clean(input.query)}%`);
    where.push(`(sam.supplier_ref ILIKE $${params.length} OR sam.supplier_label ILIKE $${params.length} OR sam.supplier_designation_normalized ILIKE $${params.length} OR a.designation ILIKE $${params.length})`);
  }
  params.push(Math.min(Math.max(Number(input.limit) || 200, 1), 1000));
  const result = await db.query(
    `SELECT sam.*, s.name AS supplier_name, a.plu AS article_plu, a.designation AS article_designation
     FROM supplier_article_mappings sam
     LEFT JOIN suppliers s ON s.id = sam.supplier_id AND s.store_id = sam.store_id
     LEFT JOIN articles a ON a.id = sam.article_id AND a.store_id = sam.store_id
     WHERE ${where.join(' AND ')}
     ORDER BY s.name ASC, sam.supplier_ref ASC
     LIMIT $${params.length}`,
    params
  );
  return { results: result.rows };
}

async function upsertSupplierArticleMapping(db, storeId, input = {}, context = {}) {
  return inTransaction(db, async (client) => {
    const supplierId = clean(input.supplier_id);
    const articleId = clean(input.article_id);
    const original = clean(input.supplier_designation_original || input.supplier_ref || input.supplier_label);
    if (!supplierId || !articleId || !original) throw expose(400, 'supplier_id, article_id et designation fournisseur requis');
    const supplier = await assertStoreSupplier(client, storeId, supplierId);
    const article = await fetchArticle(client, storeId, articleId);
    if (!article) throw expose(404, 'Article introuvable');
    const normalized = normalizeSupplierDesignation(input.supplier_designation_normalized || original);
    const existing = await client.query(
      `SELECT id
       FROM supplier_article_mappings
       WHERE store_id = $1 AND supplier_id = $2 AND COALESCE(is_active, true) = true
         AND (supplier_designation_normalized = $3 OR supplier_ref = $4)
       ORDER BY CASE WHEN supplier_designation_normalized = $3 THEN 0 ELSE 1 END, updated_at DESC NULLS LAST, created_at DESC NULLS LAST
       LIMIT 1
       FOR UPDATE`,
      [storeId, supplier.id, normalized, original]
    );
    const params = [
      storeId, supplier.id, article.id, original, clean(input.supplier_label) || original,
      original, normalized, clean(input.mapping_source) || 'manual',
      num(input.confidence_score, 100), context.user_id || null,
    ];
    await client.query(
      `UPDATE supplier_article_mappings
       SET is_active = false, updated_by = $5, updated_at = now()
       WHERE store_id = $1 AND supplier_id = $2
         AND ($3::uuid IS NULL OR id <> $3::uuid)
         AND COALESCE(is_active, true) = true
         AND (supplier_designation_normalized = $4 OR supplier_ref = $6)`,
      [storeId, supplier.id, existing.rows[0]?.id || null, normalized, context.user_id || null, original]
    );
    const result = existing.rows[0]
      ? await client.query(
        `UPDATE supplier_article_mappings
         SET article_id = $3,
             supplier_ref = $4,
             supplier_label = $5,
             supplier_designation_original = $6,
             supplier_designation_normalized = $7,
             mapping_source = $8,
             confidence_score = $9,
             is_active = true,
             updated_by = $10,
             updated_at = now()
         WHERE id = $11 AND store_id = $1 AND supplier_id = $2
         RETURNING id`,
        [...params, existing.rows[0].id]
      )
      : await client.query(
        `INSERT INTO supplier_article_mappings (
          store_id, supplier_id, article_id, supplier_ref, supplier_label,
          supplier_designation_original, supplier_designation_normalized,
          mapping_source, confidence_score, is_active, created_by, updated_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10,$10)
        RETURNING id`,
        params
      );
    await client.query(
      `UPDATE supplier_article_mappings
       SET is_active = false, updated_by = $5, updated_at = now()
       WHERE store_id = $1 AND supplier_id = $2 AND id <> $3
         AND COALESCE(is_active, true) = true
         AND (supplier_designation_normalized = $4 OR supplier_ref = $6)`,
      [
        storeId, supplier.id, result.rows[0].id, normalized, context.user_id || null, original,
      ]
    );
    const found = await searchSupplierArticleMappings(client, storeId, { query: original, supplier_id: supplier.id, limit: 1 });
    return found.results.find((row) => row.id === result.rows[0].id) || found.results[0];
  });
}

async function matchSupplierLine(db, storeId, supplierId, designation) {
  const normalized = normalizeSupplierDesignation(designation);
  const known = await db.query(
    `SELECT sam.*, a.plu AS article_plu, a.designation AS article_designation
     FROM supplier_article_mappings sam
     JOIN articles a ON a.id = sam.article_id AND a.store_id = sam.store_id
     WHERE sam.store_id = $1 AND sam.supplier_id = $2
       AND sam.supplier_designation_normalized = $3
       AND COALESCE(sam.is_active, true) = true
     LIMIT 1`,
    [storeId, supplierId, normalized]
  );
  if (known.rows[0]) {
    return {
      status: 'certain',
      method: 'known_mapping',
      confidence: 100,
      article: {
        id: known.rows[0].article_id,
        article_plu: known.rows[0].article_plu,
        article_designation: known.rows[0].article_designation,
      },
      mapping_id: known.rows[0].id,
      normalized,
    };
  }

  const exact = await db.query(
    `SELECT id, plu AS article_plu, designation AS article_designation
     FROM articles
     WHERE store_id = $1 AND is_active = true
       AND lower(regexp_replace(trim(designation), '\\s+', ' ', 'g')) = $2
     LIMIT 2`,
    [storeId, normalized]
  );
  if (exact.rows.length === 1) return { status: 'probable', method: 'normalized_exact_article', confidence: 85, article: exact.rows[0], mapping_id: null, normalized };

  const code = normalizeCode(designation);
  if (code) {
    const plu = await db.query(
      `SELECT id, plu AS article_plu, designation AS article_designation
       FROM articles
       WHERE store_id = $1 AND is_active = true AND regexp_replace(upper(plu), '[^A-Z0-9]+', '', 'g') = $2
       LIMIT 1`,
      [storeId, code]
    );
    if (plu.rows[0]) return { status: 'probable', method: 'plu_alias', confidence: 80, article: plu.rows[0], mapping_id: null, normalized };
  }

  const words = normalized.split(' ').filter((w) => w.length >= 3).slice(0, 4);
  if (words.length) {
    const params = [storeId, ...words.map((w) => `%${w}%`)];
    const where = words.map((_, index) => `lower(a.designation) LIKE $${index + 2}`).join(' AND ');
    const fuzzy = await db.query(
      `SELECT a.id, a.plu AS article_plu, a.designation AS article_designation
       FROM articles a
       WHERE a.store_id = $1 AND a.is_active = true AND ${where}
       ORDER BY a.designation ASC
       LIMIT 2`,
      params
    );
    if (fuzzy.rows.length === 1) return { status: 'probable', method: 'text_similarity', confidence: 65, article: fuzzy.rows[0], mapping_id: null, normalized };
  }

  return { status: 'unrecognized', method: 'none', confidence: 0, article: null, mapping_id: null, normalized };
}

function parseSupplierTextLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.*?)[;\t ]+(\d+(?:[,.]\d{1,4})?)\s*(?:€|eur)?\s*$/i);
      if (!match) return { supplier_designation_original: line, purchase_price_ht: null, warnings: ['prix introuvable'] };
      return {
        supplier_designation_original: match[1].trim(),
        purchase_price_ht: Number(match[2].replace(',', '.')),
        warnings: [],
      };
    });
}

function parseSupplierProductTextLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.*?)(?:[;\t]|\s+-\s+|\s+)(\d+(?:[,.]\d{1,4})?)\s*(?:eur)?\s*$/i);
      if (!match) return { supplier_designation_original: line, purchase_price_ht: null, warnings: ['prix introuvable'] };
      const designation = match[1].replace(/^[^a-zA-Z0-9]+/, '').replace(/[^a-zA-Z0-9]+$/, '').trim();
      return {
        supplier_designation_original: designation || match[1].trim(),
        purchase_price_ht: Number(match[2].replace(',', '.')),
        raw_source_text: line,
        warnings: [],
      };
    });
}

async function createSupplierPriceImport(db, storeId, input = {}, context = {}) {
  return inTransaction(db, async (client) => {
    const supplierId = clean(input.supplier_id);
    if (!supplierId) throw expose(400, 'supplier_id requis');
    const supplier = await assertStoreSupplier(client, storeId, supplierId);
    const rows = Array.isArray(input.lines) ? input.lines : parseSupplierProductTextLines(input.raw_text || input.text);
    if (!rows.length) throw expose(400, 'Aucune ligne fournisseur exploitable');
    const header = await client.query(
      `INSERT INTO supplier_price_imports (store_id, supplier_id, import_date, source_type, original_filename, raw_text, status, metadata, created_by)
       VALUES ($1,$2,$3::date,$4,$5,$6,'parsed',$7::jsonb,$8)
       RETURNING *`,
      [
        storeId, supplier.id, isoDate(input.import_date || input.date), clean(input.source_type) || 'text',
        clean(input.original_filename), input.raw_text || input.text || null,
        JSON.stringify(input.metadata || {}), context.user_id || null,
      ]
    );
    let rowNumber = 1;
    for (const raw of rows) {
      const original = clean(raw.supplier_designation_original || raw.designation || raw.label);
      if (!original) continue;
      const purchasePrice = nonNegative(raw.purchase_price_ht ?? raw.price);
      if (purchasePrice === null && input.allow_missing_prices !== true) continue;
      const match = await matchSupplierLine(client, storeId, supplier.id, original);
      await client.query(
        `INSERT INTO supplier_price_import_lines (
          store_id, import_id, supplier_id, row_number, supplier_designation_original,
          supplier_designation_normalized, unit, caliber, availability, purchase_price_ht,
          price_unit, matched_article_id, mapping_id, match_status, match_method,
          confidence_score, user_decision, decided_by, decided_at, decision_source,
          raw_source_text, source_page, source_filename, source_metadata, warnings
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24::jsonb,$25::jsonb)`,
        [
          storeId, header.rows[0].id, supplier.id, Number(raw.row_number) || rowNumber++, original, match.normalized,
          clean(raw.unit), clean(raw.caliber), clean(raw.availability),
          purchasePrice, clean(raw.price_unit) || 'kg',
          match.article?.id || null, match.mapping_id, match.status, match.method,
          match.confidence,
          'pending',
          null,
          null,
          null,
          clean(raw.raw_source_text) || original,
          raw.source_page === undefined || raw.source_page === null ? null : Number(raw.source_page),
          clean(raw.source_filename || input.original_filename),
          JSON.stringify(raw.source_metadata || {}),
          JSON.stringify(raw.warnings || []),
        ]
      );
    }
    return getSupplierPriceImport(client, storeId, { id: header.rows[0].id });
  });
}

async function listSupplierPriceImports(db, storeId, input = {}) {
  const params = [storeId];
  let where = 'WHERE spi.store_id = $1';
  if (clean(input.supplier_id)) {
    params.push(clean(input.supplier_id));
    where += ` AND spi.supplier_id = $${params.length}`;
  }
  params.push(Math.min(Math.max(Number(input.limit) || 50, 1), 200));
  const result = await db.query(
    `SELECT spi.*, s.name AS supplier_name, COUNT(spil.id)::int AS line_count,
            COUNT(spil.id) FILTER (WHERE spil.match_status = 'unrecognized')::int AS unrecognized_count,
            COUNT(spil.id) FILTER (WHERE spil.user_decision IN ('confirmed', 'overridden'))::int AS ready_count,
            COUNT(spil.id) FILTER (WHERE spil.user_decision = 'pending')::int AS pending_count,
            COUNT(spil.id) FILTER (WHERE spil.user_decision = 'ignored')::int AS ignored_count
     FROM supplier_price_imports spi
     LEFT JOIN suppliers s ON s.id = spi.supplier_id AND s.store_id = spi.store_id
     LEFT JOIN supplier_price_import_lines spil ON spil.import_id = spi.id AND spil.store_id = spi.store_id
     ${where}
     GROUP BY spi.id, s.name
     ORDER BY spi.import_date DESC, spi.created_at DESC
     LIMIT $${params.length}`,
    params
  );
  return { results: result.rows };
}

async function listSupplierPriceImportLines(db, storeId, input = {}) {
  const importId = clean(input.import_id || input.supplier_price_import_id);
  const params = [storeId];
  let where = 'WHERE spil.store_id = $1';
  if (importId) {
    params.push(importId);
    where += ` AND spil.import_id = $${params.length}`;
  }
  if (clean(input.match_status)) {
    params.push(clean(input.match_status));
    where += ` AND spil.match_status = $${params.length}`;
  }
  if (clean(input.user_decision)) {
    params.push(clean(input.user_decision));
    where += ` AND spil.user_decision = $${params.length}`;
  }
  if (input.unresolved === true || input.unresolved === 'true') {
    where += " AND spil.user_decision = 'pending'";
  }
  const result = await db.query(
    `SELECT spil.*, a.plu AS article_plu, a.designation AS article_designation, s.name AS supplier_name
     FROM supplier_price_import_lines spil
     LEFT JOIN articles a ON a.id = spil.matched_article_id AND a.store_id = spil.store_id
     LEFT JOIN suppliers s ON s.id = spil.supplier_id AND s.store_id = spil.store_id
     ${where}
     ORDER BY spil.row_number ASC`,
    params
  );
  return { results: result.rows };
}

async function getSupplierPriceImport(db, storeId, input = {}) {
  const id = clean(input.id || input.import_id);
  const header = await db.query('SELECT * FROM supplier_price_imports WHERE id = $1 AND store_id = $2 LIMIT 1', [id, storeId]);
  if (!header.rows[0]) return { exists: false, import: null, lines: [] };
  const lines = await listSupplierPriceImportLines(db, storeId, { import_id: id });
  const summary = lines.results.reduce((acc, line) => {
    acc.total += 1;
    acc.ready += ['confirmed', 'overridden'].includes(line.user_decision) ? 1 : 0;
    acc.pending += line.user_decision === 'pending' ? 1 : 0;
    acc.ignored += line.user_decision === 'ignored' ? 1 : 0;
    acc.known += line.match_method === 'known_mapping' ? 1 : 0;
    acc.proposed += line.match_status === 'probable' ? 1 : 0;
    acc.unrecognized += line.match_status === 'unrecognized' ? 1 : 0;
    return acc;
  }, { total: 0, ready: 0, pending: 0, ignored: 0, known: 0, proposed: 0, unrecognized: 0 });
  return { exists: true, import: header.rows[0], lines: lines.results, summary };
}

async function searchArticlesForSupplierMapping(db, storeId, input = {}) {
  const query = clean(input.query || input.search);
  if (!query) return { results: [] };
  const params = [storeId, `%${query}%`, Math.min(Math.max(Number(input.limit) || 20, 1), 50)];
  const result = await db.query(
    `SELECT id, plu, designation, family_code, family_name, sale_unit, unit
     FROM articles
     WHERE store_id = $1 AND is_active = true
       AND (plu ILIKE $2 OR designation ILIKE $2 OR family_name ILIKE $2 OR family_code ILIKE $2)
     ORDER BY CASE WHEN plu ILIKE $2 THEN 0 ELSE 1 END, designation ASC
     LIMIT $3`,
    params
  );
  return { results: result.rows };
}

async function getSupplierImportLineForDecision(db, storeId, lineId) {
  const result = await db.query(
    `SELECT spil.*, spi.status AS import_status
     FROM supplier_price_import_lines spil
     JOIN supplier_price_imports spi ON spi.id = spil.import_id AND spi.store_id = spil.store_id
     WHERE spil.id = $1 AND spil.store_id = $2
     FOR UPDATE OF spil`,
    [lineId, storeId]
  );
  const line = result.rows[0];
  if (!line) throw expose(404, 'Ligne import fournisseur introuvable');
  if (line.import_status === 'applied') throw expose(409, 'Import deja applique');
  return line;
}

async function getSupplierPriceImportLine(db, storeId, lineId) {
  const result = await db.query(
    `SELECT spil.*, a.plu AS article_plu, a.designation AS article_designation, s.name AS supplier_name
     FROM supplier_price_import_lines spil
     LEFT JOIN articles a ON a.id = spil.matched_article_id AND a.store_id = spil.store_id
     LEFT JOIN suppliers s ON s.id = spil.supplier_id AND s.store_id = spil.store_id
     WHERE spil.id = $1 AND spil.store_id = $2
     LIMIT 1`,
    [lineId, storeId]
  );
  return result.rows[0] || null;
}

async function confirmSupplierImportLineMapping(db, storeId, input = {}, context = {}) {
  return inTransaction(db, async (client) => {
    const line = await getSupplierImportLineForDecision(client, storeId, clean(input.import_line_id || input.line_id || input.id));
    const articleId = clean(input.article_id || line.matched_article_id);
    if (!articleId) throw expose(400, 'article_id requis pour confirmer la ligne');
    const mapping = await upsertSupplierArticleMapping(client, storeId, {
      supplier_id: line.supplier_id,
      article_id: articleId,
      supplier_designation_original: line.supplier_designation_original,
      mapping_source: 'human_validation',
      confidence_score: 100,
    }, context);
    const result = await client.query(
      `UPDATE supplier_price_import_lines
       SET matched_article_id = $3, mapping_id = $4, user_decision = 'confirmed',
           decided_by = $5, decided_at = now(), decision_source = 'human_confirmed', updated_at = now()
       WHERE id = $1 AND store_id = $2
       RETURNING *`,
      [line.id, storeId, articleId, mapping?.id || line.mapping_id || null, context.user_id || null]
    );
    return getSupplierPriceImportLine(client, storeId, result.rows[0].id);
  });
}

async function overrideSupplierImportLineMapping(db, storeId, input = {}, context = {}) {
  return inTransaction(db, async (client) => {
    const line = await getSupplierImportLineForDecision(client, storeId, clean(input.import_line_id || input.line_id || input.id));
    const article = await fetchArticle(client, storeId, clean(input.article_id));
    if (!article) throw expose(404, 'Article introuvable');
    const mapping = await upsertSupplierArticleMapping(client, storeId, {
      supplier_id: line.supplier_id,
      article_id: article.id,
      supplier_designation_original: line.supplier_designation_original,
      mapping_source: 'human_override',
      confidence_score: 100,
    }, context);
    const result = await client.query(
      `UPDATE supplier_price_import_lines
       SET matched_article_id = $3, mapping_id = $4, user_decision = 'overridden',
           decided_by = $5, decided_at = now(), decision_source = 'human_override', updated_at = now()
       WHERE id = $1 AND store_id = $2
       RETURNING *`,
      [line.id, storeId, article.id, mapping?.id || null, context.user_id || null]
    );
    return getSupplierPriceImportLine(client, storeId, result.rows[0].id);
  });
}

async function ignoreSupplierImportLine(db, storeId, input = {}, context = {}) {
  return inTransaction(db, async (client) => {
    const line = await getSupplierImportLineForDecision(client, storeId, clean(input.import_line_id || input.line_id || input.id));
    const result = await client.query(
      `UPDATE supplier_price_import_lines
       SET user_decision = 'ignored', decided_by = $3, decided_at = now(),
           decision_source = 'human_ignored', updated_at = now()
       WHERE id = $1 AND store_id = $2
       RETURNING *`,
      [line.id, storeId, context.user_id || null]
    );
    return getSupplierPriceImportLine(client, storeId, result.rows[0].id);
  });
}

async function applySupplierImportToSession(db, storeId, input = {}, context = {}) {
  return inTransaction(db, async (client) => {
    const session = await assertDraftSession(client, storeId, clean(input.pricing_session_id || input.session_id));
    const importId = clean(input.import_id || input.supplier_price_import_id);
    const header = (await client.query(
      'SELECT * FROM supplier_price_imports WHERE id = $1 AND store_id = $2 FOR UPDATE',
      [importId, storeId]
    )).rows[0];
    if (!header) throw expose(404, 'Import fournisseur introuvable pour ce magasin');
    const supplier = await assertStoreSupplier(client, storeId, header.supplier_id);
    const lines = await listSupplierPriceImportLines(client, storeId, { import_id: importId });
    let applied = 0;
    let skipped = 0;
    for (const line of lines.results) {
      if (clean(line.supplier_id) !== supplier.id) throw expose(409, 'Ligne import fournisseur incoherente');
      if (!['confirmed', 'overridden'].includes(line.user_decision) || !line.matched_article_id || line.purchase_price_ht === null) {
        skipped += 1;
        continue;
      }
      const existing = await client.query(
        'SELECT id FROM pricing_lines WHERE store_id = $1 AND pricing_session_id = $2 AND article_id = $3 LIMIT 1',
        [storeId, session.id, line.matched_article_id]
      );
      const payload = {
        pricing_session_id: session.id,
        article_id: line.matched_article_id,
        supplier_id: line.supplier_id,
        purchase_price_ht: line.purchase_price_ht,
        purchase_price_source: 'supplier_import',
        supplier_designation_original: line.supplier_designation_original,
      };
      const saved = existing.rows[0]
        ? await updatePricingLine(client, storeId, { pricing_line_id: existing.rows[0].id, ...payload }, context)
        : await addPricingLine(client, storeId, payload, context);
      await client.query(
        'UPDATE supplier_price_import_lines SET applied_pricing_line_id = $1, updated_at = now() WHERE id = $2 AND store_id = $3',
        [saved.id, line.id, storeId]
      );
      applied += 1;
    }
    await client.query("UPDATE supplier_price_imports SET status = 'applied', updated_at = now() WHERE id = $1 AND store_id = $2", [importId, storeId]);
    return {
      ok: true,
      applied_line_count: applied,
      skipped_line_count: skipped,
      ready_line_count: lines.results.filter((line) => ['confirmed', 'overridden'].includes(line.user_decision)).length,
      pending_line_count: lines.results.filter((line) => line.user_decision === 'pending').length,
      ignored_line_count: lines.results.filter((line) => line.user_decision === 'ignored').length,
      session: (await getPricingSession(client, storeId, { id: session.id })).session,
    };
  });
}

module.exports = {
  normalizeSupplierDesignation,
  listTariffLevels,
  getTariffLevel,
  resolveClientTariffLevel,
  listPricingSessions,
  getPricingSession,
  getCurrentPricingSession,
  listPricingLines,
  getPricingLine,
  createPricingSession,
  duplicatePricingSession,
  addPricingLine,
  updatePricingLine,
  removePricingLine,
  publishPricingSession,
  resolvePublishedPrice,
  salesLineHasPricingSnapshot,
  salesLineHasExplicitManualPrice,
  shouldResolveSalesLinePricing,
  buildSalesLinePricingTrace,
  getArticlePricingHistory,
  searchSupplierArticleMappings,
  upsertSupplierArticleMapping,
  createSupplierPriceImport,
  listSupplierPriceImports,
  getSupplierPriceImport,
  getSupplierPriceImportLine,
  listSupplierPriceImportLines,
  searchArticlesForSupplierMapping,
  confirmSupplierImportLineMapping,
  overrideSupplierImportLineMapping,
  ignoreSupplierImportLine,
  applySupplierImportToSession,
  syncPublishedSessionToCallSheet,
};
