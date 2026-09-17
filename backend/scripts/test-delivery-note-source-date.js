const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { resolveDeliveryNoteDocumentDate } = require('../services/deliveryNoteDateService');

assert.strictEqual(resolveDeliveryNoteDocumentDate(null, '2026-09-18'), '2026-09-18', 'commande future conservee sur le BL');
assert.strictEqual(resolveDeliveryNoteDocumentDate(null, '2026-09-17'), '2026-09-17', 'commande du jour conservee sur le BL');
assert.strictEqual(resolveDeliveryNoteDocumentDate('2026-09-19', '2026-09-18'), '2026-09-19', 'date explicite prioritaire');
assert.strictEqual(resolveDeliveryNoteDocumentDate('invalide', null), null, 'absence de date exploitable laisse le fallback SQL CURRENT_DATE');

const files = {
  standard: fs.readFileSync(path.join(__dirname, '..', 'routes', 'deliveryNotes.js'), 'utf8'),
  forced: fs.readFileSync(path.join(__dirname, '..', 'routes', 'deliveryNoteValidationForced.js'), 'utf8'),
  negoce: fs.readFileSync(path.join(__dirname, '..', 'routes', 'negoceFixes.js'), 'utf8'),
  agent: fs.readFileSync(path.join(__dirname, '..', 'services', 'agentCommercialToolsService.js'), 'utf8'),
};

for (const [flow, source] of Object.entries(files)) {
  assert(source.includes('resolveDeliveryNoteDocumentDate'), `${flow}: resoluteur de date partage requis`);
}
assert(files.standard.includes('documentDate: req.body?.document_date'), 'flux standard transmet la date explicite');
assert(files.forced.includes('documentDate: req.body?.document_date'), 'flux force transmet la date explicite');
assert(files.negoce.includes('documentDate: req.body?.document_date'), 'flux negoce transmet la date explicite');
assert(files.standard.includes('COALESCE($21::date, CURRENT_DATE)'), 'flux standard conserve CURRENT_DATE en dernier recours');
assert(files.forced.includes('COALESCE($21::date, CURRENT_DATE)'), 'flux force conserve CURRENT_DATE en dernier recours');
assert(files.negoce.includes('COALESCE($20::date, CURRENT_DATE)'), 'flux negoce conserve CURRENT_DATE en dernier recours');
assert(files.agent.includes('resolveDeliveryNoteDocumentDate(payload.document_date, order.document_date)'), 'outil agent respecte date explicite puis commande');

console.log('delivery note source date tests ok');
