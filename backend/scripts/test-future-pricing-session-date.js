const assert = require('assert');
const pricing = require('../services/pricingService');
const salesPriceResolver = require('../services/salesPriceResolver');

const storeId = 'store-1';
const userContext = { user_id: 'user-1' };

function dateKey(value) {
  if (value instanceof Date) {
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${value.getFullYear()}-${month}-${day}`;
  }
  return String(value || '').slice(0, 10);
}

function fakeDb() {
  const events = [];
  let sessionIndex = 10;
  let lineIndex = 10;
  const tariffLevels = [{ id: 'tariff-1', store_id: storeId, legacy_level: 1, code: 'T1', name: 'Tarif 1', display_order: 1 }];
  const clients = [{ id: 'client-1', store_id: storeId, tariff_level: 1, resolved_legacy_level: 1, is_royale_maree_member: false }];
  const sessions = [
    { id: 'session-0709', store_id: storeId, pricing_date: '2026-09-07', title: 'Tarification du 2026-09-07', status: 'published', version_number: 1, is_active_publication: true },
  ];
  const lines = [
    {
      id: 'line-0709',
      store_id: storeId,
      pricing_session_id: 'session-0709',
      article_id: 'article-homard',
      supplier_id: 'supplier-1',
      plu_snapshot: 'HOM',
      designation_snapshot: 'Homard europeen 600/800',
      family_code: 'CRU',
      family_name: 'Crustaces',
      sale_unit: 'kg',
      price_unit: 'kg',
      purchase_price_ht: 14,
      supplier_designation_original: 'HOMARD',
      transport_cost_ht: 0.5,
      transport_cost_source: 'manual',
      transport_cost_forced: false,
      display_order: 1,
      exclude_from_mercuriale: false,
      notes: null,
    },
  ];
  const tariffs = [{ pricing_line_id: 'line-0709', tariff_level_id: 'tariff-1', price_ht: 21.9, source: 'manual' }];
  const callSheetProducts = [];

  function lineWithTariffs(line) {
    return {
      ...line,
      tariffs: tariffs.filter((tariff) => tariff.pricing_line_id === line.id).map((tariff) => ({ ...tariff, legacy_level: 1 })),
    };
  }

  const client = {
    async query(sql, params = []) {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        events.push(sql);
        return { rows: [] };
      }
      if (sql.includes('SELECT COALESCE(MAX(version_number)')) {
        const date = dateKey(params[1]);
        return { rows: [{ version: Math.max(0, ...sessions.filter((session) => dateKey(session.pricing_date) === date).map((session) => session.version_number || 1)) + 1 }] };
      }
      if (sql.includes('FROM pricing_sessions') && sql.includes('pricing_date < $2::date')) {
        const target = dateKey(params[1]);
        const previous = sessions
          .filter((session) => session.store_id === params[0] && dateKey(session.pricing_date) < target)
          .sort((a, b) => dateKey(b.pricing_date).localeCompare(dateKey(a.pricing_date)) || Number(b.is_active_publication) - Number(a.is_active_publication))[0];
        return { rows: previous ? [previous] : [] };
      }
      if (sql.includes('INSERT INTO pricing_sessions')) {
        sessionIndex += 1;
        const created = {
          id: `session-${sessionIndex}`,
          store_id: params[0],
          pricing_date: dateKey(params[1]),
          title: params[2],
          notes: params[3],
          version_number: params[4],
          source_session_id: params[5] || null,
          status: 'draft',
          is_active_publication: false,
        };
        sessions.push(created);
        return { rows: [created] };
      }
      if (sql.includes('SELECT * FROM pricing_sessions WHERE id = $1 AND store_id = $2')) {
        const found = sessions.find((session) => session.id === params[0] && session.store_id === params[1]);
        return { rows: found ? [found] : [] };
      }
      if (sql.includes('SELECT * FROM pricing_sessions WHERE store_id = $1 AND id = $2')) {
        const found = sessions.find((session) => session.store_id === params[0] && session.id === params[1]);
        return { rows: found ? [found] : [] };
      }
      if (sql.includes('FROM pricing_sessions') && sql.includes('pricing_date = $2::date') && !sql.includes('pricing_date < $2::date') && !sql.includes('pricing_sessions ps')) {
        const date = dateKey(params[1]);
        const found = sessions
          .filter((session) => session.store_id === params[0] && dateKey(session.pricing_date) === date)
          .sort((a, b) => (b.version_number || 1) - (a.version_number || 1))[0];
        return { rows: found ? [found] : [] };
      }
      if (sql.includes('FROM pricing_lines') && sql.includes('ORDER BY display_order ASC, created_at ASC, id ASC')) {
        return { rows: lines.filter((line) => line.store_id === params[0] && line.pricing_session_id === params[1]) };
      }
      if (sql.includes('SELECT * FROM pricing_lines WHERE id = $1 AND store_id = $2 FOR UPDATE')) {
        const found = lines.find((line) => line.id === params[0] && line.store_id === params[1]);
        return { rows: found ? [found] : [] };
      }
      if (sql.includes('INSERT INTO pricing_lines') && sql.includes('RETURNING id')) {
        lineIndex += 1;
        const copied = {
          id: `line-${lineIndex}`,
          store_id: params[0],
          pricing_session_id: params[1],
          article_id: params[2],
          supplier_id: params[3],
          plu_snapshot: params[4],
          designation_snapshot: params[5],
          family_code: params[6],
          family_name: params[7],
          sale_unit: params[8],
          price_unit: params[9],
          purchase_price_ht: params[10],
          supplier_designation_original: params[11],
          transport_cost_ht: params[12],
          transport_cost_source: params[13],
          transport_cost_forced: params[14],
          display_order: params[15],
          exclude_from_mercuriale: params[16],
          notes: params[17],
        };
        lines.push(copied);
        return { rows: [{ id: copied.id }] };
      }
      if (sql.includes('UPDATE pricing_lines')) {
        const line = lines.find((item) => item.store_id === params[0] && item.id === params[1]);
        Object.assign(line, {
          article_id: params[2],
          supplier_id: params[3],
          plu_snapshot: params[4],
          designation_snapshot: params[5],
          family_code: params[6],
          family_name: params[7],
          sale_unit: params[8],
          price_unit: params[9],
          purchase_price_ht: params[10],
          purchase_price_source: params[11],
          supplier_designation_original: params[12],
          transport_cost_ht: params[13],
          transport_cost_source: params[14],
          transport_cost_forced: params[15],
          exclude_from_mercuriale: params[16],
          notes: params[17],
        });
        return { rows: [] };
      }
      if (sql.includes('FROM pricing_line_tariffs') && sql.includes('WHERE store_id = $1 AND pricing_line_id = $2')) {
        return { rows: tariffs.filter((tariff) => tariff.pricing_line_id === params[1]) };
      }
      if (sql.includes('INSERT INTO pricing_line_tariffs')) {
        const existing = tariffs.find((tariff) => tariff.pricing_line_id === params[1] && tariff.tariff_level_id === params[2]);
        if (existing) {
          existing.price_ht = params[3];
          existing.source = params[4] || existing.source;
        } else {
          tariffs.push({ pricing_line_id: params[1], tariff_level_id: params[2], price_ht: params[3], source: params[4] || 'manual' });
        }
        return { rows: [] };
      }
      if (sql.includes('FROM tariff_levels')) {
        if (sql.includes('legacy_level')) return { rows: tariffLevels.filter((level) => level.store_id === params[0] && level.legacy_level === params[1]) };
        return { rows: tariffLevels };
      }
      if (sql.includes('FROM pricing_lines pl')) {
        if (sql.includes('pl.pricing_session_id')) {
          return { rows: lines.filter((line) => line.pricing_session_id === params[1]).map(lineWithTariffs) };
        }
        if (sql.includes('pl.pricing_session_id = $2')) {
          return { rows: lines.filter((line) => line.pricing_session_id === params[1]).map(lineWithTariffs) };
        }
        if (sql.includes('pl.id = $2')) {
          const found = lines.find((line) => line.id === params[1]);
          return { rows: found ? [lineWithTariffs(found)] : [] };
        }
        return { rows: [] };
      }
      if (sql.includes("UPDATE pricing_sessions") && sql.includes("SET status = 'superseded'")) {
        sessions.forEach((session) => {
          if (session.store_id === params[0] && dateKey(session.pricing_date) === dateKey(params[1]) && session.status === 'published' && session.is_active_publication && session.id !== params[2]) {
            session.status = 'superseded';
            session.is_active_publication = false;
          }
        });
        return { rows: [] };
      }
      if (sql.includes("UPDATE pricing_sessions") && sql.includes("SET status = 'published'")) {
        const session = sessions.find((item) => item.store_id === params[0] && item.id === params[1]);
        session.status = 'published';
        session.is_active_publication = true;
        session.published_by = params[2];
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO quick_order_sheets')) {
        assert.equal(dateKey(params[1]), '2026-09-08', 'publication future mirrors the selected business date');
        return { rows: [{ id: 'sheet-0809' }] };
      }
      if (sql.includes('DELETE FROM quick_order_sheet_products')) return { rows: [] };
      if (sql.includes('INSERT INTO quick_order_sheet_products')) {
        callSheetProducts.push({ sheet_id: params[1], pricing_session_id: params[16], pricing_line_id: params[17], sale_price_level_1_ht: params[10] });
        return { rows: [] };
      }
      if (sql.includes('FROM clients c')) {
        return { rows: clients.filter((clientRow) => clientRow.id === params[1]) };
      }
      if (sql.includes('FROM pricing_sessions ps')) {
        const active = sessions.find((session) => session.store_id === params[0] && dateKey(session.pricing_date) === dateKey(params[1]) && session.status === 'published' && session.is_active_publication);
        if (!active) return { rows: [] };
        const line = lines.find((item) => item.pricing_session_id === active.id && item.article_id === params[2]);
        if (!line) return { rows: [] };
        const tariff = tariffs.find((item) => item.pricing_line_id === line.id && item.tariff_level_id === params[3]);
        return { rows: tariff ? [{
          pricing_session_id: active.id,
          pricing_line_id: line.id,
          article_id: line.article_id,
          tariff_level_id: tariff.tariff_level_id,
          source_tariff_price_ht: tariff.price_ht,
          royale_maree_commission_eur_per_kg: 0,
        }] : [] };
      }
      return { rows: [] };
    },
    release() {},
  };

  return {
    db: {
      query: (...args) => client.query(...args),
      async connect() {
        return client;
      },
    },
    sessions,
    lines,
    tariffs,
    callSheetProducts,
  };
}

(async () => {
  const state = fakeDb();
  const duplicated = await pricing.duplicatePricingSession(state.db, storeId, { pricing_date: '2026-09-08' }, userContext);
  assert.equal(duplicated.session.pricing_date, '2026-09-08');
  assert.notEqual(duplicated.session.id, 'session-0709');
  assert.equal(duplicated.duplicated_line_count, 1);

  const futureLine = state.lines.find((line) => line.pricing_session_id === duplicated.session.id);
  await pricing.updatePricingLine(state.db, storeId, {
    pricing_line_id: futureLine.id,
    tariffs: [{ legacy_level: 1, price_ht: 22.9 }],
  }, userContext);
  const oldTariff = state.tariffs.find((tariff) => tariff.pricing_line_id === 'line-0709');
  const futureTariff = state.tariffs.find((tariff) => tariff.pricing_line_id === futureLine.id);
  assert.equal(Number(oldTariff.price_ht), 21.9);
  assert.equal(Number(futureTariff.price_ht), 22.9);

  const published = await pricing.publishPricingSession(state.db, storeId, { pricing_session_id: duplicated.session.id, sync_call_sheet: true }, userContext);
  assert.equal(published.session.pricing_date, '2026-09-08');
  assert.equal(state.sessions.find((session) => session.id === 'session-0709').status, 'published');
  assert.equal(state.sessions.find((session) => session.id === 'session-0709').is_active_publication, true);
  assert.equal(state.sessions.find((session) => session.id === duplicated.session.id).status, 'published');
  assert.equal(state.callSheetProducts[0].pricing_session_id, duplicated.session.id);

  const price0709 = await pricing.resolvePublishedPrice(state.db, storeId, {
    client_id: 'client-1',
    article_id: 'article-homard',
    document_date: '2026-09-07',
  });
  const price0809 = await pricing.resolvePublishedPrice(state.db, storeId, {
    client_id: 'client-1',
    article_id: 'article-homard',
    document_date: '2026-09-08',
  });
  assert.equal(price0709.final_unit_price_ht, 21.9);
  assert.equal(price0809.final_unit_price_ht, 22.9);

  const preorder = await salesPriceResolver.resolveSalesLinePrice(state.db, storeId, {
    client_id: 'client-1',
    article_id: 'article-homard',
    article: { id: 'article-homard', designation: 'Homard europeen 600/800' },
    document_date: '2026-09-08',
    preserve_existing: false,
  });
  assert.equal(preorder.source, 'published_pricing');
  assert.equal(preorder.unit_price_ht, 22.9);

  console.log('OK future pricing session date');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
