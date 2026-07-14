const assert = require('assert');

const {
  createDiagramTemplate,
  deleteDiagramTemplate,
  listDiagramTemplates,
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

const styledMermaidSource = `flowchart TD
    A([Début]) --> B[Réception d'un lot]
    B --> C{Lot conforme ?}
    C -- Oui --> D[Stockage]
    C -- Non --> NC1[Isolement]
    classDef control fill:#ffffff,stroke:#1f2937,stroke-width:2px,color:#111827,font-size:14px,font-weight:700,stroke-dasharray:5 5
    class B,C control
    linkStyle default stroke:#334155,stroke-width:2px
    style NC1 fill:#fef2f2,stroke:#b42318,stroke-width:2px`;

const styledMermaid = normalizeDiagramData({
  editor_mode: 'mermaid',
  title: 'Style Mermaid',
  source: styledMermaidSource,
});
assert.ok(styledMermaid.source.includes('classDef control'), 'classDef valide doit etre accepte');
assert.ok(styledMermaid.source.includes('class B,C control'), 'class valide doit etre accepte');
assert.ok(styledMermaid.source.includes('linkStyle default'), 'linkStyle valide doit etre accepte');
assert.ok(styledMermaid.source.includes("Réception d'un lot"), 'Accents et apostrophes doivent etre conserves');
assert.ok(styledMermaid.rendered_svg.includes('<svg'), 'Le Mermaid style doit conserver un rendu SVG');

mustThrow('xss mermaid', () => normalizeDiagramData({
  editor_mode: 'mermaid',
  title: 'XSS',
  source: 'flowchart TD\n A[Ok] --> B[Bad]\n click A javascript:alert(1)',
  rendered_svg: '<svg></svg>',
}));

mustThrow('javascript mermaid', () => normalizeDiagramData({
  editor_mode: 'mermaid',
  title: 'Javascript',
  source: 'flowchart TD\n A[Ok] --> B[javascript:alert(1)]',
  rendered_svg: '<svg></svg>',
}));

mustThrow('url externe mermaid', () => normalizeDiagramData({
  editor_mode: 'mermaid',
  title: 'URL',
  source: 'flowchart TD\n A[Ok] --> B[https://example.com]',
  rendered_svg: '<svg></svg>',
}));

mustThrow('css url mermaid', () => normalizeDiagramData({
  editor_mode: 'mermaid',
  title: 'CSS URL',
  source: 'flowchart TD\n A[Ok] --> B[Fin]\n classDef bad fill:url(http://example.com/a.png)',
  rendered_svg: '<svg></svg>',
}));

mustThrow('foreignObject mermaid', () => normalizeDiagramData({
  editor_mode: 'mermaid',
  title: 'ForeignObject',
  source: 'flowchart TD\n A[Ok] --> B[foreignObject]',
  rendered_svg: '<svg></svg>',
}));

mustThrow('svg mermaid dangereux', () => normalizeDiagramData({
  editor_mode: 'mermaid',
  title: 'XSS SVG',
  source: 'flowchart TD\n A[Ok] --> B[Fin]',
  rendered_svg: '<svg><script>alert(1)</script></svg>',
}));

(async () => {
  const customRows = [];
  const fakeDb = {
    async query(sql, params) {
      if (sql.includes('SELECT id, store_id, name')) return { rows: customRows };
      if (sql.includes('INSERT INTO quality_document_diagram_templates')) {
        const row = {
          id: 'custom-1',
          store_id: params[0],
          name: params[1],
          title: params[1],
          description: params[2],
          category: params[3],
          editor_mode: 'mermaid',
          source: params[4],
          is_system: false,
        };
        customRows.push(row);
        return { rows: [row] };
      }
      throw new Error(`Requete inattendue: ${sql}`);
    },
  };
  const created = await createDiagramTemplate(fakeDb, 'store-a', 'user-a', {
    name: 'Modele perso',
    category: 'HACCP',
    source: styledMermaidSource,
  });
  assert.strictEqual(created.store_id, 'store-a');
  assert.ok(created.source.includes('classDef control'), 'Le stockage du modele conserve les styles Mermaid');
  const library = await listDiagramTemplates(fakeDb, 'store-a');
  assert.ok(library.some((template) => template.is_system), 'La bibliotheque doit inclure les modeles systeme');
  assert.ok(library.some((template) => template.id === 'custom-1'), 'La bibliotheque doit inclure les modeles personnalises du magasin');
  await assert.rejects(
    () => deleteDiagramTemplate(fakeDb, 'store-a', 'system:recall', 'user-a'),
    /systeme ne sont pas supprimables/
  );

  console.log('[quality diagrams:test] OK validation JSON, Mermaid, modeles et rendu SVG');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
