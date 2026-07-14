const assert = require('assert');

const {
  MAX_COLUMNS,
  MAX_ROWS,
  normalizeTableData,
  productFamiliesTable,
  renderTableBlock,
  renderTableHtml,
  storageConditionsTable,
  tableTemplates,
} = require('../services/quality/qualityDocumentationTableService');

function mustThrow(label, fn, pattern) {
  assert.throws(fn, pattern, label);
}

const table = normalizeTableData({
  title: 'Controle reception',
  columns: [
    { id: 'point', label: 'Point controle' },
    { id: 'resultat', label: 'Resultat attendu' },
  ],
  rows: [
    { cells: { point: 'Temperature', resultat: '0 a +2 C' } },
    { cells: { point: "Origine et agrement sanitaire", resultat: "Conformes aux documents d'achat" } },
  ],
});

assert.strictEqual(table.columns.length, 2);
assert.strictEqual(table.rows.length, 2);
assert.strictEqual(table.rows[1].cells.resultat, "Conformes aux documents d'achat");

const html = renderTableHtml(table);
assert(html.includes('quality-data-table'));
assert(html.includes('Temperature'));
assert(!html.includes('<script'));

const block = renderTableBlock({ id: 'table-test', block_id: 'block-test', title: table.title, table_data: table });
assert(block.includes('data-table-id="table-test"'));
assert(block.includes('contenteditable="false"'));

mustThrow('refuse HTML in cells', () => normalizeTableData({
  columns: [{ id: 'a', label: 'A' }],
  rows: [{ cells: { a: '<strong>danger</strong>' } }],
}), /HTML/);

mustThrow('refuse script values', () => normalizeTableData({
  columns: [{ id: 'a', label: 'A' }],
  rows: [{ cells: { a: 'javascript:alert(1)' } }],
}), /non autorisee/);

mustThrow('refuse too many columns', () => normalizeTableData({
  columns: Array.from({ length: MAX_COLUMNS + 1 }, (_, index) => ({ id: `c${index}`, label: `C${index}` })),
  rows: [],
}), /colonnes/);

mustThrow('refuse too many rows', () => normalizeTableData({
  columns: [{ id: 'a', label: 'A' }],
  rows: Array.from({ length: MAX_ROWS + 1 }, (_, index) => ({ cells: { a: String(index) } })),
}), /lignes/);

assert.strictEqual(productFamiliesTable().title, 'Familles de produits');
assert.strictEqual(storageConditionsTable().title, 'Conditions de conservation');
assert(tableTemplates().product_families.table_data.rows.length >= 3);

console.log('quality document table tests ok');
