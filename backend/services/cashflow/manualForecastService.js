function normalizeDirection(value) {
  const text = String(value || '').toLowerCase();
  return ['out', 'sortie', 'debit', 'decaissement'].includes(text) ? 'out' : 'in';
}

function normalizeRecurrence(value) {
  const text = String(value || 'unique').toLowerCase();
  if (['weekly', 'hebdomadaire'].includes(text)) return 'weekly';
  if (['monthly', 'mensuelle'].includes(text)) return 'monthly';
  if (['quarterly', 'trimestrielle'].includes(text)) return 'quarterly';
  if (['yearly', 'annuelle', 'annual'].includes(text)) return 'yearly';
  return 'unique';
}

function cleanPayload(body = {}) {
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    const error = new Error('Montant invalide');
    error.status = 400;
    throw error;
  }
  if (!body.forecast_date && !body.date) {
    const error = new Error('Date prevue obligatoire');
    error.status = 400;
    throw error;
  }
  return {
    label: String(body.label || '').trim() || 'Mouvement manuel',
    direction: normalizeDirection(body.direction || body.type),
    amount,
    forecast_date: String(body.forecast_date || body.date).slice(0, 10),
    recurrence: normalizeRecurrence(body.recurrence),
    category: String(body.category || '').trim() || null,
    comment: String(body.comment || '').trim() || null,
    active: body.active !== false,
  };
}

async function listManualItems(db, storeId) {
  const result = await db.query(
    `
    SELECT *
    FROM cashflow_manual_items
    WHERE store_id = $1
    ORDER BY forecast_date ASC, created_at DESC
    LIMIT 500
    `,
    [storeId]
  );
  return result.rows;
}

async function createManualItem(db, { storeId, userId, body }) {
  const payload = cleanPayload(body);
  const result = await db.query(
    `
    INSERT INTO cashflow_manual_items(
      store_id, label, direction, amount, forecast_date, recurrence, category, comment, active, created_by
    )
    VALUES($1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10)
    RETURNING *
    `,
    [storeId, payload.label, payload.direction, payload.amount, payload.forecast_date, payload.recurrence, payload.category, payload.comment, payload.active, userId || null]
  );
  return result.rows[0];
}

async function updateManualItem(db, { storeId, id, body }) {
  const payload = cleanPayload(body);
  const result = await db.query(
    `
    UPDATE cashflow_manual_items
    SET label = $3,
      direction = $4,
      amount = $5,
      forecast_date = $6::date,
      recurrence = $7,
      category = $8,
      comment = $9,
      active = $10,
      updated_at = now()
    WHERE id = $1
      AND store_id = $2
    RETURNING *
    `,
    [id, storeId, payload.label, payload.direction, payload.amount, payload.forecast_date, payload.recurrence, payload.category, payload.comment, payload.active]
  );
  return result.rows[0] || null;
}

async function deleteManualItem(db, { storeId, id }) {
  const result = await db.query(
    'DELETE FROM cashflow_manual_items WHERE id = $1 AND store_id = $2 RETURNING id',
    [id, storeId]
  );
  return Boolean(result.rows[0]);
}

module.exports = {
  cleanPayload,
  createManualItem,
  deleteManualItem,
  listManualItems,
  updateManualItem,
};
