const assert = require('assert');

const dispatch = require('../services/transportPreparationDispatchService');

const UUID = '2a6f002d-306d-47ce-b914-b69a64f1602e';

function preparation(overrides = {}) {
  return {
    source_id: UUID,
    client_name: 'POISSONNERIE DU PETIT CHANTILLY',
    reference: 'BL-2026-00114',
    order_reference: 'CMD-2026-00117',
    delivery_mode: dispatch.DOCK_PICKUP_MODE,
    supplier_blocks: [
      { supplier_name: 'SARL DISTRIMER', weight_kg: 22, package_count: 4 },
      { supplier_name: 'LECRI MAREE', weight_kg: 11, package_count: 1 },
    ],
    ...overrides,
  };
}

function group(overrides = {}) {
  return {
    carrier_id: 'carrier-1',
    carrier_name: 'FRIGO TRANSPORTS 44',
    email_to: 'exploitation@transport.test',
    date: '2026-09-17',
    supplier_arrivals: [],
    client_deliveries: [],
    preparations: [],
    dock_pickups: [],
    summary: { missing_information: [] },
    ...overrides,
  };
}

const arrival = {
  origin_label: 'COPROMER',
  site_code: 'FT44',
  supplier_name: 'LECRI MAREE',
  weight_kg: 22.8,
  package_count: 7,
  reference: 'ACHAT-INTERNE',
  client_name: 'Client final',
  source_id: UUID,
};
const arrivalLine = dispatch.formatSupplierArrivalEmailLine(arrival);
assert.strictEqual(arrivalLine, 'COPROMER -> FT44 | LECRI MAREE | 22,8 kg | 7 colis', 'Test A format arrivage');
assert(!arrivalLine.includes('A completer'), 'Test A sans valeur technique manquante');
assert(!arrivalLine.includes(UUID), 'Test A sans UUID');
assert(!arrivalLine.includes('ACHAT-INTERNE'), 'Test A sans reference achat');
assert(!arrivalLine.includes('Client final'), 'Test A sans client final');

const delivery = {
  document_type: 'DELIVERY_NOTE',
  client_name: 'E.LECLERC SODIVARDIERE',
  billed_client_name: 'ROYALE MAREE',
  client_code: '88',
  origin_label: 'FT44',
  reference: 'BL-2026-00113',
  weight_kg: 53.28,
  package_count: 7,
  delivery_mode: dispatch.DELIVERY_MODE,
};
const deliveryLine = dispatch.formatClientDeliveryEmailLine(delivery);
assert.strictEqual(deliveryLine, 'E.LECLERC SODIVARDIERE | BL-2026-00113 | 53,28 kg | 7 colis | LIVRAISON', 'Test B format livraison');
assert(!deliveryLine.startsWith('FT44'), 'Test B sans origine en debut');
assert(!deliveryLine.includes('A completer'), 'Test B sans valeur technique manquante');
assert(!deliveryLine.includes('| 88 |'), 'Test I sans code client court');
assert(deliveryLine.includes('E.LECLERC SODIVARDIERE') && !deliveryLine.includes('ROYALE MAREE'), 'Test J client livre plutot que client facture');

const preparationLines = dispatch.formatPreparationEmailLines(preparation());
assert.strictEqual(preparationLines.length, 2, 'Test D une ligne par fournisseur');
assert.strictEqual(preparationLines[0], 'POISSONNERIE DU PETIT CHANTILLY | SARL DISTRIMER | CMD-2026-00117 | 22 kg | 4 colis | PRISE A QUAI DELANCHY', 'Test C et D premiere preparation');
assert.strictEqual(preparationLines[1], 'POISSONNERIE DU PETIT CHANTILLY | LECRI MAREE | CMD-2026-00117 | 11 kg | 1 colis | PRISE A QUAI DELANCHY', 'Test D seconde preparation');
assert(preparationLines.every((line) => line.includes('CMD-2026-00117') && !line.includes('BL-2026-00114')), 'Test C reference commande source uniquement');
assert(preparationLines.every((line) => line.includes(dispatch.DOCK_PICKUP_MODE)), 'Test E prise a quai visible');

const preview = dispatch.buildEmailPreviewForCarrier(group({
  supplier_arrivals: [arrival],
  client_deliveries: [delivery],
  preparations: [preparation()],
}));
assert(preview.text.includes('ARRIVAGES FOURNISSEURS'), 'section arrivages presente');
assert(preview.text.includes('LIVRAISONS CLIENTS'), 'section livraisons presente');
assert(preview.text.includes('COMMANDES A PREPARER'), 'section preparations presente');
assert(preview.html.includes(`<strong>${dispatch.DOCK_PICKUP_MODE}</strong>`), 'Test E prise a quai en gras dans le HTML');
assert(!preview.text.includes('A completer') && !preview.html.includes('A completer'), 'aucune valeur technique manquante dans email');
assert(!preview.text.includes(UUID) && !preview.html.includes(UUID), 'Test H aucun UUID visible');
assert(!preview.text.includes('| 88 |') && !preview.html.includes('| 88 |'), 'Test I aucun code client court');

const emptyPreview = dispatch.buildEmailPreviewForCarrier(group());
for (const title of ['ARRIVAGES FOURNISSEURS', 'LIVRAISONS CLIENTS', 'COMMANDES A PREPARER']) {
  assert(!emptyPreview.text.includes(title) && !emptyPreview.html.includes(title), `Test F section vide absente: ${title}`);
}
assert(!emptyPreview.text.includes('bon de commande en pi') && !emptyPreview.html.includes('bon de commande en pi'), 'Test G zero piece jointe sans phrase');

assert.strictEqual(dispatch.attachmentSummary(1), '1 bon de commande en pi\u00e8ce jointe.', 'Test G singulier');
assert.strictEqual(dispatch.attachmentSummary(3), '3 bons de commande en pi\u00e8ces jointes.', 'Test G pluriel');
assert.strictEqual(dispatch.attachmentSummary(0), '', 'Test G zero');
const threeAttachments = dispatch.buildEmailPreviewForCarrier(group({
  preparations: [preparation(), preparation({ source_id: 'source-2' }), preparation({ source_id: 'source-3' })],
}));
assert(threeAttachments.text.includes('3 bons de commande en pi\u00e8ces jointes.'), 'Test G phrase plurielle dans texte');
assert(threeAttachments.html.includes('3 bons de commande en pi\u00e8ces jointes.'), 'Test G phrase plurielle dans HTML');

console.log('transport dispatch email format tests ok');
