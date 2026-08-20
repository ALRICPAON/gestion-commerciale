const assert = require('assert');
const callSheet = require('../services/agentCallSheetService');
const { getAgentTool, listMcpTools } = require('../services/agent/agentToolRegistry');
const { listExecutableActions } = require('../services/agent/agentActionOrchestratorService');

function makeContext(overrides = {}) {
  return {
    store_id: 'store-1',
    user_id: 'user-1',
    role: 'admin',
    user_permissions: ['agent.use', 'mcp.execute', 'call_sheet.read', 'call_sheet.write'],
    agent_permissions: ['agent.use', 'mcp.execute', 'call_sheet.read', 'call_sheet.write'],
    source: 'mcp',
    ...overrides,
  };
}

function baseLine(overrides = {}) {
  return {
    id: 'line-1',
    store_id: 'store-1',
    sheet_id: 'sheet-1',
    column_uid: 'col-1',
    article_id: 'article-1',
    supplier_id: 'supplier-1',
    supplier_name: 'DISTRIMER',
    plu: 'ART1',
    designation_snapshot: 'Langoustine 20/30',
    display_order: 1,
    purchase_price_ht: 18.5,
    price_unit: 'kg',
    supplier_available_quantity: null,
    sale_price_level_1_ht: 22,
    sale_price_level_2_ht: 23,
    sale_price_level_3_ht: 24,
    manual_price_level_1: true,
    manual_price_level_2: true,
    manual_price_level_3: true,
    family_code: 'CRUST',
    family_name: 'Crustaces',
    sale_unit: 'kg',
    created_at: '2026-08-20T08:00:00.000Z',
    updated_at: '2026-08-20T08:00:00.000Z',
    ...overrides,
  };
}

function makeDb({ foreignStoreSheet = false } = {}) {
  const state = {
    sheet: {
      id: 'sheet-1',
      store_id: foreignStoreSheet ? 'other-store' : 'store-1',
      sheet_date: '2026-08-20',
      title: "Fiche d'appel DISTRIMER",
      notes: 'Arrivage du jour',
      supplier_id: 'supplier-1',
      supplier_name: 'DISTRIMER',
      default_margin_level_1: 0.1,
      default_margin_level_2: 0.15,
      default_margin_level_3: 0.2,
      selected_client_ids: [],
      order_entries: {},
    },
    articles: new Map([
      ['article-1', { id: 'article-1', plu: 'ART1', designation: 'Langoustine vivante 20/30', family_code: 'CRUST', family_name: 'Crustaces', sale_unit: 'kg', unit: 'kg' }],
      ['article-2', { id: 'article-2', plu: 'ART2', designation: 'Bar de ligne', family_code: 'POIS', family_name: 'Poissons', sale_unit: 'kg', unit: 'kg' }],
    ]),
    suppliers: new Map([
      ['supplier-1', { id: 'supplier-1', name: 'DISTRIMER' }],
      ['supplier-2', { id: 'supplier-2', name: 'ATLANTIQUE MAREE' }],
    ]),
    lines: new Map([
      ['line-1', baseLine()],
      ['line-2', baseLine({ id: 'line-2', column_uid: 'col-2', article_id: 'article-2', plu: 'ART2', designation_snapshot: 'Bar de ligne', display_order: 2, purchase_price_ht: 12.4, sale_price_level_1_ht: null, sale_price_level_2_ht: null, sale_price_level_3_ht: null, manual_price_level_1: false, manual_price_level_2: false, manual_price_level_3: false })],
    ]),
    calls: [],
  };

  function lineWithSupplier(line) {
    const supplier = state.suppliers.get(String(line.supplier_id));
    return { ...line, supplier_name: supplier?.name || null };
  }

  return {
    state,
    async query(sql, params = []) {
      const compact = sql.replace(/\s+/g, ' ').trim();
      state.calls.push({ sql: compact, params });
      if (compact.startsWith('SELECT qs.id, qs.sheet_date')) {
        return { rows: state.sheet.store_id === params[0] ? [{ ...state.sheet, line_count: state.lines.size }] : [] };
      }
      if (compact.startsWith('SELECT qs.*') && compact.includes('FOR UPDATE')) {
        return { rows: state.sheet.store_id === params[0] && state.sheet.id === params[1] ? [{ ...state.sheet }] : [] };
      }
      if (compact.startsWith('SELECT qs.*')) {
        return { rows: state.sheet.store_id === params[0] && (state.sheet.id === params[1] || state.sheet.sheet_date === params[1]) ? [{ ...state.sheet }] : [] };
      }
      if (compact.startsWith('SELECT p.*, a.designation')) {
        return { rows: [...state.lines.values()].filter((line) => line.store_id === params[0] && line.sheet_id === params[1]).map(lineWithSupplier) };
      }
      if (compact.startsWith('SELECT p.*, s.name AS supplier_name')) {
        if (compact.includes('WHERE p.store_id = $1 AND p.id = $2')) {
          const line = state.lines.get(String(params[1]));
          return { rows: line && line.store_id === params[0] ? [lineWithSupplier(line)] : [] };
        }
        return { rows: [...state.lines.values()].filter((line) => line.store_id === params[0]).map(lineWithSupplier) };
      }
      if (compact.startsWith('SELECT id, plu, designation')) {
        const article = state.articles.get(String(params[1]));
        return { rows: article ? [{ ...article }] : [] };
      }
      if (compact.startsWith('SELECT id, name FROM suppliers')) {
        const supplier = state.suppliers.get(String(params[1]));
        return { rows: supplier ? [{ ...supplier }] : [] };
      }
      if (compact.startsWith('SELECT COALESCE(MAX(display_order)')) {
        return { rows: [{ next_order: state.lines.size + 1 }] };
      }
      if (compact.startsWith('INSERT INTO quick_order_sheet_products')) {
        const id = 'line-new';
        state.lines.set(id, baseLine({
          id,
          store_id: params[0],
          sheet_id: params[1],
          column_uid: params[2],
          article_id: params[3],
          supplier_id: params[4],
          plu: params[5],
          designation_snapshot: params[6],
          display_order: params[7],
          purchase_price_ht: params[8],
          price_unit: params[9],
          supplier_available_quantity: params[10],
          sale_price_level_1_ht: params[11],
          sale_price_level_2_ht: params[12],
          sale_price_level_3_ht: params[13],
          manual_price_level_1: params[14],
          manual_price_level_2: params[15],
          manual_price_level_3: params[16],
          family_code: params[17],
          family_name: params[18],
          sale_unit: params[19],
        }));
        return { rows: [{ id }] };
      }
      if (compact.startsWith('UPDATE quick_order_sheet_products')) {
        const line = state.lines.get(String(params[1]));
        Object.assign(line, {
          article_id: params[2],
          supplier_id: params[3],
          plu: params[4],
          designation_snapshot: params[5],
          display_order: params[6],
          purchase_price_ht: params[7],
          price_unit: params[8],
          supplier_available_quantity: params[9],
          sale_price_level_1_ht: params[10],
          sale_price_level_2_ht: params[11],
          sale_price_level_3_ht: params[12],
          manual_price_level_1: params[13],
          manual_price_level_2: params[14],
          manual_price_level_3: params[15],
          family_code: params[16],
          family_name: params[17],
          sale_unit: params[18],
        });
        return { rows: [] };
      }
      if (compact.startsWith('UPDATE quick_order_sheets')) return { rows: [] };
      if (compact.startsWith('DELETE FROM quick_order_sheet_products')) {
        state.lines.delete(String(params[1]));
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL: ${compact}`);
    },
  };
}

async function main() {
  const mcpNames = new Set(listMcpTools().map((tool) => tool.name));
  for (const name of ['list_call_sheets', 'get_call_sheet', 'search_call_sheet_lines', 'prepare_call_sheet_add_line', 'prepare_call_sheet_update_line', 'prepare_call_sheet_delete_line']) {
    assert(mcpNames.has(name), `${name} doit etre expose MCP`);
  }
  const actions = listExecutableActions().map((action) => action.name);
  for (const name of ['call_sheet.add_line', 'call_sheet.update_line', 'call_sheet.delete_line']) {
    assert(actions.includes(name), `${name} doit etre executable apres confirmation`);
  }

  const db = makeDb();
  const listed = await callSheet.listCallSheets(db, 'store-1', { limit: 10 });
  assert.equal(listed.results[0].line_count, 2, 'lecture liste doit compter les lignes');
  const detail = await callSheet.getCallSheet(db, 'store-1', { sheet_id: 'sheet-1' });
  assert.equal(detail.lines.length, 2, 'lecture fiche doit retourner plusieurs lignes');

  const addPrepared = await getAgentTool('prepare_call_sheet_add_line').execute({
    context: makeContext(),
    tool: getAgentTool('prepare_call_sheet_add_line'),
    input: { sheet_id: 'sheet-1', line: { article_id: 'article-1', supplier_id: 'supplier-1', purchase_price: '18,50', unit: 'kg' } },
  });
  assert.equal(addPrepared.data.action_type, 'call_sheet.add_line');
  const added = await callSheet.executeAddLine({ db, context: makeContext(), payload: addPrepared.data.payload });
  assert.equal(added.after.purchase_price_ht, 18.5, 'prix achat ajoute attendu');
  assert.equal(added.after.supplier_id, 'supplier-1', 'fournisseur ajoute attendu');
  assert.equal(added.after.sale_price_level_1_ht, null, 'tarif 1 non fourni ne doit pas etre calcule');
  assert.equal(added.after.sale_price_level_2_ht, null, 'tarif 2 non fourni ne doit pas etre calcule');
  assert.equal(added.after.sale_price_level_3_ht, null, 'tarif 3 non fourni ne doit pas etre calcule');

  const beforeUpdate = { ...db.state.lines.get('line-1') };
  const updatedPrice = await callSheet.executeUpdateLine({ db, context: makeContext(), payload: { line_id: 'line-1', changes: { purchase_price: 19.2 } } });
  assert.equal(updatedPrice.after.purchase_price_ht, 19.2, 'prix achat modifie attendu');
  assert.equal(updatedPrice.after.article_id, beforeUpdate.article_id, 'article preserve');
  assert.equal(updatedPrice.after.supplier_id, beforeUpdate.supplier_id, 'fournisseur preserve');
  assert.equal(updatedPrice.after.sale_price_level_1_ht, beforeUpdate.sale_price_level_1_ht, 'tarif 1 preserve');
  assert.equal(updatedPrice.after.sale_price_level_2_ht, beforeUpdate.sale_price_level_2_ht, 'tarif 2 preserve');
  assert.equal(updatedPrice.after.sale_price_level_3_ht, beforeUpdate.sale_price_level_3_ht, 'tarif 3 preserve');

  const updatedTariff = await callSheet.executeUpdateLine({ db, context: makeContext(), payload: { line_id: 'line-1', changes: { tariff_1: 25.5 } } });
  assert.equal(updatedTariff.after.sale_price_level_1_ht, 25.5, 'tarif 1 explicite modifie');
  assert.equal(updatedTariff.after.sale_price_level_2_ht, beforeUpdate.sale_price_level_2_ht, 'tarif 2 non fourni preserve');
  assert.equal(updatedTariff.after.sale_price_level_3_ht, beforeUpdate.sale_price_level_3_ht, 'tarif 3 non fourni preserve');

  let refused = false;
  try {
    callSheet.normalizeUpdateLinePayload({ line_id: 'line-1', changes: { rogue: true } });
  } catch (error) {
    refused = error.status === 400;
  }
  assert.equal(refused, true, 'cle arbitraire refusee');

  const isolatedDb = makeDb({ foreignStoreSheet: true });
  refused = false;
  try {
    await callSheet.executeAddLine({ db: isolatedDb, context: makeContext(), payload: { sheet_id: 'sheet-1', line: { designation: 'Test' } } });
  } catch (error) {
    refused = error.status === 404;
  }
  assert.equal(refused, true, 'fiche autre magasin refusee');

  const deletePrepared = await getAgentTool('prepare_call_sheet_delete_line').execute({
    context: makeContext(),
    tool: getAgentTool('prepare_call_sheet_delete_line'),
    input: { line_id: 'line-2' },
  });
  assert.equal(deletePrepared.data.action_type, 'call_sheet.delete_line');
  assert(deletePrepared.data.prepared_action.required_permissions.includes('mcp.execute'), 'suppression doit passer par mcp.execute');
  const deleted = await callSheet.executeDeleteLine({ db, context: makeContext(), payload: deletePrepared.data.payload });
  assert.equal(deleted.deleted, true, 'ligne supprimee');
  assert.equal(db.state.lines.has('line-2'), false, 'relecture apres suppression absente');

  console.log(JSON.stringify({
    ok: true,
    tests: [
      'lecture fiche avec plusieurs lignes',
      'ajout ligne article/fournisseur/prix achat sans calcul tarifs',
      'modification prix achat seule preserve article/fournisseur/tarifs',
      'tarif 1 modifie uniquement si explicitement fourni',
      'suppression preparee avec mcp.execute puis executee',
      'cles interdites refusees',
      'isolation magasin refusee',
      'relecture apres ecriture verifiee',
    ],
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
