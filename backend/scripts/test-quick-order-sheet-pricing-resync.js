const assert = require('assert');

const route = require('../routes/quickOrderSheets');

const planSync = route._planDailySheetProductSyncForTest;
const stableUid = route._stablePricingColumnUidForTest;

function line(articleId, pricingLineId, designation) {
  return {
    id: pricingLineId,
    article_id: articleId,
    designation_snapshot: designation,
  };
}

function product(articleId, pricingLineId, columnUid = `pricing-${pricingLineId}`) {
  return {
    id: `product-${columnUid}`,
    article_id: articleId,
    pricing_line_id: pricingLineId,
    column_uid: columnUid,
  };
}

const articleA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const articleB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const articleC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const articleD = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const articleX = 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx';

const firstPublication = [
  line(articleA, 'line-a-v1', 'Article A'),
  line(articleB, 'line-b-v1', 'Article B'),
  line(articleC, 'line-c-v1', 'Article C'),
];

const firstProducts = firstPublication.map((pricingLine) => product(pricingLine.article_id, pricingLine.id));
const initialEntries = {
  clientX: {
    'pricing-line-a-v1': { colis: '2', kg: '10' },
    'pricing-line-b-v1': { colis: '1', kg: '5' },
  },
};

const firstSync = planSync(firstProducts, initialEntries, firstPublication);
assert.strictEqual(firstSync.deletes.length, 3, 'les anciennes cles pricing_line_id sont remplacees par des cles article stables');
assert.strictEqual(firstSync.order_entries.clientX[stableUid(articleA)].colis, '2', 'A migre vers la cle article stable');
assert.strictEqual(firstSync.order_entries.clientX[stableUid(articleB)].kg, '5', 'B migre vers la cle article stable');

const secondPublication = [
  line(articleA, 'line-a-v2', 'Article A'),
  line(articleB, 'line-b-v2', 'Article B'),
  line(articleC, 'line-c-v2', 'Article C'),
  line(articleD, 'line-d-v1', 'Article D'),
];
const secondSync = planSync(firstProducts, firstSync.order_entries, secondPublication);
assert.strictEqual(secondSync.deletes.length, 3, 'les anciennes cles non stables sont nettoyees sans supprimer les saisies');
assert(secondSync.upserts.some((item) => item.column_uid === stableUid(articleD)), 'D doit etre ajoute sur une cle stable');
assert.strictEqual(secondSync.order_entries.clientX[stableUid(articleA)].colis, '2', 'A reste conserve apres ajout D');
assert.strictEqual(secondSync.order_entries.clientX[stableUid(articleB)].kg, '5', 'B reste conserve apres ajout D');

const existingAfterSecond = [
  product(articleA, 'line-a-v2', stableUid(articleA)),
  product(articleB, 'line-b-v2', stableUid(articleB)),
  product(articleC, 'line-c-v2', stableUid(articleC)),
  product(articleD, 'line-d-v1', stableUid(articleD)),
  {
    id: 'manual-x',
    article_id: articleX,
    pricing_line_id: null,
    column_uid: 'manual-x',
  },
];
const entriesWithManual = {
  ...secondSync.order_entries,
  clientY: {
    'manual-x': { colis: '3', kg: '4' },
  },
};
const thirdPublication = [
  line(articleA, 'line-a-v3', 'Article A'),
  line(articleD, 'line-d-v2', 'Article D'),
];
const thirdSync = planSync(existingAfterSecond, entriesWithManual, thirdPublication);
assert(thirdSync.preservedRetired.some((row) => row.article_id === articleB), 'B retire mais commande doit etre conserve');
assert(thirdSync.deletes.some((row) => row.article_id === articleC), 'C retire sans commande peut etre supprime');
assert(!thirdSync.deletes.some((row) => row.pricing_line_id === null), 'une ligne hors tarif ne doit jamais etre supprimee par la synchro');
assert.strictEqual(thirdSync.order_entries.clientX[stableUid(articleB)].colis, '1', 'la commande B reste intacte apres retrait de tarification');
assert.strictEqual(thirdSync.order_entries.clientY['manual-x'].kg, '4', 'la commande hors tarif reste intacte');

const fourthSync = planSync(existingAfterSecond.filter((row) => row.article_id !== articleC), thirdSync.order_entries, thirdPublication);
assert.strictEqual(fourthSync.entries_moved, false, 'seconde synchronisation identique idempotente');
assert.deepStrictEqual(fourthSync.order_entries, thirdSync.order_entries, 'les entrees restent identiques a la resynchronisation');

console.log('OK quick order sheet pricing resync regression');
