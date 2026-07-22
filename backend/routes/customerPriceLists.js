const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { resolveMercurialeTargetTariff } = require('../services/customerTariffEmailService');
const { decorateLineWithDisplayedPrices } = require('../services/royaleMareeCommission');

const router = express.Router();

const COURSE_TYPES = new Set(['general', 'client', 'promotion', 'daily_arrival']);
const STATUSES = new Set(['draft', 'ready', 'archived']);
const PRICE_SOURCES = new Set(['target_tariff', 'client_tariff', 'manual', 'none']);

function requireCourseEditor(req, res, next) {
  const allowedRoles = ['admin', 'responsable', 'commercial'];
  if (!req.user || !allowedRoles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Acces refuse' });
  }
  return next();
}

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || '')
  );
}

function normalizeUuid(value) {
  const id = clean(value);
  return id && isUuid(id) ? id : null;
}

function normalizeCourseType(value) {
  const courseType = clean(value) || 'general';
  return COURSE_TYPES.has(courseType) ? courseType : 'general';
}

function normalizeStatus(value) {
  const status = clean(value) || 'draft';
  return STATUSES.has(status) ? status : 'draft';
}

function normalizePriceSource(value, fallback = 'manual') {
  const source = clean(value) || fallback;
  return PRICE_SOURCES.has(source) ? source : fallback;
}

function parseBool(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return fallback;
}

function parseNumber(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseTariffLevel(value) {
  const parsed = Number(value);
  return [1, 2, 3].includes(parsed) ? parsed : null;
}

function normalizeTargetTariff(value) {
  const text = clean(value || 'all');
  if (!text || text === 'all') return null;
  return parseTariffLevel(text);
}

function safeLimit(value, fallback = 1000, max = 2000) {
  const parsed = Number(value);
  return Math.min(Number.isFinite(parsed) && parsed > 0 ? parsed : fallback, max);
}

function priceForLevel(row, tariffLevel) {
  if (![1, 2, 3].includes(Number(tariffLevel))) return null;
  const value = row[`sale_price_level_${tariffLevel}_ht`];
  return value !== null && value !== undefined ? value : row.sale_price_ex_vat ?? null;
}

function decorateCourseLine(row, { client = null, storeSettings = {}, targetTariffLevel = null } = {}) {
  const line = {
    ...row,
    price_ht: row.price_ht ?? row.suggested_price_ht ?? null,
    price_level_1_ht: row.price_level_1_ht ?? row.sale_price_level_1_ht ?? null,
    price_level_2_ht: row.price_level_2_ht ?? row.sale_price_level_2_ht ?? null,
    price_level_3_ht: row.price_level_3_ht ?? row.sale_price_level_3_ht ?? null,
    tariff_level: row.tariff_level ?? targetTariffLevel,
  };
  return decorateLineWithDisplayedPrices(line, {
    client,
    storeSettings,
    context: {
      targetTariffLevel,
      clientOptionalTargetTariff: client ? null : targetTariffLevel,
    },
  });
}

async function fetchCommissionSettings(db, storeId) {
  const result = await db.query(
    `
    SELECT royale_maree_commission_eur_per_kg
    FROM store_settings
    WHERE store_id = $1
    LIMIT 1
    `,
    [storeId]
  );

  return result.rows[0] || {};
}

async function fetchStoreSettingsForPresentation(db, storeId) {
  const result = await db.query(
    `
    SELECT company_name, logo_url, address_line1, address_line2, postal_code, city, country,
      phone, contact_email, email, email_sender_address,
      siret, vat_number, sanitary_approval_number, legal_mentions,
      royale_maree_commission_eur_per_kg
    FROM store_settings
    WHERE store_id = $1
    LIMIT 1
    `,
    [storeId]
  );

  return result.rows[0] || {};
}

async function fetchQuickOrderSheetProducts(db, storeId, priceListDate, targetTariffLevel) {
  const date = clean(priceListDate);
  if (!date) return null;
  const sheet = await db.query(
    `SELECT id
     FROM quick_order_sheets
     WHERE store_id = $1 AND sheet_date = $2::date
     LIMIT 1`,
    [storeId, date]
  );
  if (!sheet.rows.length) return null;

  const result = await db.query(
    `SELECT
       qsp.article_id::text AS article_id,
       qsp.plu,
       qsp.designation_snapshot AS designation,
       qsp.designation_snapshot AS display_name,
       qsp.price_unit AS unit,
       COALESCE(qsp.sale_unit, qsp.price_unit) AS sale_unit,
       qsp.family_code,
       COALESCE(qsp.family_name, 'Autre') AS family_name,
       qsp.supplier_available_quantity AS stock_quantity,
       qsp.purchase_price_ht AS pma,
       NULL::date AS next_dlc,
       NULL::text AS caliber_info,
       NULL::text AS origin_label,
       a.latin_name,
       a.fao_zone,
       a.sous_zone,
       a.fishing_gear,
       a.production_method,
       qsp.sale_price_level_1_ht AS price_level_1_ht,
       qsp.sale_price_level_2_ht AS price_level_2_ht,
       qsp.sale_price_level_3_ht AS price_level_3_ht,
       CASE $3::int
         WHEN 1 THEN qsp.sale_price_level_1_ht
         WHEN 2 THEN qsp.sale_price_level_2_ht
         WHEN 3 THEN qsp.sale_price_level_3_ht
         ELSE NULL
       END AS suggested_price_ht,
       CASE
         WHEN $3::int IN (1, 2, 3) THEN 'quick_order_sheet'
         ELSE 'none'
       END AS suggested_price_source
     FROM quick_order_sheet_products qsp
     LEFT JOIN articles a ON a.id = qsp.article_id AND a.store_id = qsp.store_id
     WHERE qsp.store_id = $1 AND qsp.sheet_id = $2
       AND qsp.article_id IS NOT NULL
     ORDER BY qsp.display_order ASC, qsp.designation_snapshot ASC`,
    [storeId, sheet.rows[0].id, targetTariffLevel]
  );
  return result.rows;
}

function headerSelectSql() {
  return `
    SELECT
      cpl.id,
      cpl.store_id,
      cpl.client_id,
      cl.code AS client_code,
      cl.name AS client_name,
      cl.email AS client_email,
      cl.mobile AS client_mobile,
      cl.phone AS client_phone,
      cpl.course_type,
      cpl.title,
      cpl.price_list_date,
      cpl.valid_until,
      cpl.status,
      cpl.tariff_level,
      cpl.notes,
      cpl.created_by,
      cpl.updated_by,
      cpl.created_at,
      cpl.updated_at
    FROM customer_price_lists cpl
    LEFT JOIN clients cl ON cl.id = cpl.client_id AND cl.store_id = cpl.store_id
  `;
}

function lineSelectSql() {
  return `
    SELECT
      id,
      store_id,
      price_list_id,
      article_id,
      family_code,
      family_name,
      display_order,
      is_featured,
      designation_snapshot,
      caliber_info,
      origin_label,
      fao_zone,
      sous_zone,
      sale_unit,
      stock_quantity_snapshot,
      price_ht,
      price_level_1_ht,
      price_level_2_ht,
      price_level_3_ht,
      price_source,
      tariff_level,
      line_note,
      created_at,
      updated_at
    FROM customer_price_list_lines
  `;
}

async function getOptionalClient(db, storeId, clientId) {
  if (!clientId) return null;
  const result = await db.query(
    `
    SELECT
      c.id,
      c.code,
      c.name,
      c.legal_name,
      c.tariff_level,
      COALESCE(c.is_royale_maree_member, false) AS is_royale_maree_member,
      c.parent_client_id,
      c.billed_client_id,
      parent.code AS parent_client_code,
      parent.name AS parent_client_name,
      parent.tariff_level AS parent_tariff_level,
      COALESCE(parent.is_royale_maree_member, false) AS parent_is_royale_maree_member,
      billed.code AS billed_client_code,
      billed.name AS billed_client_name,
      billed.tariff_level AS billed_tariff_level,
      COALESCE(billed.is_royale_maree_member, false) AS billed_is_royale_maree_member
    FROM clients c
    LEFT JOIN clients parent ON parent.id = c.parent_client_id AND parent.store_id = c.store_id
    LEFT JOIN clients billed ON billed.id = COALESCE(c.billed_client_id, c.id) AND billed.store_id = c.store_id
    WHERE c.id = $1
      AND c.store_id = $2
      AND c.status <> 'inactive'
    LIMIT 1
    `,
    [clientId, storeId]
  );

  if (!result.rows.length) {
    const error = new Error('Client introuvable pour ce magasin');
    error.status = 404;
    throw error;
  }

  return result.rows[0];
}

async function getHeader(db, storeId, priceListId) {
  const result = await db.query(
    `
    ${headerSelectSql()}
    WHERE cpl.id = $1
      AND cpl.store_id = $2
    LIMIT 1
    `,
    [priceListId, storeId]
  );

  return result.rows[0] || null;
}

async function getLines(db, priceListId) {
  const result = await db.query(
    `
    ${lineSelectSql()}
    WHERE price_list_id = $1
    ORDER BY is_featured DESC, COALESCE(family_name, 'Autre') ASC, display_order ASC, designation_snapshot ASC
    `,
    [priceListId]
  );

  return result.rows;
}

async function replaceLines(db, storeId, priceListId, lines = [], targetTariffLevel = null) {
  await db.query('DELETE FROM customer_price_list_lines WHERE price_list_id = $1 AND store_id = $2', [priceListId, storeId]);

  if (!Array.isArray(lines) || lines.length === 0) return;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || {};
    const designation = clean(line.designation_snapshot || line.designation || line.article_label);
    if (!designation) continue;

    const articleId = normalizeUuid(line.article_id);
    const price = parseNumber(line.price_ht);
    const priceLevel1 = parseNumber(line.price_level_1_ht);
    const priceLevel2 = parseNumber(line.price_level_2_ht);
    const priceLevel3 = parseNumber(line.price_level_3_ht);
    const tariffLevel = parseTariffLevel(line.tariff_level) || targetTariffLevel;
    const defaultSource = tariffLevel ? 'target_tariff' : 'none';
    const priceSource = normalizePriceSource(line.price_source, defaultSource);

    await db.query(
      `
      INSERT INTO customer_price_list_lines (
        store_id, price_list_id, article_id, family_code, family_name,
        display_order, is_featured, designation_snapshot, caliber_info,
        origin_label, fao_zone, sous_zone, sale_unit, stock_quantity_snapshot,
        price_ht, price_level_1_ht, price_level_2_ht, price_level_3_ht,
        price_source, tariff_level, line_note
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9,
        $10, $11, $12, $13, $14,
        $15, $16, $17, $18,
        $19, $20, $21
      )
      `,
      [
        storeId,
        priceListId,
        articleId,
        clean(line.family_code),
        clean(line.family_name) || 'Autre',
        Number.isFinite(Number(line.display_order)) ? Number(line.display_order) : index + 1,
        Boolean(line.is_featured),
        designation,
        clean(line.caliber_info),
        clean(line.origin_label),
        clean(line.fao_zone),
        clean(line.sous_zone),
        clean(line.sale_unit),
        parseNumber(line.stock_quantity_snapshot),
        price,
        priceLevel1,
        priceLevel2,
        priceLevel3,
        priceSource,
        tariffLevel,
        clean(line.line_note),
      ]
    );
  }
}

router.get('/source-products', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const clientId = normalizeUuid(req.query.client_id);
    const client = await getOptionalClient(req.dbPool, req.user.store_id, clientId);
    const targetTariffLevel = normalizeTargetTariff(req.query.target_tariff_level || req.query.tariff_level);
    const effectiveTargetTariffLevel = resolveMercurialeTargetTariff({ targetTariffLevel, client });
    const requestedDate = clean(req.query.price_list_date || req.query.date);
    const quickSheetProducts = await fetchQuickOrderSheetProducts(req.dbPool, req.user.store_id, requestedDate, effectiveTargetTariffLevel);
    const commissionSettings = await fetchCommissionSettings(req.dbPool, req.user.store_id);

    if (requestedDate && quickSheetProducts === null) {
      return res.status(404).json({ error: `Aucune tarification fiche d'appel configurée pour le ${requestedDate}` });
    }

    if (quickSheetProducts) {
      const search = clean(req.query.search)?.toLowerCase();
      const family = clean(req.query.family);
      const filteredProducts = quickSheetProducts.filter((row) => {
        const matchesSearch = !search || [
          row.plu,
          row.designation,
          row.display_name,
          row.family_name,
        ].filter(Boolean).join(' ').toLowerCase().includes(search);
        const matchesFamily = !family || row.family_code === family || row.family_name === family;
        return matchesSearch && matchesFamily;
      }).map((row) => decorateCourseLine(row, {
        client,
        storeSettings: commissionSettings,
        targetTariffLevel: effectiveTargetTariffLevel,
      }));
      return res.json({
        client,
        target_tariff_level: effectiveTargetTariffLevel,
        source: 'quick_order_sheet',
        products: filteredProducts,
      });
    }

    const params = [req.user.store_id];
    const availableOnly = parseBool(req.query.available_only, true);
    let where = 'WHERE ss.store_id = $1';

    if (availableOnly) where += ' AND ss.stock_quantity > 0';

    if (clean(req.query.search)) {
      params.push(`%${clean(req.query.search)}%`);
      const idx = params.length;
      where += ` AND (
        a.plu ILIKE $${idx}
        OR a.designation ILIKE $${idx}
        OR COALESCE(a.display_name, '') ILIKE $${idx}
        OR COALESCE(a.ean, '') ILIKE $${idx}
        OR COALESCE(a.latin_name, '') ILIKE $${idx}
        OR COALESCE(a.family_name, '') ILIKE $${idx}
      )`;
    }

    if (clean(req.query.family)) {
      params.push(clean(req.query.family));
      where += ` AND a.family_code = $${params.length}`;
    }

    params.push(safeLimit(req.query.limit));

    const result = await req.dbPool.query(
      `
      SELECT
        a.id::text AS article_id,
        a.plu,
        a.designation,
        COALESCE(a.display_name, a.designation) AS display_name,
        a.unit,
        COALESCE(a.sale_unit, a.unit) AS sale_unit,
        a.family_code,
        COALESCE(a.family_name, 'Autre') AS family_name,
        a.sale_price_ex_vat,
        a.sale_price_level_1_ht,
        a.sale_price_level_2_ht,
        a.sale_price_level_3_ht,
        ss.stock_quantity,
        ss.pma,
        COALESCE(next_lot.dlc, ss.next_dlc) AS next_dlc,
        COALESCE(next_lot.traceability_data->>'caliber', next_lot.traceability_data->>'calibre', a.display_name) AS caliber_info,
        COALESCE(next_lot.traceability_data->>'origin_label', next_lot.traceability_data->>'origin', a.production_method) AS origin_label,
        COALESCE(next_lot.traceability_data->>'latin_name', a.latin_name) AS latin_name,
        COALESCE(next_lot.traceability_data->>'fao_zone', a.fao_zone) AS fao_zone,
        COALESCE(next_lot.traceability_data->>'sous_zone', a.sous_zone) AS sous_zone,
        COALESCE(next_lot.traceability_data->>'fishing_gear', a.fishing_gear) AS fishing_gear,
        COALESCE(next_lot.traceability_data->>'production_method', a.production_method) AS production_method
      FROM stock_summary ss
      JOIN articles a ON a.id = ss.article_id AND a.store_id = ss.store_id
      LEFT JOIN LATERAL (
        SELECT l.*
        FROM lots l
        WHERE l.store_id = ss.store_id
          AND l.article_id = ss.article_id
          AND l.qty_remaining > 0
        ORDER BY COALESCE(l.dlc, DATE '9999-12-31') ASC, l.created_at ASC, l.id ASC
        LIMIT 1
      ) next_lot ON true
      ${where}
        AND COALESCE(a.visible_in_price_list, true) = true
        AND COALESCE(a.sellable, true) = true
        AND COALESCE(a.article_type, 'PRODUCT') = 'PRODUCT'
      ORDER BY COALESCE(a.family_name, 'Autre') ASC, a.designation ASC
      LIMIT $${params.length}
      `,
      params
    );

    const rows = result.rows.map((row) => ({
      ...row,
      target_tariff_level: effectiveTargetTariffLevel,
      suggested_price_ht: effectiveTargetTariffLevel ? priceForLevel(row, effectiveTargetTariffLevel) : null,
      suggested_price_source: effectiveTargetTariffLevel ? 'target_tariff' : 'none',
      price_level_1_ht: priceForLevel(row, 1),
      price_level_2_ht: priceForLevel(row, 2),
      price_level_3_ht: priceForLevel(row, 3),
    })).map((row) => decorateCourseLine(row, {
      client,
      storeSettings: commissionSettings,
      targetTariffLevel: effectiveTargetTariffLevel,
    }));

    res.json({
      client,
      target_tariff_level: effectiveTargetTariffLevel,
      products: rows,
    });
  } catch (err) {
    console.error('Erreur GET /api/customer-price-lists/source-products :', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur serveur source mercuriale' });
  }
});

router.get('/', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const params = [req.user.store_id];
    const where = ['cpl.store_id = $1'];

    if (clean(req.query.status) && clean(req.query.status) !== 'all') {
      params.push(normalizeStatus(req.query.status));
      where.push(`cpl.status = $${params.length}`);
    }

    if (clean(req.query.course_type) && clean(req.query.course_type) !== 'all') {
      params.push(normalizeCourseType(req.query.course_type));
      where.push(`cpl.course_type = $${params.length}`);
    }

    if (clean(req.query.target_tariff_level) && clean(req.query.target_tariff_level) !== 'all') {
      params.push(normalizeTargetTariff(req.query.target_tariff_level));
      where.push(`cpl.tariff_level = $${params.length}`);
    }

    const result = await req.dbPool.query(
      `
      ${headerSelectSql()}
      WHERE ${where.join(' AND ')}
      ORDER BY cpl.price_list_date DESC, cpl.created_at DESC
      LIMIT 100
      `,
      params
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Erreur GET /api/customer-price-lists :', err);
    res.status(500).json({ error: 'Erreur serveur mercuriales' });
  }
});

router.post('/', authenticateToken, attachDbContext, requireCourseEditor, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const clientId = normalizeUuid(req.body.client_id);
    await getOptionalClient(client, req.user.store_id, clientId);
    const targetTariffLevel = normalizeTargetTariff(req.body.target_tariff_level || req.body.tariff_level);

    await client.query('BEGIN');

    const created = await client.query(
      `
      INSERT INTO customer_price_lists (
        store_id, client_id, course_type, title, price_list_date,
        valid_until, status, tariff_level, notes, created_by, updated_by
      ) VALUES (
        $1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE),
        $6, $7, $8, $9, $10, $10
      )
      RETURNING id
      `,
      [
        req.user.store_id,
        clientId,
        normalizeCourseType(req.body.course_type),
        clean(req.body.title),
        clean(req.body.price_list_date),
        clean(req.body.valid_until),
        normalizeStatus(req.body.status),
        targetTariffLevel,
        clean(req.body.notes),
        req.user.id,
      ]
    );

    const priceListId = created.rows[0].id;
    await replaceLines(client, req.user.store_id, priceListId, req.body.lines, targetTariffLevel);

    await client.query('COMMIT');

    const header = await getHeader(req.dbPool, req.user.store_id, priceListId);
    const lines = await getLines(req.dbPool, priceListId);
    res.status(201).json({ ...header, target_tariff_level: header.tariff_level, lines });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur POST /api/customer-price-lists :', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur serveur creation mercuriale' });
  } finally {
    client.release();
  }
});

router.get('/:id', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const priceListId = normalizeUuid(req.params.id);
    if (!priceListId) return res.status(400).json({ error: 'ID mercuriale invalide' });

    const header = await getHeader(req.dbPool, req.user.store_id, priceListId);
    if (!header) return res.status(404).json({ error: 'Mercuriale introuvable' });

    const lines = await getLines(req.dbPool, priceListId);
    res.json({ ...header, target_tariff_level: header.tariff_level, lines });
  } catch (err) {
    console.error('Erreur GET /api/customer-price-lists/:id :', err);
    res.status(500).json({ error: 'Erreur serveur mercuriale' });
  }
});

router.get('/:id/presentation', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const priceListId = normalizeUuid(req.params.id);
    if (!priceListId) return res.status(400).json({ error: 'ID mercuriale invalide' });

    const header = await getHeader(req.dbPool, req.user.store_id, priceListId);
    if (!header) return res.status(404).json({ error: 'Mercuriale introuvable' });

    const [lines, storeSettings] = await Promise.all([
      getLines(req.dbPool, priceListId),
      fetchStoreSettingsForPresentation(req.dbPool, req.user.store_id),
    ]);
    const client = await getOptionalClient(req.dbPool, req.user.store_id, header.client_id);
    const effectiveTargetTariffLevel = resolveMercurialeTargetTariff({
      targetTariffLevel: header.tariff_level,
      client,
    });
    const decoratedLines = lines.map((line) => decorateCourseLine(line, {
      client,
      storeSettings,
      targetTariffLevel: effectiveTargetTariffLevel,
    }));

    const featured = decoratedLines.filter((line) => line.is_featured);
    const families = decoratedLines.filter((line) => !line.is_featured).reduce((acc, line) => {
      const key = line.family_name || 'Autre';
      if (!acc[key]) acc[key] = [];
      acc[key].push(line);
      return acc;
    }, {});

    res.json({
      price_list: { ...header, tariff_level: effectiveTargetTariffLevel, target_tariff_level: effectiveTargetTariffLevel },
      store_settings: storeSettings,
      featured_lines: featured,
      families,
      lines: decoratedLines,
      future_channels: {
        pdf: false,
        email: false,
        whatsapp: false,
      },
    });
  } catch (err) {
    console.error('Erreur GET /api/customer-price-lists/:id/presentation :', err);
    res.status(500).json({ error: 'Erreur serveur presentation mercuriale' });
  }
});

router.put('/:id', authenticateToken, attachDbContext, requireCourseEditor, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const priceListId = normalizeUuid(req.params.id);
    if (!priceListId) return res.status(400).json({ error: 'ID mercuriale invalide' });

    const clientId = normalizeUuid(req.body.client_id);
    await getOptionalClient(client, req.user.store_id, clientId);
    const targetTariffLevel = normalizeTargetTariff(req.body.target_tariff_level || req.body.tariff_level);

    await client.query('BEGIN');

    const updated = await client.query(
      `
      UPDATE customer_price_lists
      SET
        client_id = $1,
        course_type = $2,
        title = $3,
        price_list_date = COALESCE($4::date, price_list_date),
        valid_until = $5,
        status = $6,
        tariff_level = $7,
        notes = $8,
        updated_by = $9,
        updated_at = NOW()
      WHERE id = $10
        AND store_id = $11
      RETURNING id
      `,
      [
        clientId,
        normalizeCourseType(req.body.course_type),
        clean(req.body.title),
        clean(req.body.price_list_date),
        clean(req.body.valid_until),
        normalizeStatus(req.body.status),
        targetTariffLevel,
        clean(req.body.notes),
        req.user.id,
        priceListId,
        req.user.store_id,
      ]
    );

    if (!updated.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Mercuriale introuvable' });
    }

    await replaceLines(client, req.user.store_id, priceListId, req.body.lines, targetTariffLevel);
    await client.query('COMMIT');

    const header = await getHeader(req.dbPool, req.user.store_id, priceListId);
    const lines = await getLines(req.dbPool, priceListId);
    res.json({ ...header, target_tariff_level: header.tariff_level, lines });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur PUT /api/customer-price-lists/:id :', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur serveur mise a jour mercuriale' });
  } finally {
    client.release();
  }
});

router.patch('/:id/status', authenticateToken, attachDbContext, requireCourseEditor, async (req, res) => {
  try {
    const priceListId = normalizeUuid(req.params.id);
    if (!priceListId) return res.status(400).json({ error: 'ID mercuriale invalide' });

    const status = normalizeStatus(req.body.status);
    const result = await req.dbPool.query(
      `
      UPDATE customer_price_lists
      SET status = $1,
          updated_by = $2,
          updated_at = NOW()
      WHERE id = $3
        AND store_id = $4
      RETURNING id, status
      `,
      [status, req.user.id, priceListId, req.user.store_id]
    );

    if (!result.rows.length) return res.status(404).json({ error: 'Mercuriale introuvable' });
    res.json({ ok: true, ...result.rows[0] });
  } catch (err) {
    console.error('Erreur PATCH /api/customer-price-lists/:id/status :', err);
    res.status(500).json({ error: 'Erreur serveur statut mercuriale' });
  }
});

module.exports = router;
