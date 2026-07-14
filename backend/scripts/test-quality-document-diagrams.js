const assert = require('assert');

const {
  normalizeDiagramData,
  preparedFishDiagram,
  renderDiagramSvg,
  templates,
} = require('../services/quality/qualityDocumentationDiagramService');

function mustThrow(label, fn) {
  let thrown = false;
  try {
    fn();
  } catch (err) {
    thrown = true;
    assert.strictEqual(err.status, 400, `${label} doit renvoyer une erreur 400`);
  }
  assert.ok(thrown, `${label} doit echouer`);
}

const simple = normalizeDiagramData(templates().simple_process);
assert.strictEqual(simple.nodes.length, 4);
assert.strictEqual(simple.edges.length, 3);
assert.ok(renderDiagramSvg(simple).includes('<svg'), 'Le rendu doit produire un SVG');

mustThrow('liaison vers noeud inexistant', () => normalizeDiagramData({
  version: 1,
  title: 'Invalide',
  nodes: [{ id: 'a', label: 'A', type: 'start' }],
  edges: [{ id: 'e1', from: 'a', to: 'b', label: '' }],
}));

mustThrow('identifiant duplique', () => normalizeDiagramData({
  version: 1,
  title: 'Invalide',
  nodes: [
    { id: 'a', label: 'A', type: 'start' },
    { id: 'a', label: 'B', type: 'process' },
  ],
  edges: [],
}));

const fish = normalizeDiagramData(preparedFishDiagram());
assert.ok(fish.nodes.length >= 20, 'Le diagramme T3-C18 doit inclure le flux principal et la branche NC');
assert.ok(fish.edges.some((edge) => edge.from === 'controle-final' && edge.to === 'anomalie'), 'La branche NC du controle final doit exister');
assert.ok(renderDiagramSvg(fish).includes('T3-C01'), 'Le rendu doit afficher les chapitres associes');

console.log('[quality diagrams:test] OK validation JSON et rendu SVG');
