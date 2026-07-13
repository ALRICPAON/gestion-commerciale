function normalizeIdentity(row = {}) {
  return {
    company_name: row.company_name || 'ALTA MAREE',
    trade_name: row.trade_name || row.company_name || 'ALTA MAREE',
    legal_form: row.legal_form || null,
    share_capital: row.share_capital || null,
    address_line1: row.address_line1 || null,
    address_line2: row.address_line2 || null,
    postal_code: row.postal_code || null,
    city: row.city || null,
    country: row.country || 'France',
    phone: row.phone || null,
    email: row.email || null,
    siret: row.siret || null,
    rcs: row.rcs || null,
    vat_number: row.vat_number || null,
    sanitary_approval_number: row.sanitary_approval_number || null,
    manager_name: row.manager_name || null,
    logo_url: row.logo_url || null,
    primary_color: row.primary_color || '#0f5f73',
    secondary_color: row.secondary_color || '#263746',
  };
}

async function getCompanyIdentity(db, storeId) {
  const result = await db.query(
    `SELECT *
     FROM store_settings
     WHERE store_id = $1
     LIMIT 1`,
    [storeId]
  );

  return normalizeIdentity(result.rows[0] || {});
}

module.exports = {
  getCompanyIdentity,
};
