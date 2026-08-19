const assert = require('assert');

const {
  LABEL_DOTS,
  buildHealthLabelModels,
  combineZpl,
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
  production_method: 'Pêche',
  allergens: 'Crustacés',
  traceability_snapshot: {
    lot_code: 'LOT-A',
    dlc: '2026-08-21',
  },
  lots: [{
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
assert(labels[0].zpl.includes('^PW1181'));
assert(labels[0].zpl.includes('^LL1181'));
assert(labels[0].zpl.includes('LECLERC CHALLANS - N  88'));
assert(labels[0].zpl.includes('POIDS NET: 3,000 kg'));
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
assert(!noApproval[0].zpl.includes('FR 85.000.001 CE'));

const multipleLines = buildHealthLabelModels({
  document,
  lines: [
    baseLine,
    { ...baseLine, id: 'line-2', line_number: 2, package_count: 4 },
    { ...baseLine, id: 'line-3', line_number: 3, package_count: 2 },
  ],
  storeSettings,
});
assert.strictEqual(multipleLines.length, 16, '10 + 4 + 2 colis doivent produire 16 etiquettes');
assert.strictEqual(combineZpl(oneLabel).split('^XA').length - 1, 1);

console.log('health label tests ok');
