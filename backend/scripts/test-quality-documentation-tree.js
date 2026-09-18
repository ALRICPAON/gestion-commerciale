const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { buildSectionTree, sectionOrder } = require(path.join(__dirname, '..', '..', 'frontend', 'quality', 'js', 'documentation-tree'));

function section(id, code, displayOrder, extra = {}) {
  return {
    id,
    code,
    title: `Section ${code}`,
    display_order: displayOrder,
    parent_id: null,
    section_type: 'chapter',
    ...extra,
  };
}

function flatten(tree) {
  return tree.flatMap((node) => [node.section, ...flatten(node.children)]);
}

const block = { id: 'block-1', chapter_id: 'd131', block_type: 'document_table', content: { rows: [['A']] } };
const sections = [
  section('t2', 'T2', 20, { section_type: 'tome' }),
  section('d13', 'D1-3', 10),
  section('t10', 'T10', 20, { section_type: 'tome' }),
  section('d131', 'D1-3.1', 10, { parent_id: 'd13' }),
  section('d1311', 'D1-3.1.1', 10, { parent_id: 'd131', blocks: [block], structured_object: { kind: 'diagram', id: 'diagram-1' } }),
  section('d12', 'D1-2', 10),
  section('t1', 'T1', 20, { section_type: 'tome' }),
  section('d11', 'D1-1', 10),
  section('archived', 'D1-0', 0, { archived_at: '2026-09-18T00:00:00.000Z' }),
];
const originalSections = JSON.stringify(sections);
const originalBlock = JSON.stringify(block);

const tree = buildSectionTree(sections);
const rootCodes = tree.map((node) => node.section.code);
assert.deepStrictEqual(rootCodes, ['D1-1', 'D1-2', 'D1-3', 'T1', 'T2', 'T10'], 'les racines sont triees par ordre puis code naturel');
assert(tree.some((node) => node.section.code === 'D1-1' && node.section.section_type === 'chapter'), 'une racine chapter doit etre visible');
assert(tree.some((node) => node.section.code === 'T1' && node.section.section_type === 'tome'), 'une racine tome doit rester visible');
assert.deepStrictEqual(
  tree.find((node) => node.section.code === 'D1-3').children[0].children.map((node) => node.section.code),
  ['D1-3.1.1'],
  'le troisieme niveau doit etre visible'
);
assert.deepStrictEqual(
  flatten(tree).filter((item) => item.section_type === 'tome').map((item) => item.code),
  ['T1', 'T2', 'T10'],
  'aucun tome existant ne doit etre perdu'
);
assert.strictEqual(JSON.stringify(sections), originalSections, 'la construction de l arbre ne modifie pas les sections');
assert.strictEqual(JSON.stringify(block), originalBlock, 'la construction de l arbre ne modifie pas les blocs ou objets');

const filtered = buildSectionTree(sections, (item) => item.code === 'D1-3.1.1');
assert.deepStrictEqual(flatten(filtered).map((item) => item.code), ['D1-3', 'D1-3.1', 'D1-3.1.1'], 'la recherche conserve tous les ancetres du resultat');
assert(sectionOrder(section('a', 'T2', 1), section('b', 'T10', 1)) < 0, 'le tri des codes doit etre naturel');

const page = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'quality', 'pages', 'documentation.html'), 'utf8');
const frontend = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'quality', 'js', 'documentation.js'), 'utf8');
assert(page.indexOf('documentation-tree.js') < page.indexOf('documentation.js'), 'le constructeur d arbre doit etre charge avant l ecran');
assert(frontend.includes('QualityDocumentationTree.buildSectionTree'), 'l ecran doit utiliser l arbre recursif partage');
assert(!frontend.includes("section.section_type === 'tome' && !section.archived_at"), 'les racines ne doivent plus etre limitees aux tomes');

console.log('quality documentation tree tests ok');
