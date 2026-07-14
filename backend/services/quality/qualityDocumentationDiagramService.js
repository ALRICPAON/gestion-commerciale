const crypto = require('crypto');

const { logQualityEvent } = require('./eventLogger');
const { recordSectionVersion } = require('./qualityDocumentationVersionService');
const { stripHtml } = require('./qualityDocumentationTemplateService');

const NODE_TYPES = Object.freeze({
  start: { label: 'Debut', shape: 'pill', fill: '#e8f7ef', stroke: '#15803d', icon: 'D' },
  end: { label: 'Fin', shape: 'pill', fill: '#eef2f7', stroke: '#475569', icon: 'F' },
  process: { label: 'Etape', shape: 'rect', fill: '#eff6ff', stroke: '#1d4ed8', icon: 'E' },
  decision: { label: 'Decision', shape: 'diamond', fill: '#fff7ed', stroke: '#c2410c', icon: '?' },
  control: { label: 'Controle', shape: 'rect', fill: '#fef2f2', stroke: '#b42318', icon: 'C' },
  storage: { label: 'Stockage', shape: 'cylinder', fill: '#ecfeff', stroke: '#0891b2', icon: 'S' },
  transport: { label: 'Transport', shape: 'rect', fill: '#f5f3ff', stroke: '#6d28d9', icon: 'T' },
  document: { label: 'Document', shape: 'document', fill: '#f8fafc', stroke: '#64748b', icon: 'Doc' },
  non_conformity: { label: 'Non-conformite', shape: 'octagon', fill: '#fef2f2', stroke: '#b42318', icon: 'NC' },
  external: { label: 'Tiers', shape: 'rect', fill: '#faf5ff', stroke: '#7e22ce', icon: 'X' },
  note: { label: 'Note', shape: 'note', fill: '#fefce8', stroke: '#a16207', icon: 'i' },
});

const MAX_NODES = 100;
const MAX_EDGES = 200;
const MAX_TITLE_LENGTH = 160;
const MAX_LABEL_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[char]));
}

function cleanText(value, maxLength, fallback = '') {
  const text = String(value ?? fallback).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  return text.slice(0, maxLength);
}

function slugId(value, fallback) {
  const text = cleanText(value, 80, fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return text || fallback;
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  throw err;
}

function normalizeNode(raw, index) {
  const id = slugId(raw.id || raw.label, `node-${index + 1}`);
  const type = NODE_TYPES[raw.type] ? raw.type : 'process';
  return {
    id,
    label: cleanText(raw.label, MAX_LABEL_LENGTH, `Etape ${index + 1}`),
    type,
    description: cleanText(raw.description, MAX_DESCRIPTION_LENGTH),
    chapter_code: cleanText(raw.chapter_code, 40),
    x: Number.isFinite(Number(raw.x)) ? Number(raw.x) : 0,
    y: Number.isFinite(Number(raw.y)) ? Number(raw.y) : index,
  };
}

function normalizeDiagramData(input = {}) {
  const nodesInput = Array.isArray(input.nodes) ? input.nodes : [];
  const edgesInput = Array.isArray(input.edges) ? input.edges : [];
  if (nodesInput.length > MAX_NODES) badRequest(`Diagramme limite a ${MAX_NODES} noeuds`);
  if (edgesInput.length > MAX_EDGES) badRequest(`Diagramme limite a ${MAX_EDGES} liaisons`);

  const nodes = nodesInput.map(normalizeNode);
  const ids = new Set();
  nodes.forEach((node) => {
    if (ids.has(node.id)) badRequest(`Identifiant de noeud duplique : ${node.id}`);
    ids.add(node.id);
  });
  if (nodes.length === 0) badRequest('Le diagramme doit contenir au moins une etape');

  const edges = edgesInput.map((raw, index) => {
    const from = slugId(raw.from, '');
    const to = slugId(raw.to, '');
    if (!ids.has(from) || !ids.has(to)) badRequest('Une liaison pointe vers une etape inexistante');
    if (from === to) badRequest('Une liaison ne peut pas pointer vers la meme etape');
    return {
      id: slugId(raw.id, `edge-${index + 1}`),
      from,
      to,
      label: cleanText(raw.label, MAX_LABEL_LENGTH),
    };
  });

  return {
    version: 1,
    title: cleanText(input.title, MAX_TITLE_LENGTH, 'Diagramme qualite'),
    orientation: input.orientation === 'horizontal' ? 'horizontal' : 'vertical',
    nodes,
    edges,
  };
}

function layoutDiagram(data) {
  const horizontal = data.orientation === 'horizontal';
  const nodeWidth = 190;
  const nodeHeight = 74;
  const gapX = 95;
  const gapY = 70;
  const nodes = data.nodes.map((node, index) => {
    const x = Number.isFinite(Number(node.x)) && node.x !== 0 ? Number(node.x) : (horizontal ? index : 0);
    const y = Number.isFinite(Number(node.y)) && node.y !== 0 ? Number(node.y) : (horizontal ? 0 : index);
    return {
      ...node,
      px: 40 + x * (nodeWidth + gapX),
      py: 52 + y * (nodeHeight + gapY),
      width: nodeWidth,
      height: nodeHeight,
    };
  });
  const maxX = Math.max(...nodes.map((node) => node.px + node.width), 360);
  const maxY = Math.max(...nodes.map((node) => node.py + node.height), 220);
  return { nodes, width: maxX + 40, height: maxY + 45 };
}

function wrapSvgText(text, maxChars = 24) {
  const words = cleanText(text, MAX_LABEL_LENGTH).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  });
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

function nodeShape(node, typeMeta) {
  const common = `fill="${typeMeta.fill}" stroke="${typeMeta.stroke}" stroke-width="2"`;
  if (typeMeta.shape === 'pill') return `<rect x="${node.px}" y="${node.py}" width="${node.width}" height="${node.height}" rx="36" ${common}></rect>`;
  if (typeMeta.shape === 'diamond') {
    const cx = node.px + node.width / 2;
    const cy = node.py + node.height / 2;
    return `<polygon points="${cx},${node.py} ${node.px + node.width},${cy} ${cx},${node.py + node.height} ${node.px},${cy}" ${common}></polygon>`;
  }
  if (typeMeta.shape === 'octagon') {
    const x = node.px; const y = node.py; const w = node.width; const h = node.height; const c = 18;
    return `<polygon points="${x + c},${y} ${x + w - c},${y} ${x + w},${y + c} ${x + w},${y + h - c} ${x + w - c},${y + h} ${x + c},${y + h} ${x},${y + h - c} ${x},${y + c}" ${common}></polygon>`;
  }
  if (typeMeta.shape === 'cylinder') {
    const x = node.px; const y = node.py; const w = node.width; const h = node.height;
    return `<path d="M${x} ${y + 12} C${x} ${y - 4}, ${x + w} ${y - 4}, ${x + w} ${y + 12} V${y + h - 12} C${x + w} ${y + h + 4}, ${x} ${y + h + 4}, ${x} ${y + h - 12} Z" ${common}></path><path d="M${x} ${y + 12} C${x} ${y + 28}, ${x + w} ${y + 28}, ${x + w} ${y + 12}" fill="none" stroke="${typeMeta.stroke}" stroke-width="2"></path>`;
  }
  if (typeMeta.shape === 'document') {
    const x = node.px; const y = node.py; const w = node.width; const h = node.height;
    return `<path d="M${x} ${y} H${x + w - 20} L${x + w} ${y + 20} V${y + h} H${x} Z" ${common}></path><path d="M${x + w - 20} ${y} V${y + 20} H${x + w}" fill="none" stroke="${typeMeta.stroke}" stroke-width="2"></path>`;
  }
  if (typeMeta.shape === 'note') {
    const x = node.px; const y = node.py; const w = node.width; const h = node.height;
    return `<path d="M${x} ${y} H${x + w - 22} L${x + w} ${y + 22} V${y + h} H${x} Z" ${common}></path><path d="M${x + w - 22} ${y} V${y + 22} H${x + w}" fill="#fff7c2" stroke="${typeMeta.stroke}" stroke-width="2"></path>`;
  }
  return `<rect x="${node.px}" y="${node.py}" width="${node.width}" height="${node.height}" rx="10" ${common}></rect>`;
}

function renderDiagramSvg(data, options = {}) {
  const normalized = normalizeDiagramData(data);
  const layout = layoutDiagram(normalized);
  const nodeMap = new Map(layout.nodes.map((node) => [node.id, node]));
  const arrows = normalized.edges.map((edge) => {
    const from = nodeMap.get(edge.from);
    const to = nodeMap.get(edge.to);
    if (!from || !to) return '';
    const x1 = from.px + from.width / 2;
    const y1 = from.py + from.height / 2;
    const x2 = to.px + to.width / 2;
    const y2 = to.py + to.height / 2;
    const labelX = (x1 + x2) / 2;
    const labelY = (y1 + y2) / 2 - 8;
    return `<g class="quality-diagram-edge"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#quality-diagram-arrow)" stroke="#334155" stroke-width="2"></line>${edge.label ? `<text x="${labelX}" y="${labelY}" text-anchor="middle" class="edge-label">${escapeHtml(edge.label)}</text>` : ''}</g>`;
  }).join('');

  const nodes = layout.nodes.map((node) => {
    const meta = NODE_TYPES[node.type] || NODE_TYPES.process;
    const labelLines = wrapSvgText(node.label);
    const label = labelLines.map((line, index) => `<tspan x="${node.px + node.width / 2}" dy="${index === 0 ? 0 : 15}">${escapeHtml(line)}</tspan>`).join('');
    const chapter = node.chapter_code ? `<text x="${node.px + node.width / 2}" y="${node.py + node.height - 9}" text-anchor="middle" class="chapter-code">${escapeHtml(node.chapter_code)}</text>` : '';
    return `<g class="quality-diagram-node" data-node-id="${escapeHtml(node.id)}">
      ${nodeShape(node, meta)}
      <circle cx="${node.px + 18}" cy="${node.py + 18}" r="13" fill="#fff" stroke="${meta.stroke}" stroke-width="1.5"></circle>
      <text x="${node.px + 18}" y="${node.py + 22}" text-anchor="middle" class="node-icon">${escapeHtml(meta.icon)}</text>
      <text x="${node.px + node.width / 2}" y="${node.py + 31}" text-anchor="middle" class="node-label">${label}</text>
      ${chapter}
    </g>`;
  }).join('');

  return `<svg class="quality-diagram-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.width} ${layout.height}" role="img" aria-label="${escapeHtml(normalized.title)}">
    <defs><marker id="quality-diagram-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#334155"></path></marker></defs>
    <style>
      .quality-diagram-svg { background: #fff; border: 1px solid #cbd5e1; border-radius: 8px; width: 100%; height: auto; }
      .quality-diagram-edge .edge-label { fill: #334155; font: 600 12px Arial, sans-serif; paint-order: stroke; stroke: #fff; stroke-width: 4px; }
      .node-label { fill: #0f172a; font: 700 13px Arial, sans-serif; }
      .node-icon { fill: #0f172a; font: 700 10px Arial, sans-serif; }
      .chapter-code { fill: #475569; font: 700 10px Arial, sans-serif; }
    </style>
    <title>${escapeHtml(normalized.title)}</title>
    ${arrows}
    ${nodes}
  </svg>`;
}

function renderDiagramBlock(diagram) {
  const data = diagram.diagram_data || diagram;
  const svg = renderDiagramSvg(data);
  const title = cleanText(diagram.title || data.title, MAX_TITLE_LENGTH, 'Diagramme qualite');
  return `<figure class="quality-diagram-block" data-diagram-id="${escapeHtml(diagram.id)}" data-block-id="${escapeHtml(diagram.block_id)}" contenteditable="false">
    <figcaption>${escapeHtml(title)}</figcaption>
    ${svg}
  </figure>`;
}

function replaceDiagramBlock(contentHtml, diagram) {
  const block = renderDiagramBlock(diagram);
  const id = String(diagram.id);
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`<figure[^>]+data-diagram-id=["']${escapedId}["'][\\s\\S]*?<\\/figure>`, 'i');
  if (pattern.test(contentHtml || '')) return String(contentHtml || '').replace(pattern, block);
  return `${contentHtml || ''}\n${block}`;
}

function templates() {
  const vertical = (title, labels, types = []) => ({
    version: 1,
    title,
    orientation: 'vertical',
    nodes: labels.map((label, index) => ({
      id: slugId(label, `node-${index + 1}`),
      label,
      type: types[index] || (index === 0 ? 'start' : index === labels.length - 1 ? 'end' : 'process'),
      description: '',
      chapter_code: '',
      x: 0,
      y: index,
    })),
    edges: labels.slice(1).map((label, index) => ({
      id: `edge-${index + 1}`,
      from: slugId(labels[index], `node-${index + 1}`),
      to: slugId(label, `node-${index + 2}`),
      label: '',
    })),
  });

  return {
    blank: vertical('Nouveau diagramme qualite', ['Debut', 'Etape', 'Fin'], ['start', 'process', 'end']),
    simple_process: vertical('Processus simple', ['Debut', 'Etape', 'Controle', 'Fin'], ['start', 'process', 'control', 'end']),
    seafood_fabrication: vertical('Fabrication produits de la peche', ['Reception', 'Controle a reception', 'Stockage refrigere', 'Preparation', 'Decoupe / Filetage / Parage', 'Conditionnement', 'Mise sous glace', 'Filmage', 'Etiquetage', 'Preparation des commandes', 'Chargement', 'Expedition'], ['start', 'control', 'storage', 'process', 'process', 'process', 'storage', 'process', 'document', 'process', 'transport', 'end']),
    non_conformity_decision: {
      version: 1,
      title: 'Decision / non-conformite',
      orientation: 'vertical',
      nodes: [
        { id: 'controle', label: 'Controle', type: 'control', x: 0, y: 0 },
        { id: 'conforme', label: 'Produit conforme ?', type: 'decision', x: 0, y: 1 },
        { id: 'poursuite', label: 'Poursuite du processus', type: 'process', x: -1, y: 2 },
        { id: 'isolement', label: 'Isolement', type: 'non_conformity', x: 1, y: 2 },
        { id: 'decision', label: 'Decision', type: 'decision', x: 1, y: 3 },
      ],
      edges: [
        { id: 'e1', from: 'controle', to: 'conforme', label: '' },
        { id: 'e2', from: 'conforme', to: 'poursuite', label: 'Oui' },
        { id: 'e3', from: 'conforme', to: 'isolement', label: 'Non' },
        { id: 'e4', from: 'isolement', to: 'decision', label: '' },
      ],
    },
    recall: vertical('Retrait / rappel', ['Alerte', 'Identification du lot', 'Blocage du stock', 'Identification des clients', 'Information autorites et clients', 'Retrait ou rappel', 'Bilan et action corrective'], ['start', 'process', 'storage', 'process', 'document', 'transport', 'end']),
  };
}

function preparedFishDiagram() {
  const steps = [
    ['reception-poissons', 'Reception des poissons', 'start', 'T3-C01'],
    ['controle-reception', 'Controle a reception', 'control', 'T3-C03'],
    ['stockage-froid', 'Stockage en chambre froide ou preparation immediate', 'storage', 'T3-C04'],
    ['decoupe', 'Decoupe', 'process', 'T3-C05'],
    ['filetage', 'Filetage', 'process', 'T3-C06'],
    ['parage', 'Parage', 'process', 'T3-C07'],
    ['pelage', 'Pelage si necessaire', 'process', 'T3-C08'],
    ['conditionnement', 'Conditionnement', 'process', 'T3-C09'],
    ['glace', 'Mise sous glace', 'storage', 'T3-C10'],
    ['filmage', 'Filmage', 'process', 'T3-C11'],
    ['etiquetage', 'Etiquetage', 'document', 'T3-C12'],
    ['preparation-commande', 'Preparation de la commande', 'process', 'T3-C14'],
    ['controle-final', 'Controle final', 'control', ''],
    ['chargement', 'Chargement en vehicule frigorifique', 'transport', 'T3-C15'],
    ['expedition', 'Expedition', 'end', 'T3-C16'],
  ];
  const nc = [
    ['anomalie', 'Anomalie detectee', 'decision'],
    ['isolement-lot', 'Isolement du lot', 'non_conformity'],
    ['enregistrement-nc', 'Enregistrement de la non-conformite dans ALTA', 'document'],
    ['photos-fournisseur', 'Photographies et information du fournisseur', 'document'],
    ['decision-nc', 'Decision : retour, avoir, destruction ou declassement', 'decision'],
  ];
  return {
    version: 1,
    title: 'Diagramme de fabrication - Produits de la peche prepares',
    orientation: 'vertical',
    nodes: [
      ...steps.map(([id, label, type, chapter_code], index) => ({ id, label, type, chapter_code, description: '', x: 0, y: index })),
      ...nc.map(([id, label, type], index) => ({ id, label, type, chapter_code: '', description: '', x: 2, y: 1 + index })),
    ],
    edges: [
      ...steps.slice(1).map(([id], index) => ({ id: `main-${index + 1}`, from: steps[index][0], to: id, label: '' })),
      { id: 'nc-reception', from: 'controle-reception', to: 'anomalie', label: 'Anomalie' },
      { id: 'nc-preparation', from: 'preparation-commande', to: 'anomalie', label: 'Anomalie' },
      { id: 'nc-final', from: 'controle-final', to: 'anomalie', label: 'Anomalie' },
      ...nc.slice(1).map(([id], index) => ({ id: `nc-${index + 1}`, from: nc[index][0], to: id, label: '' })),
    ],
  };
}

async function getSection(db, storeId, sectionId) {
  const result = await db.query('SELECT * FROM quality_documentation_sections WHERE id = $1 AND store_id = $2 LIMIT 1', [sectionId, storeId]);
  return result.rows[0] || null;
}

async function listDiagrams(db, storeId, sectionId) {
  const result = await db.query(
    `SELECT * FROM quality_document_diagrams
     WHERE store_id = $1 AND section_id = $2 AND archived_at IS NULL
     ORDER BY created_at ASC`,
    [storeId, sectionId]
  );
  return result.rows;
}

async function createDiagram(db, storeId, sectionId, userId, body = {}) {
  const section = await getSection(db, storeId, sectionId);
  if (!section) return null;
  const data = normalizeDiagramData(body.diagram_data || templates()[body.template_key] || templates().blank);
  const blockId = body.block_id || `diagram-${crypto.randomUUID()}`;
  const result = await db.query(
    `INSERT INTO quality_document_diagrams
     (store_id, collection_id, section_id, block_id, title, diagram_type, orientation, schema_version, diagram_data, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8::jsonb,$9,$9)
     RETURNING *`,
    [storeId, section.collection_id, sectionId, blockId, data.title, body.diagram_type || 'process', data.orientation, JSON.stringify(data), userId]
  );
  const diagram = result.rows[0];
  const updatedHtml = replaceDiagramBlock(section.content_html, diagram);
  const updated = await db.query(
    `UPDATE quality_documentation_sections
     SET content_html = $3, content_text = $4, updated_by = $5, updated_at = now()
     WHERE id = $1 AND store_id = $2
     RETURNING *`,
    [sectionId, storeId, updatedHtml, stripHtml(updatedHtml), userId]
  );
  await recordSectionVersion(db, storeId, updated.rows[0], userId, `Insertion du diagramme ${data.title}`, 'diagram_create', section);
  await logQualityEvent({ dbPool: db, storeId, actorId: userId, eventType: 'quality.documentation.diagram.created', targetType: 'quality_document_diagram', targetId: diagram.id, after: diagram });
  return { ...diagram, block_html: renderDiagramBlock(diagram) };
}

async function updateDiagram(db, storeId, diagramId, userId, body = {}) {
  const beforeResult = await db.query('SELECT * FROM quality_document_diagrams WHERE id = $1 AND store_id = $2 AND archived_at IS NULL LIMIT 1', [diagramId, storeId]);
  const before = beforeResult.rows[0];
  if (!before) return null;
  const section = await getSection(db, storeId, before.section_id);
  if (!section) return null;
  const data = normalizeDiagramData(body.diagram_data || before.diagram_data);
  const updatedResult = await db.query(
    `UPDATE quality_document_diagrams
     SET title = $3, diagram_type = $4, orientation = $5, diagram_data = $6::jsonb, updated_by = $7, updated_at = now()
     WHERE id = $1 AND store_id = $2
     RETURNING *`,
    [diagramId, storeId, data.title, body.diagram_type || before.diagram_type || 'process', data.orientation, JSON.stringify(data), userId]
  );
  const diagram = updatedResult.rows[0];
  const updatedHtml = replaceDiagramBlock(section.content_html, diagram);
  const updatedSection = await db.query(
    `UPDATE quality_documentation_sections
     SET content_html = $3, content_text = $4, updated_by = $5, updated_at = now()
     WHERE id = $1 AND store_id = $2
     RETURNING *`,
    [section.id, storeId, updatedHtml, stripHtml(updatedHtml), userId]
  );
  await recordSectionVersion(db, storeId, updatedSection.rows[0], userId, `Modification du diagramme ${data.title}`, 'diagram_update', section);
  await logQualityEvent({ dbPool: db, storeId, actorId: userId, eventType: 'quality.documentation.diagram.updated', targetType: 'quality_document_diagram', targetId: diagram.id, before, after: diagram });
  return { ...diagram, block_html: renderDiagramBlock(diagram) };
}

async function archiveDiagram(db, storeId, diagramId, userId) {
  const beforeResult = await db.query('SELECT * FROM quality_document_diagrams WHERE id = $1 AND store_id = $2 AND archived_at IS NULL LIMIT 1', [diagramId, storeId]);
  const before = beforeResult.rows[0];
  if (!before) return null;
  const section = await getSection(db, storeId, before.section_id);
  const result = await db.query(
    `UPDATE quality_document_diagrams
     SET archived_at = COALESCE(archived_at, now()), updated_by = $3, updated_at = now()
     WHERE id = $1 AND store_id = $2
     RETURNING *`,
    [diagramId, storeId, userId]
  );
  if (section) {
    const escapedId = String(diagramId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const updatedHtml = String(section.content_html || '').replace(new RegExp(`<figure[^>]+data-diagram-id=["']${escapedId}["'][\\s\\S]*?<\\/figure>`, 'i'), '');
    const updatedSection = await db.query(
      `UPDATE quality_documentation_sections SET content_html = $3, content_text = $4, updated_by = $5, updated_at = now()
       WHERE id = $1 AND store_id = $2 RETURNING *`,
      [section.id, storeId, updatedHtml, stripHtml(updatedHtml), userId]
    );
    await recordSectionVersion(db, storeId, updatedSection.rows[0], userId, `Suppression du diagramme ${before.title}`, 'diagram_delete', section);
  }
  return result.rows[0];
}

async function ensureDefaultFabricationDiagram(db, storeId, userId) {
  const sectionResult = await db.query(
    `SELECT * FROM quality_documentation_sections
     WHERE store_id = $1 AND code = 'T3-C18' AND archived_at IS NULL
     LIMIT 1`,
    [storeId]
  );
  const section = sectionResult.rows[0];
  if (!section) return null;
  const existing = await db.query(
    `SELECT * FROM quality_document_diagrams
     WHERE store_id = $1 AND section_id = $2 AND archived_at IS NULL
       AND title = 'Diagramme de fabrication - Produits de la peche prepares'
     LIMIT 1`,
    [storeId, section.id]
  );
  if (existing.rows[0]) return existing.rows[0];
  return createDiagram(db, storeId, section.id, userId, { diagram_data: preparedFishDiagram(), diagram_type: 'fabrication' });
}

module.exports = {
  NODE_TYPES,
  archiveDiagram,
  createDiagram,
  ensureDefaultFabricationDiagram,
  listDiagrams,
  normalizeDiagramData,
  preparedFishDiagram,
  renderDiagramBlock,
  renderDiagramSvg,
  templates,
  updateDiagram,
};
