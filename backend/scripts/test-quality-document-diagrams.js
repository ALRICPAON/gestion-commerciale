const assert = require('assert');

const {
  normalizeDiagramData,
  preparedFishDiagram,
  preparedFishMermaidSource,
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

const mermaid = normalizeDiagramData({
  editor_mode: 'mermaid',
  title: 'Fabrication',
  source: preparedFishMermaidSource(),
});
assert.strictEqual(mermaid.editor_mode, 'mermaid');
assert.ok(mermaid.source.includes("Création d'une non-conformité"), 'La source Mermaid conserve accents et apostrophes');
assert.ok(mermaid.rendered_svg.includes('<svg'), 'Le mode Mermaid doit stocker un SVG rendu');
assert.ok(renderDiagramSvg(mermaid).includes('quality-mermaid-svg'), 'Le rendu Mermaid doit retourner un SVG inline');

mustThrow('xss mermaid', () => normalizeDiagramData({
  editor_mode: 'mermaid',
  title: 'XSS',
  source: 'flowchart TD\n A[Ok] --> B[Bad]\n click A javascript:alert(1)',
  rendered_svg: '<svg></svg>',
}));

mustThrow('svg mermaid dangereux', () => normalizeDiagramData({
  editor_mode: 'mermaid',
  title: 'XSS SVG',
  source: 'flowchart TD\n A[Ok] --> B[Fin]',
  rendered_svg: '<svg><script>alert(1)</script></svg>',
}));

console.log('[quality diagrams:test] OK validation JSON, Mermaid et rendu SVG');
