const assert = require('assert');

const { PennylaneApiError } = require('../services/pennylane');
const {
  calculateIncomeStatement,
  matchMapping,
} = require('../services/financialReporting/calculator');
const {
  fetchPennylaneTrialBalance,
  functionalPennylaneError,
} = require('../services/financialReporting/pennylaneTrialBalance');
const { saveTrialBalanceSnapshot } = require('../services/financialReporting/repository');

const mappings = [
  { account_prefix: '70', section_code: 'operating_revenue', subsection_code: 'revenue', display_label: 'CA', calculation_sign: 1, display_order: 10 },
  { account_prefix: '607', section_code: 'operating_expenses', subsection_code: 'goods_purchases', display_label: 'Achats marchandises', calculation_sign: -1, display_order: 18 },
  { account_prefix: '6037', section_code: 'operating_expenses', subsection_code: 'stock_variation', display_label: 'Variation stock marchandises', calculation_sign: -1, display_order: 20 },
  { account_prefix: '603', section_code: 'operating_expenses', subsection_code: 'stock_variation', display_label: 'Variation stock', calculation_sign: -1, display_order: 21 },
  { account_prefix: '60', section_code: 'operating_expenses', subsection_code: 'purchases', display_label: 'Autres achats', calculation_sign: -1, display_order: 30 },
  { account_prefix: '61', section_code: 'operating_expenses', subsection_code: 'external_services', display_label: 'Services exterieurs', calculation_sign: -1, display_order: 40 },
  { account_prefix: '6226', section_code: 'operating_expenses', subsection_code: 'other_external_services', display_label: 'Honoraires', calculation_sign: -1, display_order: 44 },
  { account_prefix: '62', section_code: 'operating_expenses', subsection_code: 'other_external_services', display_label: 'Autres services', calculation_sign: -1, display_order: 45 },
  { account_prefix: '624', section_code: 'operating_expenses', subsection_code: 'transport', display_label: 'Transport', calculation_sign: -1, display_order: 47 },
  { account_prefix: '625', section_code: 'operating_expenses', subsection_code: 'other_external_services', display_label: 'Receptions', calculation_sign: -1, display_order: 48 },
  { account_prefix: '63', section_code: 'operating_expenses', subsection_code: 'taxes', display_label: 'Taxes', calculation_sign: -1, display_order: 50 },
  { account_prefix: '645', section_code: 'operating_expenses', subsection_code: 'social_charges', display_label: 'Charges sociales', calculation_sign: -1, display_order: 58 },
  { account_prefix: '641', section_code: 'operating_expenses', subsection_code: 'wages', display_label: 'Salaires appointements', calculation_sign: -1, display_order: 59 },
  { account_prefix: '64', section_code: 'operating_expenses', subsection_code: 'wages', display_label: 'Salaires', calculation_sign: -1, display_order: 60 },
  { account_prefix: '65', section_code: 'operating_expenses', subsection_code: 'other_operating_expenses', display_label: 'Autres charges de gestion', calculation_sign: -1, display_order: 65 },
  { account_prefix: '68', section_code: 'operating_expenses', subsection_code: 'depreciation', display_label: 'Dotations', calculation_sign: -1, display_order: 70 },
  { account_prefix: '76', section_code: 'financial_result', subsection_code: 'financial_income', display_label: 'Produits financiers', calculation_sign: 1, display_order: 80 },
  { account_prefix: '66', section_code: 'financial_result', subsection_code: 'financial_expenses', display_label: 'Charges financieres', calculation_sign: -1, display_order: 90 },
  { account_prefix: '77', section_code: 'exceptional_result', subsection_code: 'exceptional_income', display_label: 'Produits exceptionnels', calculation_sign: 1, display_order: 100 },
  { account_prefix: '67', section_code: 'exceptional_result', subsection_code: 'exceptional_expenses', display_label: 'Charges exceptionnelles', calculation_sign: -1, display_order: 110 },
  { account_prefix: '69', section_code: 'income_tax', subsection_code: 'income_tax', display_label: 'IS', calculation_sign: -1, display_order: 120 },
];

function line(account, debit, credit, label = account) {
  return {
    account_number: account,
    formatted_account_number: account,
    account_label: label,
    total_debit: debit,
    total_credit: credit,
    net_balance: credit - debit,
  };
}

function sampleReport(extraLines = []) {
  return calculateIncomeStatement({
    lines: [
      line('707000', 0, 10000, 'Ventes'),
      line('607000', 3000, 0, 'Achats marchandises'),
      line('603700', 500, 0, 'Variation stock debit'),
      line('613000', 800, 0, 'Loyer'),
      line('622000', 120, 0, 'Honoraires'),
      line('630000', 200, 0, 'Taxes'),
      line('641000', 1500, 0, 'Salaires'),
      line('645000', 450, 0, 'Charges sociales'),
      line('681000', 300, 0, 'Dotations'),
      line('760000', 0, 50, 'Interets recus'),
      line('661000', 100, 0, 'Interets payes'),
      line('770000', 0, 30, 'Produit exceptionnel'),
      line('671000', 10, 0, 'Charge exceptionnelle'),
      line('695000', 600, 0, 'Impot benefices'),
      ...extraLines,
    ],
    mappings,
    periodStart: '2026-01-01',
    periodEnd: '2026-01-31',
    now: new Date('2026-02-15T00:00:00Z'),
    snapshot: { status: 'success' },
  });
}

function pennylaneSampleReport(customMappings = mappings) {
  return calculateIncomeStatement({
    lines: [
      line('607000000', 9230.50, 0, 'Achats de marchandises'),
      line('622600000', 1870.08, 0, 'Honoraires'),
      line('625700000', 49.82, 0, 'Receptions'),
      line('707000000', 185, 10517, 'Ventes de marchandises'),
    ],
    mappings: customMappings,
    periodStart: '2026-01-01',
    periodEnd: '2026-01-31',
    now: new Date('2026-02-15T00:00:00Z'),
    snapshot: { status: 'success' },
  });
}

async function testPagination() {
  const calls = [];
  const client = {
    async get(endpoint) {
      calls.push(endpoint);
      if (!endpoint.includes('cursor=next-1')) {
        return { body: { items: [line('707000', 0, 100)], next_cursor: 'next-1', has_more: true } };
      }
      return { body: { items: [line('607000', 40, 0)], has_more: false } };
    },
  };
  const result = await fetchPennylaneTrialBalance({
    periodStart: '2026-01-01',
    periodEnd: '2026-01-31',
    client,
  });
  assert.equal(result.pages, 2, 'pagination Pennylane');
  assert.equal(result.lines.length, 2, 'lignes paginees');
  assert.ok(calls[0].includes('/trial_balance?'), 'endpoint trial_balance utilise');
}

async function testSnapshotIdempotent() {
  const state = { lines: [], began: 0, committed: 0, deleted: 0 };
  const db = {
    async query(sql, params = []) {
      if (sql === 'BEGIN') { state.began += 1; return { rows: [] }; }
      if (sql === 'COMMIT') { state.committed += 1; return { rows: [] }; }
      if (sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('INSERT INTO pennylane_trial_balance_snapshots')) {
        return { rows: [{ id: 'snapshot-1', store_id: params[0], period_start: params[1], period_end: params[2], status: params[4] }] };
      }
      if (sql.includes('DELETE FROM pennylane_trial_balance_lines')) {
        state.deleted += 1;
        state.lines = [];
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO pennylane_trial_balance_lines')) {
        state.lines.push(params);
        return { rows: [] };
      }
      throw new Error(`SQL inattendu: ${sql.slice(0, 80)}`);
    },
  };
  await saveTrialBalanceSnapshot(db, { storeId: 'store-1', periodStart: '2026-01-01', periodEnd: '2026-01-31', lines: [line('707000', 0, 100)] });
  await saveTrialBalanceSnapshot(db, { storeId: 'store-1', periodStart: '2026-01-01', periodEnd: '2026-01-31', lines: [line('707000', 0, 150)] });
  assert.equal(state.began, 2, 'transaction par sauvegarde');
  assert.equal(state.committed, 2, 'commit par sauvegarde');
  assert.equal(state.deleted, 2, 'remplacement idempotent des lignes');
  assert.equal(state.lines.length, 1, 'pas de doublon de lignes');
  assert.equal(state.lines[0][5], 150, 'derniere balance conservee');
}

async function run() {
  const report = sampleReport();
  assert.equal(report.calculations.revenue, 10000, 'calcul credit produit');
  assert.equal(report.calculations.goods_purchases, 3000, 'achats marchandises');
  assert.equal(report.calculations.purchases, 3000, 'calcul debit charge');
  assert.equal(report.calculations.stock_variation, 500, 'compte 603 debit positif');
  assert.equal(sampleReport([line('603800', 0, 200)]).calculations.stock_variation, 300, 'compte 603 credit negatif');
  assert.equal(report.calculations.wages, 1500, 'salaires');
  assert.equal(report.calculations.social_charges, 450, 'charges sociales');
  assert.equal(report.calculations.gross_margin, 6500, 'marge commerciale');
  assert.equal(report.calculations.ebitda, 3430, 'EBE');
  assert.equal(report.calculations.operating_result, 3130, 'resultat exploitation');
  assert.equal(report.calculations.financial_result, -50, 'resultat financier');
  assert.equal(report.calculations.exceptional_result, 20, 'resultat exceptionnel');
  assert.equal(report.calculations.net_result, 2500, 'resultat net');
  assert.equal(matchMapping(line('603700', 1, 0), mappings).account_prefix, '6037', 'correspondance la plus precise');
  assert.equal(matchMapping(line('622600000', 1, 0), mappings).account_prefix, '6226', 'prefixe honoraires prioritaire');
  assert.equal(matchMapping(line('624100000', 1, 0), mappings).account_prefix, '624', 'prefixe transport prioritaire sur 62');

  const pennylaneSample = pennylaneSampleReport();
  assert.equal(pennylaneSample.calculations.total_charges, 11150.40, 'charges sample Pennylane');
  assert.equal(pennylaneSample.calculations.total_products, 10332, 'produits sample Pennylane avec debit produit');
  assert.equal(pennylaneSample.calculations.net_result, -818.40, 'resultat sample Pennylane');
  assert.equal(pennylaneSample.consistency_control.gaps.result, 0, 'aucun ecart sample Pennylane');
  assert.equal(pennylaneSample.consistency_control.status, 'conforme', 'controle conforme sample Pennylane');
  assert.equal(pennylaneSample.unknown_accounts.length, 0, 'aucun compte 6/7 ignore si mapping present');

  const empty = calculateIncomeStatement({ lines: [], mappings, periodStart: '2026-01-01', periodEnd: '2026-01-31', now: new Date('2026-02-15T00:00:00Z'), snapshot: { status: 'success' } });
  assert.equal(empty.incomplete, true, 'periode vide incomplete');

  const mappingsWithout65 = mappings.filter((mapping) => mapping.account_prefix !== '65');
  const unknown = calculateIncomeStatement({ lines: [line('658900000', 1250, 0, 'Compte a classer')], mappings: mappingsWithout65, snapshot: { status: 'success' } });
  assert.equal(unknown.unknown_accounts.length, 1, 'classe 6 inconnue a classer');
  assert.equal(unknown.sections.find((section) => section.section_code === 'to_classify').amount, 1250, 'classe 6 inconnue incluse dans les totaux');
  assert.equal(unknown.calculations.total_charges, 1250, 'classe 6 inconnue incluse dans les charges');
  assert.equal(unknown.consistency_control.status, 'conforme', 'classe 6 inconnue reconciliee avec la balance');
  assert.equal(calculateIncomeStatement({ lines: [line('471000', 10, 0)], mappings, snapshot: { status: 'success' } }).unknown_accounts.length, 0, 'classe hors 6/7 ignoree hors compte de resultat');

  const scope = functionalPennylaneError(new PennylaneApiError('Erreur API Pennylane', { status: 403 }));
  assert.equal(scope.code, 'PENNYLANE_TRIAL_BALANCE_SCOPE_MISSING', 'absence scope explicite');

  await testPagination();
  await testSnapshotIdempotent();
  console.log('Tests compte exploitation OK');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
