const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  LABEL_DOTS,
  buildHealthLabelModels,
  combineZpl,
  parseHealthMark,
} = require('../services/healthLabelService');

const document = {
  id: 'delivery-note-1',
  reference_number: 'BL-2026-001',
  document_date: '2026-08-19',
  delivered_client_name: 'LECLERC CHALLANS',
  delivered_client_store_identifier: '88',
};

const storeSettings = {
  company_name: 'ALTA MAREE',
  logo_url: 'https://api.altamaree.fr/uploads/store-logos/logo.png',
  address_line1: '1 quai des mareyeurs',
  postal_code: '85300',
  city: 'Challans',
  phone: '02 00 00 00 00',
  sanitary_approval_number: 'FR 85.000.001 CE',
};

const baseLine = {
  id: 'line-1',
  line_number: 1,
  article_label: 'LANGOUSTINE VIVANTE',
  article_plu: '1234',
  package_count: 10,
  weight_per_package: 3,
  total_weight: 30,
  sold_quantity: 30,
  sale_unit: 'kg',
  latin_name: 'Nephrops norvegicus',
  fao_zone: '27',
  sous_zone: 'VIII',
  fishing_gear: 'Casiers',
  production_method: 'Peche',
  allergens: 'Crustaces',
  traceability_snapshot: {
    lot_code: 'LOT-A',
    dlc: '2026-08-21',
  },
  lots: [{
    lot_id: 'lot-a',
    lot_code: 'LOT-A',
    supplier_lot_number: 'SUP-A',
    dlc: '2026-08-21',
    quantity: 30,
  }],
};

const labels = buildHealthLabelModels({
  document,
  lines: [baseLine],
  storeSettings,
});

assert.strictEqual(LABEL_DOTS, 1181);
assert.strictEqual(labels.length, 10, '10 colis doivent produire 10 etiquettes');
assert.strictEqual(labels[0].net_weight, 3, 'le poids etiquette doit etre le poids par colis');
assert.strictEqual(labels[0].net_weight_label, '3,000 kg');
assert.strictEqual(labels[0].delivered_client_display, 'LECLERC CHALLANS - N° 88');
assert.strictEqual(labels[0].company.sanitary_approval_number, 'FR 85.000.001 CE');
assert.deepStrictEqual(labels[0].company.health_mark, {
  country: 'FR',
  approval_number: '85.000.001',
  authority: 'UE',
  raw: 'FR 85.000.001 CE',
});
assert(labels[0].zpl.includes('^PW1181'));
assert(labels[0].zpl.includes('^LL1181'));
assert(labels[0].zpl.includes('LECLERC CHALLANS - N  88'));
assert(labels[0].zpl.includes('POIDS NET: 3,000 kg'));
assert(labels[0].zpl.includes('85.000.001'));
assert(!labels[0].zpl.includes('DECONGELE'), 'decongele ne doit pas apparaitre par defaut');

const oneLabel = buildHealthLabelModels({
  document,
  lines: [baseLine],
  storeSettings,
  lineNumber: 1,
  copies: 1,
});
assert.strictEqual(oneLabel.length, 1, 'reimpression ligne copies=1 doit produire 1 etiquette');

const defrostedLabels = buildHealthLabelModels({
  document,
  lines: [{
    ...baseLine,
    traceability_snapshot: {
      ...baseLine.traceability_snapshot,
      decongele: true,
    },
  }],
  storeSettings,
  copies: 1,
});
assert.strictEqual(defrostedLabels[0].traceability.defrosted, true);
assert(defrostedLabels[0].zpl.includes('DECONGELE'));

const noApproval = buildHealthLabelModels({
  document,
  lines: [baseLine],
  storeSettings: { ...storeSettings, sanitary_approval_number: '' },
  copies: 1,
});
assert.strictEqual(noApproval[0].company.sanitary_approval_number, null);
assert.strictEqual(noApproval[0].company.health_mark, null);
assert(!noApproval[0].zpl.includes('FR 85.000.001 CE'));

const multipleLines = buildHealthLabelModels({
  document,
  lines: [
    baseLine,
    { ...baseLine, id: 'line-2', line_number: 2, package_count: 4, total_weight: 12, sold_quantity: 12 },
    { ...baseLine, id: 'line-3', line_number: 3, package_count: 2, total_weight: 6, sold_quantity: 6 },
  ],
  storeSettings,
});
assert.strictEqual(multipleLines.length, 16, '10 + 4 + 2 colis doivent produire 16 etiquettes');
assert.strictEqual(combineZpl(oneLabel).split('^XA').length - 1, 1);

const multiLots = buildHealthLabelModels({
  document,
  lines: [{
    ...baseLine,
    traceability_snapshot: {},
    lots: [
      {
        lot_id: 'lot-a',
        lot_code: 'LOT-A',
        dlc: '2026-08-21',
        quantity: 18,
        traceability_data: { latin_name: 'Nephrops norvegicus A', fao_zone: '27-A' },
      },
      {
        lot_id: 'lot-b',
        lot_code: 'LOT-B',
        dlc: '2026-08-22',
        quantity: 12,
        traceability_data: { latin_name: 'Nephrops norvegicus B', fao_zone: '27-B' },
      },
    ],
  }],
  storeSettings,
});
assert.strictEqual(multiLots.length, 10, '18 kg + 12 kg en colis de 3 kg doivent produire 10 etiquettes');
assert.strictEqual(multiLots.filter((label) => label.traceability.lot_code === 'LOT-A').length, 6);
assert.strictEqual(multiLots.filter((label) => label.traceability.lot_code === 'LOT-B').length, 4);
assert.strictEqual(multiLots[0].traceability.fao_zone, '27-A');
assert.strictEqual(multiLots[6].traceability.fao_zone, '27-B');
assert(!multiLots.warnings.length, 'repartition multi-lots entiere ne doit pas produire d avertissement');

const lotBOnly = buildHealthLabelModels({
  document,
  lines: [baseLine],
  storeSettings,
  lineNumber: 1,
  lotId: 'lot-a',
  copies: 2,
});
assert.strictEqual(lotBOnly.length, 2, 'reimpression ciblee par lot doit limiter les copies');
assert(lotBOnly.every((label) => label.allocation_lot_id === 'lot-a'));

const ambiguousLots = buildHealthLabelModels({
  document,
  lines: [{
    ...baseLine,
    lots: [
      { lot_id: 'lot-a', lot_code: 'LOT-A', quantity: 17 },
      { lot_id: 'lot-b', lot_code: 'LOT-B', quantity: 13 },
    ],
  }],
  storeSettings,
});
assert.strictEqual(ambiguousLots.length, 0, 'une repartition multi-lots non divisible ne doit pas inventer les colis');
assert(ambiguousLots.warnings.some((warning) => warning.includes('non divisible')));

const noLotLine = {
  ...baseLine,
  id: 'line-no-lot',
  line_number: 4,
  package_count: 3,
  weight_per_package: 2,
  total_weight: 6,
  sold_quantity: 6,
  lots: [],
  traceability_snapshot: {
    lot_code: 'SNAPSHOT-LOT-IGNORED',
    latin_name: 'Gadus morhua',
    fao_zone: '27',
    sous_zone: 'VII',
    fishing_gear: 'Chalut',
    production_method: 'Peche',
    allergens: 'Poisson',
  },
};

const noLotLabels = buildHealthLabelModels({
  document,
  lines: [noLotLine],
  storeSettings,
});
assert.strictEqual(noLotLabels.length, 3, 'ligne sans lot doit rester techniquement generable');
assert(noLotLabels.warnings.some((warning) => warning.includes('missing_lot_traceability')));
assert.strictEqual(noLotLabels[0].traceability.lot_id, null);
assert.strictEqual(noLotLabels[0].traceability.lot_code, null);
assert.strictEqual(noLotLabels[0].traceability.supplier_lot_number, null);
assert.strictEqual(noLotLabels[0].traceability.latin_name, 'Gadus morhua');
assert.strictEqual(noLotLabels[0].traceability.fao_zone, '27');
assert(noLotLabels[0].zpl.includes('Gadus morhua'));
assert(!noLotLabels[0].zpl.includes('SNAPSHOT-LOT-IGNORED'), 'le ZPL ne doit pas imprimer un faux lot sans allocation');

const mixedDeliveryNoteLabels = buildHealthLabelModels({
  document,
  lines: [
    { ...baseLine, id: 'mixed-1', line_number: 1, package_count: 2, weight_per_package: 3, total_weight: 6, sold_quantity: 6, lots: [{ lot_id: 'lot-a', lot_code: 'LOT-A', quantity: 6 }] },
    { ...noLotLine, id: 'mixed-2', line_number: 2 },
    { ...baseLine, id: 'mixed-3', line_number: 3, package_count: 1, weight_per_package: 4, total_weight: 4, sold_quantity: 4, lots: [{ lot_id: 'lot-c', lot_code: 'LOT-C', quantity: 4 }] },
  ],
  storeSettings,
});
assert.strictEqual(mixedDeliveryNoteLabels.length, 6, 'BL mixte: 2 + 3 + 1 etiquettes attendues');
assert.strictEqual(mixedDeliveryNoteLabels.filter((label) => label.line_number === 2).length, 3);
assert.strictEqual(mixedDeliveryNoteLabels.warnings.filter((warning) => warning.includes('missing_lot_traceability')).length, 1);
assert(mixedDeliveryNoteLabels.every((label) => label.zpl && label.zpl.includes('^XA')));

const noLotReprint = buildHealthLabelModels({
  document,
  lines: [noLotLine],
  storeSettings,
  lineNumber: 4,
  copies: 1,
});
assert.strictEqual(noLotReprint.length, 1, 'reimpression ligne sans lot avec copies=1 doit produire un modele');
assert.strictEqual(noLotReprint[0].traceability.lot_code, null);
assert(noLotReprint.warnings.some((warning) => warning.includes('missing_lot_traceability')));

assert.deepStrictEqual(parseHealthMark('FR 85 123 456 UE'), {
  country: 'FR',
  approval_number: '85 123 456',
  authority: 'UE',
  raw: 'FR 85 123 456 UE',
});
assert.deepStrictEqual(parseHealthMark('85.123.456'), {
  country: 'FR',
  approval_number: '85.123.456',
  authority: 'UE',
  raw: '85.123.456',
});

const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'deliveryNotes.js'), 'utf8');
const routeStart = routeSource.indexOf("router.get('/delivery-notes/:id/health-labels'");
const routeEnd = routeSource.indexOf("router.get('/delivery-notes/:id/communication-options'");
const healthLabelsRoute = routeSource.slice(routeStart, routeEnd);
assert(!/\bINSERT\b|\bUPDATE\b|\bDELETE\b/i.test(healthLabelsRoute), 'la route health-labels ne doit pas ecrire en base');

console.log('health label tests ok');
