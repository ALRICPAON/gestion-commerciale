const ALLOWED_ACTIONS = new Set(['customer_order_draft']);
const OPTIONAL_DB_ERROR_CODES = new Set(['42P01', '42703']);

function clean(value) {
  const text = String(value || '').trim();
  return text || null;
}

function number(value, fallback = 0) {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function parseCustomerOrderPrompt(prompt) {
  const text = clean(prompt) || '';
  const normalized = normalizeText(text);
  const clientMatch = normalized.match(/\bpour\s+(.+?)\s+(?:avec|:)/);
  const itemsPart = normalized.split(/\bavec\b|:/).slice(1).join(' ');

  if (!clientMatch || !itemsPart) {
    const error = new Error('Je n ai pas assez d elements pour preparer la commande brouillon.');
    error.status = 400;
    error.expose = true;
    throw error;
  }

  const lines = itemsPart
    .split(/\s+et\s+|,|;/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/(\d+(?:[,.]\d+)?)\s*(kg|kilo|kilos|piece|pieces|unite|unites)?\s+(?:de\s+|d')?(.+)/);
      if (!match) return null;
      return {
        quantity: number(match[1]),
        unit: ['piece', 'pieces', 'unite', 'unites'].includes(match[2]) ? 'unite' : 'kg',
        article_search: clean(match[3]),
      };
    })
    .filter((line) => line && line.quantity > 0 && line.article_search);

  if (lines.length === 0) {
    const error = new Error('Je n ai pas trouve de lignes produit exploitables pour cette commande.');
    error.status = 400;
    error.expose = true;
    throw error;
  }

  return {
    client_search: clean(clientMatch[1]),
    lines,
  };
}

async function findClient(db, storeId, search) {
  const result = await db.query(`
    SELECT id, code, name, tariff_level, vat_rate, is_vat_exempt
    FROM clients
    WHERE store_id = $1
      AND COALESCE(status, 'active') <> 'inactive'
      AND (
        LOWER(name) LIKE LOWER($2)
        OR LOWER(COALESCE(code, '')) LIKE LOWER($2)
      )
    ORDER BY name ASC
    LIMIT 1
  `, [storeId, `%${search}%`]);

  return result.rows[0] || null;
}

async function findArticle(db, storeId, search) {
  const tokens = normalizeText(search).split(/\s+/).filter((token) => token.length > 2).slice(0, 5);
  const params = [storeId];
  const scoreParts = [];

  tokens.forEach((token) => {
    params.push(`%${token}%`);
    scoreParts.push(`CASE WHEN LOWER(a.designation) LIKE $${params.length} THEN 1 ELSE 0 END`);
  });

  if (scoreParts.length === 0) return null;

  const result = await db.query(`
    SELECT
      a.id,
      a.plu,
      a.designation,
      a.unit,
      a.sale_unit,
      a.vat_rate,
      a.sale_price_ex_vat,
      a.sale_price_level_1_ht,
      a.sale_price_level_2_ht,
      a.sale_price_level_3_ht,
      COALESCE(ss.pma, 0) AS pma,
      (${scoreParts.join(' + ')}) AS match_score
    FROM articles a
    LEFT JOIN stock_summary ss ON ss.article_id = a.id AND ss.store_id = a.store_id
    WHERE a.store_id = $1
      AND COALESCE(a.is_active, true) = true
      AND (${scoreParts.join(' + ')}) > 0
    ORDER BY match_score DESC, a.designation ASC
    LIMIT 1
  `, params);

  return result.rows[0] || null;
}

function tariffLevel(client) {
  const level = Number(client?.tariff_level || 1);
  return [1, 2, 3].includes(level) ? level : 1;
}

function articlePrice(article, client) {
  const level = tariffLevel(client);
  return number(article?.[`sale_price_level_${level}_ht`], number(article?.sale_price_ex_vat, 0));
}

function buildLinePayload(line, article, client) {
  const quantity = number(line.quantity);
  const unitPriceHt = articlePrice(article, client);
  const vatRate = client?.is_vat_exempt ? 0 : number(article?.vat_rate, number(client?.vat_rate, 5.5));
  const lineAmountHt = Number((quantity * unitPriceHt).toFixed(2));
  const lineVatAmount = Number((lineAmountHt * vatRate / 100).toFixed(2));
  const lineAmountTtc = Number((lineAmountHt + lineVatAmount).toFixed(2));
  const unitCost = number(article?.pma, 0);

  return {
    article_id: article.id,
    article_plu: article.plu,
    article_label: article.designation,
    quantity,
    sale_unit: line.unit || article.sale_unit || article.unit || 'kg',
    unit_sale_price_ht: unitPriceHt,
    unit_sale_price_ttc: quantity > 0 ? Number((lineAmountTtc / quantity).toFixed(4)) : 0,
    vat_rate: vatRate,
    line_amount_ht: lineAmountHt,
    line_vat_amount: lineVatAmount,
    line_amount_ttc: lineAmountTtc,
    unit_cost_ex_vat: unitCost,
    line_margin_ex_vat: Number((lineAmountHt - quantity * unitCost).toFixed(2)),
  };
}

function buildSummary(client, lines) {
  return [
    `Je vais preparer une commande brouillon pour ${client.name} :`,
    ...lines.map((line) => `- ${line.article_label} : ${line.quantity} ${line.sale_unit}`),
    '',
    'Confirmer l action ?',
  ].join('\n');
}

async function prepareCustomerOrderAction({ db, user, prompt, payload }) {
  const storeId = user.store_id;
  const parsed = payload?.client_search && Array.isArray(payload?.lines)
    ? payload
    : parseCustomerOrderPrompt(prompt);

  const client = await findClient(db, storeId, parsed.client_search);
  if (!client) {
    const error = new Error('Client introuvable pour ce magasin.');
    error.status = 400;
    error.expose = true;
    throw error;
  }

  const lines = [];
  for (const rawLine of parsed.lines) {
    const article = await findArticle(db, storeId, rawLine.article_search);
    if (!article) {
      const error = new Error(`Article introuvable pour "${rawLine.article_search}".`);
      error.status = 400;
      error.expose = true;
      throw error;
    }
    lines.push(buildLinePayload(rawLine, article, client));
  }

  const actionPayload = {
    client,
    lines,
    source_prompt: clean(prompt),
  };
  const summary = buildSummary(client, lines);

  const result = await db.query(`
    INSERT INTO ai_pending_actions (
      id, store_id, user_id, action_type, status, payload, created_at
    )
    VALUES (gen_random_uuid(), $1, $2, 'customer_order_draft', 'pending', $3::jsonb, NOW())
    RETURNING id, action_type, status, payload, created_at
  `, [storeId, user.id, JSON.stringify(actionPayload)]);

  return {
    id: result.rows[0].id,
    action_type: 'customer_order_draft',
    status: 'pending',
    summary,
    payload: actionPayload,
  };
}

async function executeCustomerOrderDraft(db, action, user) {
  const payload = action.payload || {};
  const client = payload.client;
  const lines = Array.isArray(payload.lines) ? payload.lines : [];

  if (!client?.id || lines.length === 0) {
    throw new Error('Action IA incomplete : client ou lignes manquants.');
  }

  const clientCheck = await db.query(`
    SELECT id, name, tariff_level, vat_rate, is_vat_exempt
    FROM clients
    WHERE id = $1 AND store_id = $2 AND COALESCE(status, 'active') <> 'inactive'
    LIMIT 1
  `, [client.id, user.store_id]);
  if (!clientCheck.rows.length) {
    throw new Error('Client introuvable pour ce magasin.');
  }

  const sale = await db.query(`
    INSERT INTO sales_documents (
      id, store_id, client_key, client_id, document_date, status, document_type,
      origin, reference_number, notes, tariff_level_snapshot, vat_rate_snapshot,
      is_vat_exempt_snapshot, created_by, updated_by
    )
    VALUES (
      gen_random_uuid(), $1, $2, $3, CURRENT_DATE, 'draft', 'ORDER',
      'ai_confirmed_action', NULL, $4, $5, $6, $7, $8, $8
    )
    RETURNING *
  `, [
    user.store_id,
    user.client_key || null,
    client.id,
    `Commande brouillon preparee par ALTA - action IA ${action.id}`,
    tariffLevel(clientCheck.rows[0]),
    number(clientCheck.rows[0].vat_rate, 5.5),
    Boolean(clientCheck.rows[0].is_vat_exempt),
    user.id,
  ]);

  const saleId = sale.rows[0].id;
  const createdLines = [];
  let lineNumber = 1;

  for (const line of lines) {
    const articleCheck = await db.query(`
      SELECT id, plu, designation
      FROM articles
      WHERE id = $1 AND store_id = $2 AND COALESCE(is_active, true) = true
      LIMIT 1
    `, [line.article_id, user.store_id]);
    if (!articleCheck.rows.length) {
      throw new Error(`Article introuvable pour la ligne ${lineNumber}.`);
    }

    const inserted = await db.query(`
      INSERT INTO sales_lines (
        id, store_id, client_key, sales_document_id, line_number, article_id,
        article_plu, article_label, total_weight, sold_quantity, sale_unit,
        line_status, unit_sale_price_ht, unit_sale_price_ttc, vat_rate,
        line_amount_ht, line_vat_amount, line_amount_ttc, unit_cost_ex_vat,
        line_margin_ex_vat, created_by, updated_by
      )
      VALUES (
        gen_random_uuid(), $1, $2, $3, $4, $5,
        $6, $7, $8, $8, $9,
        'pending', $10, $11, $12,
        $13, $14, $15, $16,
        $17, $18, $18
      )
      RETURNING id, article_label, sold_quantity, sale_unit, line_amount_ht
    `, [
      user.store_id,
      user.client_key || null,
      saleId,
      lineNumber,
      line.article_id,
      line.article_plu || null,
      line.article_label,
      number(line.quantity),
      line.sale_unit || 'kg',
      number(line.unit_sale_price_ht),
      number(line.unit_sale_price_ttc),
      number(line.vat_rate, 5.5),
      number(line.line_amount_ht),
      number(line.line_vat_amount),
      number(line.line_amount_ttc),
      number(line.unit_cost_ex_vat),
      number(line.line_margin_ex_vat),
      user.id,
    ]);
    createdLines.push(inserted.rows[0]);
    lineNumber += 1;
  }

  await db.query(`
    UPDATE sales_documents sd
    SET total_amount_ex_vat = COALESCE(x.ht, 0),
        total_vat_amount = COALESCE(x.vat, 0),
        total_amount_inc_vat = COALESCE(x.ttc, 0),
        updated_at = NOW(),
        updated_by = $2
    FROM (
      SELECT
        COALESCE(SUM(line_amount_ht), 0) AS ht,
        COALESCE(SUM(line_vat_amount), 0) AS vat,
        COALESCE(SUM(line_amount_ttc), 0) AS ttc
      FROM sales_lines
      WHERE sales_document_id = $1
    ) x
    WHERE sd.id = $1 AND sd.store_id = $3
  `, [saleId, user.id, user.store_id]);

  return {
    sale_id: saleId,
    document_type: 'ORDER',
    status: 'draft',
    client: {
      id: client.id,
      name: client.name,
    },
    lines: createdLines,
  };
}

async function confirmAction({ dbPool, user, actionId }) {
  const db = await dbPool.connect();
  try {
    await db.query('BEGIN');
    const actionResult = await db.query(`
      SELECT *
      FROM ai_pending_actions
      WHERE id = $1 AND store_id = $2 AND user_id = $3
      FOR UPDATE
    `, [actionId, user.store_id, user.id]);

    if (!actionResult.rows.length) {
      const error = new Error('Action IA introuvable.');
      error.status = 404;
      error.expose = true;
      throw error;
    }

    const action = actionResult.rows[0];
    if (action.status !== 'pending') {
      const error = new Error(`Action IA deja traitee avec le statut ${action.status}.`);
      error.status = 400;
      error.expose = true;
      throw error;
    }

    if (!ALLOWED_ACTIONS.has(action.action_type)) {
      throw new Error(`Action IA non autorisee : ${action.action_type}`);
    }

    await db.query(`
      UPDATE ai_pending_actions
      SET status = 'confirmed', confirmed_at = NOW()
      WHERE id = $1 AND store_id = $2
    `, [actionId, user.store_id]);

    const result = action.action_type === 'customer_order_draft'
      ? await executeCustomerOrderDraft(db, action, user)
      : null;

    await db.query(`
      UPDATE ai_pending_actions
      SET status = 'executed', result = $3::jsonb, executed_at = NOW()
      WHERE id = $1 AND store_id = $2
      RETURNING id, action_type, status, result, executed_at
    `, [actionId, user.store_id, JSON.stringify(result)]);

    await db.query('COMMIT');
    return {
      ok: true,
      action_id: actionId,
      status: 'executed',
      result,
    };
  } catch (error) {
    await db.query('ROLLBACK');
    if (error.status) throw error;

    try {
      await dbPool.query(`
        UPDATE ai_pending_actions
        SET status = 'failed', result = $3::jsonb
        WHERE id = $1 AND store_id = $2 AND status IN ('pending', 'confirmed')
      `, [actionId, user.store_id, JSON.stringify({ error: error.message })]);
    } catch (logError) {
      console.error('Erreur log echec action IA :', logError.message);
    }

    throw error;
  } finally {
    db.release();
  }
}

async function cancelAction({ db, user, actionId }) {
  const result = await db.query(`
    UPDATE ai_pending_actions
    SET status = 'cancelled', cancelled_at = NOW()
    WHERE id = $1
      AND store_id = $2
      AND user_id = $3
      AND status = 'pending'
    RETURNING id, action_type, status, cancelled_at
  `, [actionId, user.store_id, user.id]);

  if (!result.rows.length) {
    const error = new Error('Action IA introuvable ou deja traitee.');
    error.status = 404;
    error.expose = true;
    throw error;
  }

  return {
    ok: true,
    action: result.rows[0],
  };
}

function isMissingActionTable(error) {
  return OPTIONAL_DB_ERROR_CODES.has(error.code);
}

module.exports = {
  prepareCustomerOrderAction,
  confirmAction,
  cancelAction,
  isMissingActionTable,
};
