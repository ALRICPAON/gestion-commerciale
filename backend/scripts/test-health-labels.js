const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const {
  DETACHABLE_TAB,
  LABEL_DOTS,
  LABEL_HEIGHT_DOTS,
  LABEL_HEIGHT_MM,
  LABEL_VISUAL_HEIGHT_DOTS,
  LABEL_VISUAL_WIDTH_DOTS,
  LABEL_WIDTH_DOTS,
  LABEL_WIDTH_MM,
  MAIN_ZONE,
  SAFE_MARGIN,
  buildHealthLabelModels,
  combineZpl,
  formatAllergen,
  formatFishingArea,
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
  allergens: 'Crustacés',
  traceability_snapshot: {
    lot_code: 'LOT-A',
    dlc: '2026-08-21',
    origin_label: 'DISTRIMER',
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

assert.strictEqual(LABEL_WIDTH_MM, 70);
assert.strictEqual(LABEL_HEIGHT_MM, 150);
assert.strictEqual(LABEL_DOTS, 827);
assert.strictEqual(LABEL_WIDTH_DOTS, 827);
assert.strictEqual(LABEL_HEIGHT_DOTS, 1772);
assert.strictEqual(LABEL_VISUAL_WIDTH_DOTS, 1772);
assert.strictEqual(LABEL_VISUAL_HEIGHT_DOTS, 827);
assert.strictEqual(SAFE_MARGIN, 24);
assert.deepStrictEqual(MAIN_ZONE, { x: 24, y: 24, width: 1724, height: 779 });
assert.deepStrictEqual(DETACHABLE_TAB, { x: 24, y: 236, width: 1724, height: 354 });
assert.strictEqual(labels.length, 10, '10 colis doivent produire 10 etiquettes');
assert.strictEqual(labels[0].net_weight, 3, 'le poids etiquette doit etre le poids par colis');
assert.strictEqual(labels[0].net_weight_label, '3,000 kg');
assert.strictEqual(labels[0].delivered_client_display, 'LECLERC CHALLANS - N° 88');
assert.strictEqual(labels[0].company.sanitary_approval_number, 'FR 85.000.001 CE');
assert.strictEqual(labels[0].company.logo_url, storeSettings.logo_url);
assert.strictEqual(labels[0].fishing_area_label, 'Atlantique Nord-Est - FAO 27');
assert.strictEqual(labels[0].conditioning_date, '2026-08-19');
assert.strictEqual(labels[0].conditioning_date_label, '19/08/2026');
assert.strictEqual(labels[0].allergen_label, 'CRUSTACÉS');
assert.strictEqual(labels[0].printer.width_mm, 70);
assert.strictEqual(labels[0].printer.height_mm, 150);
assert.strictEqual(labels[0].printer.width_dots, 827);
assert.strictEqual(labels[0].printer.height_dots, 1772);
assert.strictEqual(labels[0].printer.visual_width_mm, 150);
assert.strictEqual(labels[0].printer.visual_height_mm, 70);
assert.deepStrictEqual(labels[0].printer.main_zone, MAIN_ZONE);
assert.deepStrictEqual(labels[0].printer.detachable_tab, DETACHABLE_TAB);
assert.deepStrictEqual(labels[0].company.health_mark, {
  country: 'FR',
  approval_number: '85.000.001',
  authority: 'UE',
  raw: 'FR 85.000.001 CE',
});
assert(labels[0].zpl.includes('^PW827'));
assert(labels[0].zpl.includes('^LL1772'));
assert(labels[0].zpl.includes('^A0R'), 'le contenu doit etre imprime dans le sens horizontal apres pose');
assert(labels[0].zpl.includes('LECLERC CHALLANS - N  88'));
assert(labels[0].zpl.includes('POIDS NET: 3,000 kg'));
assert(labels[0].zpl.includes('85.000.001'));
assert(labels[0].zpl.includes('ZONE DE PECHE: Atlantique Nord-Est - FAO 27'));
assert(labels[0].zpl.includes('Sous-zone: VIII'));
assert(labels[0].zpl.includes('DATE DE CONDITIONNEMENT: 19/08/2026'));
assert(labels[0].zpl.includes('ALLERGENE: CRUSTACES'));
assert(labels[0].zpl.includes('Nephrops norvegicus'), 'la languette doit reprendre le nom scientifique');
assert(labels[0].zpl.includes('Engin: Casiers'), 'la languette doit reprendre l engin de peche');
assert(!labels[0].zpl.includes('LANGUETTE TRACABILITE'), 'aucune fausse mention de languette ne doit etre imprimee');
assert(!labels[0].zpl.includes('Origine'), 'Origine ne doit pas apparaitre dans le ZPL');
assert(!labels[0].zpl.includes('DISTRIMER'), 'la provenance/fournisseur ne doit pas apparaitre dans le ZPL');
assert(!labels[0].zpl.includes('0/+2'), 'aucune temperature inventee ne doit apparaitre dans le ZPL');
assert(!labels[0].zpl.includes('Conservation'), 'aucune condition de conservation non structuree ne doit apparaitre dans le ZPL');
assert.strictEqual(labels[0].storage_temperature_label, null, 'aucune plage de conservation si les champs structures sont absents');
assert(!labels[0].zpl.includes('DECONGELE'), 'decongele ne doit pas apparaitre par defaut');
assert.strictEqual(formatFishingArea('FAO 27'), 'Atlantique Nord-Est - FAO 27');
assert.strictEqual(formatFishingArea('34'), '34');
assert.strictEqual(formatAllergen('Crustacés'), 'CRUSTACÉS');

const oneLabel = buildHealthLabelModels({
  document,
  lines: [baseLine],
  storeSettings,
  lineNumber: 1,
  copies: 1,
});
const zplOrigins = Array.from(labels[0].zpl.matchAll(/\^FO(\d+),(\d+)/g), (match) => ({
  x: Number(match[1]),
  y: Number(match[2]),
}));
function zplTextBoxes(zpl) {
  return Array.from(zpl.matchAll(/\^FO(\d+),(\d+)\^A0R,(\d+),\d+\^FB(\d+),(\d+),\d+,[A-Z],0\^FD([^^]+)\^FS/g), (match) => {
    const fontHeight = Number(match[3]);
    const lines = Number(match[5]);
    return {
      text: match[6],
      x: Number(match[2]),
      y: Number(match[1]),
      width: Number(match[4]),
      height: lines * (fontHeight + 4),
    };
  });
}
function isInsideZone(box, zone) {
  return box.x >= zone.x
    && box.y >= zone.y
    && box.x + box.width <= zone.x + zone.width
    && box.y + box.height <= zone.y + zone.height;
}
function textBoxContaining(zpl, text) {
  return zplTextBoxes(zpl).find((box) => box.text.includes(text));
}
function textBoxInZone(zpl, text, zone) {
  return zplTextBoxes(zpl).find((box) => box.text.includes(text) && isInsideZone(box, zone));
}
assert(zplOrigins.length > 20, 'le ZPL doit contenir des champs positionnes');
assert(zplOrigins.every((origin) => origin.x >= 0 && origin.x <= LABEL_WIDTH_DOTS), 'aucune origine X ne doit depasser la largeur imprimable');
assert(zplOrigins.every((origin) => origin.y >= 0 && origin.y <= LABEL_HEIGHT_DOTS), 'aucune origine Y ne doit depasser la longueur imprimable');
assert(zplOrigins.some((origin) => origin.x >= DETACHABLE_TAB.y && origin.y >= DETACHABLE_TAB.x), 'la languette doit recevoir des champs ZPL');
['Nephrops norvegicus', 'Methode: Peche', 'ZONE DE PECHE', 'Sous-zone: VIII', 'Engin: Casiers', 'Lot: LOT-A', 'DATE DE CONDITIONNEMENT'].forEach((text) => {
  const box = textBoxInZone(labels[0].zpl, text, DETACHABLE_TAB);
  assert(box, `champ attendu dans la languette: ${text}`);
});
assert(DETACHABLE_TAB.width >= Math.round(144 * 300 / 25.4), 'la languette doit utiliser quasiment toute la longueur de 146 mm');
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

const noAllergen = buildHealthLabelModels({
  document,
  lines: [{ ...baseLine, allergens: '', traceability_snapshot: {}, lots: [] }],
  storeSettings,
  copies: 1,
});
assert.strictEqual(noAllergen[0].allergen_label, null);
assert(!noAllergen[0].zpl.includes('ALLERGENE'), 'aucune ligne allergene si la donnee est absente');

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

const storageLabels = buildHealthLabelModels({
  document,
  lines: [{
    ...baseLine,
    storage_temperature_min: 3,
    storage_temperature_max: 5,
    storage_instruction: 'Conserver entre 3 et 5 degres',
  }],
  storeSettings,
  copies: 1,
});
assert.strictEqual(storageLabels[0].storage_temperature_label, '3 à 5 °C');
assert.strictEqual(storageLabels[0].storage_instruction_label, 'Conserver entre 3 et 5 degres');
assert(storageLabels[0].zpl.includes('CONSERVATION: 3 a 5  C'), 'ZPL doit afficher la plage structuree');
assert(storageLabels[0].zpl.includes('MENTION: Conserver entre 3 et 5 degres'), 'ZPL doit afficher l instruction structuree');
['CONSERVATION: 3 a 5  C', 'MENTION: Conserver entre 3 et 5 degres'].forEach((text) => {
  const box = textBoxContaining(storageLabels[0].zpl, text);
  assert(box, `champ conservation attendu: ${text}`);
  assert(isInsideZone(box, DETACHABLE_TAB), `champ conservation hors languette: ${text}`);
});

const singleBoundStorageLabels = buildHealthLabelModels({
  document,
  lines: [{ ...baseLine, storage_temperature_min: 0 }],
  storeSettings,
  copies: 1,
});
assert.strictEqual(singleBoundStorageLabels[0].storage_temperature_label, null, 'une seule borne ne doit pas inventer une plage');

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

const healthLabelsFrontendSource = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'js', 'health-labels.js'), 'utf8');
const frontendSandbox = {
  window: {
    APP_CONFIG: { API_BASE_URL: 'http://localhost:3002' },
    location: { protocol: 'http:' },
    URL,
  },
  document: {},
  setTimeout,
};
vm.runInNewContext(healthLabelsFrontendSource, frontendSandbox);
assert.strictEqual(
  frontendSandbox.window.HealthLabels.resolveLogoUrl('http://old-host.local/uploads/store-logos/alta.png'),
  'http://localhost:3002/uploads/store-logos/alta.png'
);
const htmlPreview = frontendSandbox.window.HealthLabels.renderPreview([{
  ...labels[0],
  company: { ...labels[0].company, logo_url: '/uploads/store-logos/alta.png' },
  traceability: { ...labels[0].traceability, origin: 'DISTRIMER' },
}], labels[0].zpl, []);
assert(htmlPreview.includes('src="http://localhost:3002/uploads/store-logos/alta.png"'), 'logo_url relatif doit etre resolu sur le backend');
assert(htmlPreview.includes('ZONE DE PECHE'), 'la zone de peche doit etre libellee dans le HTML');
assert(htmlPreview.includes('Atlantique Nord-Est - FAO 27'), 'FAO 27 doit garder le code et afficher son libelle');
assert(htmlPreview.includes('Sous-zone'), 'la sous-zone doit rester affichee');
assert(htmlPreview.includes('VIII'), 'la valeur de sous-zone doit rester affichee');
assert(htmlPreview.includes('DATE DE CONDITIONNEMENT'), 'la date de conditionnement doit etre affichee dans le HTML');
assert(htmlPreview.includes('19/08/2026'), 'la date de conditionnement doit venir de la date du BL');
assert(htmlPreview.includes('ALLERGENE'), 'le libelle allergene doit etre affiche si la donnee existe');
assert(htmlPreview.includes('CRUSTACÉS'), 'l allergene doit venir de la donnee Article/snapshot et etre mis en evidence');
assert(!htmlPreview.includes('Origine'), 'Origine ne doit pas apparaitre dans le HTML');
assert(!htmlPreview.includes('DISTRIMER'), 'la provenance/fournisseur ne doit pas apparaitre dans le HTML');
assert(!htmlPreview.includes('0/+2'), 'aucune temperature inventee ne doit apparaitre dans le HTML');
assert(!htmlPreview.includes('Conservation'), 'aucune condition de conservation non structuree ne doit apparaitre dans le HTML');

const storageHtmlPreview = frontendSandbox.window.HealthLabels.renderPreview([storageLabels[0]], storageLabels[0].zpl, []);
assert(storageHtmlPreview.includes('CONSERVATION'), 'HTML doit afficher la plage structuree si disponible');
assert(storageHtmlPreview.includes('3 à 5 °C'), 'HTML doit afficher la plage structuree exacte');
assert(storageHtmlPreview.includes('Conserver entre 3 et 5 degres'), 'HTML doit afficher l instruction structuree');
assert(storageHtmlPreview.includes('150 x 70 mm'), 'preview doit annoncer le format visuel 150 x 70 mm');

const healthLabelsCssSource = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'css', 'pages', 'health-labels.css'), 'utf8');
assert(healthLabelsCssSource.includes('aspect-ratio: 150 / 70'), 'CSS preview doit respecter le ratio 150 x 70');
assert(healthLabelsCssSource.includes('position: relative'), 'CSS preview doit utiliser une carte reperee en mm');
assert(healthLabelsCssSource.includes('top: 20mm'), 'CSS preview doit placer la zone detachable au centre vertical du BAT');
assert(healthLabelsCssSource.includes('height: 30mm'), 'CSS preview doit donner 30 mm a la zone detachable issue du BAT');
assert(!healthLabelsCssSource.includes('border-top: 2px dashed'), 'CSS preview ne doit pas dessiner une fausse refente');
assert(healthLabelsCssSource.includes('height: 70mm'), 'CSS print doit fixer la hauteur etiquette');
assert(healthLabelsCssSource.includes('width: 150mm'), 'CSS print doit fixer la largeur etiquette');
assert(healthLabelsCssSource.includes('@page health-label'), 'CSS print doit utiliser une page etiquette dediee');
assert(healthLabelsCssSource.includes('size: 150mm 70mm'), 'CSS print doit fixer la page logique etiquette');
assert(healthLabelsCssSource.includes('.health-label-card:last-child'), 'CSS print doit supprimer le saut de page apres la derniere etiquette');
assert(healthLabelsCssSource.includes('margin: 0 !important'), 'CSS print doit supprimer les marges qui creent des pages blanches');
assert(healthLabelsCssSource.includes('padding: 0 !important'), 'CSS print doit supprimer les paddings de conteneur');

const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'deliveryNotes.js'), 'utf8');
const routeStart = routeSource.indexOf("router.get('/delivery-notes/:id/health-labels'");
const routeEnd = routeSource.indexOf("router.get('/delivery-notes/:id/communication-options'");
const healthLabelsRoute = routeSource.slice(routeStart, routeEnd);
assert(!/\bINSERT\b|\bUPDATE\b|\bDELETE\b/i.test(healthLabelsRoute), 'la route health-labels ne doit pas ecrire en base');

console.log('health label tests ok');
