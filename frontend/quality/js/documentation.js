(function () {
  const API_BASE_URL = window.APP_CONFIG?.API_BASE_URL || '';
  const sessionUser = JSON.parse(localStorage.getItem('gc_user') || localStorage.getItem('grv2_user') || 'null');
  const authToken = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
  if (!sessionUser || !authToken) {
    window.location.href = '../../login.html';
    return;
  }

  const canRead = window.hasQualityPermission?.(sessionUser, 'quality.document.read') || window.hasQualityPermission?.(sessionUser, 'quality.read');
  const canEdit = window.hasQualityPermission?.(sessionUser, 'quality.document.edit') || window.hasQualityPermission?.(sessionUser, 'quality.document.manage');
  const canExport = window.hasQualityPermission?.(sessionUser, 'quality.document.export') || window.hasQualityPermission?.(sessionUser, 'quality.inspection.export');
  if (!canRead) {
    window.location.href = '../../home.html';
    return;
  }

  const $ = (id) => document.getElementById(id);
  const els = {
    title: $('documentation-title'),
    feedback: $('documentation-feedback'),
    tree: $('section-tree'),
    search: $('doc-search'),
    add: $('add-section-btn'),
    code: $('section-code'),
    heading: $('section-title-heading'),
    statusBadge: $('section-status-badge'),
    titleInput: $('section-title'),
    editor: $('section-editor'),
    status: $('section-status'),
    version: $('section-version'),
    parent: $('section-parent'),
    order: $('section-order'),
    revision: $('section-revision'),
    includeExport: $('section-include-export'),
    references: $('section-references'),
    comment: $('section-comment'),
    moveUp: $('move-up-btn'),
    moveDown: $('move-down-btn'),
    deleteSection: $('delete-section-btn'),
    mergeTarget: $('merge-target'),
    mergeSection: $('merge-section-btn'),
    save: $('save-section-btn'),
    saveNext: $('save-next-btn'),
    review: $('review-section-btn'),
    validate: $('validate-section-btn'),
    markMissing: $('mark-missing-btn'),
    insertDiagram: $('insert-diagram-btn'),
    textColor: $('text-color-select'),
    preview: $('preview-pdf-btn'),
    exportPdf: $('export-pdf-btn'),
    missing: $('missing-list'),
    attachmentForm: $('attachment-form'),
    attachmentFile: $('attachment-file'),
    attachmentInclude: $('attachment-include'),
    attachments: $('attachment-list'),
    diagramModal: $('diagram-modal'),
    diagramClose: $('diagram-close-btn'),
    diagramCancel: $('diagram-cancel-btn'),
    diagramSave: $('diagram-save-btn'),
    diagramDelete: $('diagram-delete-btn'),
    diagramTitle: $('diagram-title'),
    diagramTemplate: $('diagram-template'),
    diagramOrientation: $('diagram-orientation'),
    diagramAddStep: $('diagram-add-step-btn'),
    diagramAddDecision: $('diagram-add-decision-btn'),
    diagramAutoLayout: $('diagram-auto-layout-btn'),
    diagramUndo: $('diagram-undo-btn'),
    diagramRedo: $('diagram-redo-btn'),
    diagramFit: $('diagram-fit-btn'),
    diagramZoom: $('diagram-zoom'),
    diagramPreview: $('diagram-preview'),
    diagramNodeList: $('diagram-node-list'),
    diagramEdgeList: $('diagram-edge-list'),
    diagramAddEdge: $('diagram-add-edge-btn'),
  };

  const DIAGRAM_NODE_TYPES = [
    ['start', 'Debut'],
    ['end', 'Fin'],
    ['process', 'Etape'],
    ['decision', 'Decision'],
    ['control', 'Controle qualite'],
    ['storage', 'Stockage'],
    ['transport', 'Transport / expedition'],
    ['document', 'Document'],
    ['non_conformity', 'Non-conformite'],
    ['external', 'Tiers'],
    ['note', 'Note'],
  ];

  const DIAGRAM_TYPE_STYLES = {
    start: { fill: '#e8f7ef', stroke: '#15803d', icon: 'D', shape: 'pill' },
    end: { fill: '#eef2f7', stroke: '#475569', icon: 'F', shape: 'pill' },
    process: { fill: '#eff6ff', stroke: '#1d4ed8', icon: 'E', shape: 'rect' },
    decision: { fill: '#fff7ed', stroke: '#c2410c', icon: '?', shape: 'diamond' },
    control: { fill: '#fef2f2', stroke: '#b42318', icon: 'C', shape: 'rect' },
    storage: { fill: '#ecfeff', stroke: '#0891b2', icon: 'S', shape: 'cylinder' },
    transport: { fill: '#f5f3ff', stroke: '#6d28d9', icon: 'T', shape: 'rect' },
    document: { fill: '#f8fafc', stroke: '#64748b', icon: 'Doc', shape: 'document' },
    non_conformity: { fill: '#fef2f2', stroke: '#b42318', icon: 'NC', shape: 'octagon' },
    external: { fill: '#faf5ff', stroke: '#7e22ce', icon: 'X', shape: 'rect' },
    note: { fill: '#fefce8', stroke: '#a16207', icon: 'i', shape: 'note' },
  };

  let state = { collection: null, sections: [], missing: [], attachments: [], diagrams: [], currentId: null, dirty: false, filter: 'all' };
  let diagramState = { id: null, data: null, history: [], future: [], zoom: 100 };

  function setFeedback(message = '', type = '') {
    els.feedback.textContent = message;
    els.feedback.className = message ? `page-feedback ${type}`.trim() : 'page-feedback hidden';
  }

  function headers(extra = {}) {
    return { Authorization: `Bearer ${authToken}`, ...extra };
  }

  async function request(path, options = {}) {
    const response = await fetch(`${API_BASE_URL}/api/quality/documentation${path}`, {
      ...options,
      headers: headers(options.headers || {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Erreur documentation qualite');
    return data;
  }

  async function requestPdf(path, options = {}) {
    const response = await fetch(`${API_BASE_URL}/api/quality/documentation${path}`, {
      ...options,
      headers: headers({ 'Content-Type': 'application/json', ...(options.headers || {}) }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Erreur export PDF');
    }
    return response.blob();
  }

  function currentSection() {
    return state.sections.find((section) => section.id === state.currentId) || null;
  }

  function childrenOf(parentId) {
    return state.sections.filter((section) => section.parent_id === parentId && !section.archived_at);
  }

  function activeSections() {
    return state.sections.filter((section) => !section.archived_at);
  }

  function descendantsOf(sectionId) {
    const descendants = new Set();
    const visit = (parentId) => {
      childrenOf(parentId).forEach((child) => {
        descendants.add(child.id);
        visit(child.id);
      });
    };
    visit(sectionId);
    return descendants;
  }

  function sectionLabel(section) {
    return `${section.code} - ${section.title}`;
  }

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    }[char]));
  }

  function slugId(value, fallback = 'node') {
    return String(value || fallback)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || fallback;
  }

  function cloneDiagram(data) {
    return JSON.parse(JSON.stringify(data));
  }

  function templateData(key = 'blank') {
    const vertical = (title, labels, types = []) => ({
      version: 1,
      title,
      orientation: 'vertical',
      nodes: labels.map((label, index) => ({ id: slugId(label, `node-${index + 1}`), label, type: types[index] || 'process', description: '', chapter_code: '', x: 0, y: index })),
      edges: labels.slice(1).map((label, index) => ({ id: `edge-${index + 1}`, from: slugId(labels[index], `node-${index + 1}`), to: slugId(label, `node-${index + 2}`), label: '' })),
    });
    const templates = {
      blank: vertical('Nouveau diagramme qualite', ['Debut', 'Etape', 'Fin'], ['start', 'process', 'end']),
      simple_process: vertical('Processus simple', ['Debut', 'Etape', 'Controle', 'Fin'], ['start', 'process', 'control', 'end']),
      seafood_fabrication: vertical('Fabrication produits de la peche', ['Reception', 'Controle a reception', 'Stockage refrigere', 'Preparation', 'Decoupe / Filetage / Parage', 'Conditionnement', 'Mise sous glace', 'Filmage', 'Etiquetage', 'Preparation des commandes', 'Chargement', 'Expedition'], ['start', 'control', 'storage', 'process', 'process', 'process', 'storage', 'process', 'document', 'process', 'transport', 'end']),
      non_conformity_decision: {
        version: 1,
        title: 'Decision / non-conformite',
        orientation: 'vertical',
        nodes: [
          { id: 'controle', label: 'Controle', type: 'control', description: '', chapter_code: '', x: 0, y: 0 },
          { id: 'conforme', label: 'Produit conforme ?', type: 'decision', description: '', chapter_code: '', x: 0, y: 1 },
          { id: 'poursuite', label: 'Poursuite du processus', type: 'process', description: '', chapter_code: '', x: -1, y: 2 },
          { id: 'isolement', label: 'Isolement', type: 'non_conformity', description: '', chapter_code: '', x: 1, y: 2 },
          { id: 'decision', label: 'Decision', type: 'decision', description: '', chapter_code: '', x: 1, y: 3 },
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
    return cloneDiagram(templates[key] || templates.blank);
  }

  function diagramLayout(data) {
    const horizontal = data.orientation === 'horizontal';
    const nodeWidth = 190;
    const nodeHeight = 74;
    const gapX = 95;
    const gapY = 70;
    const nodes = (data.nodes || []).map((node, index) => {
      const x = Number.isFinite(Number(node.x)) && Number(node.x) !== 0 ? Number(node.x) : (horizontal ? index : 0);
      const y = Number.isFinite(Number(node.y)) && Number(node.y) !== 0 ? Number(node.y) : (horizontal ? 0 : index);
      return { ...node, px: 40 + x * (nodeWidth + gapX), py: 52 + y * (nodeHeight + gapY), width: nodeWidth, height: nodeHeight };
    });
    return {
      nodes,
      width: Math.max(...nodes.map((node) => node.px + node.width), 360) + 40,
      height: Math.max(...nodes.map((node) => node.py + node.height), 220) + 45,
    };
  }

  function wrapSvgText(text, maxChars = 24) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
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

  function renderNodeShape(node, meta) {
    const common = `fill="${meta.fill}" stroke="${meta.stroke}" stroke-width="2"`;
    if (meta.shape === 'pill') return `<rect x="${node.px}" y="${node.py}" width="${node.width}" height="${node.height}" rx="36" ${common}></rect>`;
    if (meta.shape === 'diamond') {
      const cx = node.px + node.width / 2;
      const cy = node.py + node.height / 2;
      return `<polygon points="${cx},${node.py} ${node.px + node.width},${cy} ${cx},${node.py + node.height} ${node.px},${cy}" ${common}></polygon>`;
    }
    if (meta.shape === 'octagon') {
      const x = node.px; const y = node.py; const w = node.width; const h = node.height; const c = 18;
      return `<polygon points="${x + c},${y} ${x + w - c},${y} ${x + w},${y + c} ${x + w},${y + h - c} ${x + w - c},${y + h} ${x + c},${y + h} ${x},${y + h - c} ${x},${y + c}" ${common}></polygon>`;
    }
    if (meta.shape === 'cylinder') {
      const x = node.px; const y = node.py; const w = node.width; const h = node.height;
      return `<path d="M${x} ${y + 12} C${x} ${y - 4}, ${x + w} ${y - 4}, ${x + w} ${y + 12} V${y + h - 12} C${x + w} ${y + h + 4}, ${x} ${y + h + 4}, ${x} ${y + h - 12} Z" ${common}></path><path d="M${x} ${y + 12} C${x} ${y + 28}, ${x + w} ${y + 28}, ${x + w} ${y + 12}" fill="none" stroke="${meta.stroke}" stroke-width="2"></path>`;
    }
    if (meta.shape === 'document') {
      const x = node.px; const y = node.py; const w = node.width; const h = node.height;
      return `<path d="M${x} ${y} H${x + w - 20} L${x + w} ${y + 20} V${y + h} H${x} Z" ${common}></path><path d="M${x + w - 20} ${y} V${y + 20} H${x + w}" fill="none" stroke="${meta.stroke}" stroke-width="2"></path>`;
    }
    if (meta.shape === 'note') {
      const x = node.px; const y = node.py; const w = node.width; const h = node.height;
      return `<path d="M${x} ${y} H${x + w - 22} L${x + w} ${y + 22} V${y + h} H${x} Z" ${common}></path><path d="M${x + w - 22} ${y} V${y + 22} H${x + w}" fill="#fff7c2" stroke="${meta.stroke}" stroke-width="2"></path>`;
    }
    return `<rect x="${node.px}" y="${node.py}" width="${node.width}" height="${node.height}" rx="10" ${common}></rect>`;
  }

  function renderDiagramSvg(data) {
    const layout = diagramLayout(data);
    const nodeMap = new Map(layout.nodes.map((node) => [node.id, node]));
    const edges = (data.edges || []).map((edge) => {
      const from = nodeMap.get(edge.from);
      const to = nodeMap.get(edge.to);
      if (!from || !to) return '';
      const x1 = from.px + from.width / 2;
      const y1 = from.py + from.height / 2;
      const x2 = to.px + to.width / 2;
      const y2 = to.py + to.height / 2;
      return `<g><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#arrow)" stroke="#334155" stroke-width="2"></line>${edge.label ? `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 8}" text-anchor="middle" class="edge-label">${escapeHtml(edge.label)}</text>` : ''}</g>`;
    }).join('');
    const nodes = layout.nodes.map((node) => {
      const meta = DIAGRAM_TYPE_STYLES[node.type] || DIAGRAM_TYPE_STYLES.process;
      const label = wrapSvgText(node.label).map((line, index) => `<tspan x="${node.px + node.width / 2}" dy="${index === 0 ? 0 : 15}">${escapeHtml(line)}</tspan>`).join('');
      return `<g class="diagram-node" data-node-id="${escapeHtml(node.id)}">
        ${renderNodeShape(node, meta)}
        <circle cx="${node.px + 18}" cy="${node.py + 18}" r="13" fill="#fff" stroke="${meta.stroke}" stroke-width="1.5"></circle>
        <text x="${node.px + 18}" y="${node.py + 22}" text-anchor="middle" class="node-icon">${escapeHtml(meta.icon)}</text>
        <text x="${node.px + node.width / 2}" y="${node.py + 31}" text-anchor="middle" class="node-label">${label}</text>
        ${node.chapter_code ? `<text x="${node.px + node.width / 2}" y="${node.py + node.height - 9}" text-anchor="middle" class="chapter-code">${escapeHtml(node.chapter_code)}</text>` : ''}
      </g>`;
    }).join('');
    return `<svg class="quality-diagram-svg" viewBox="0 0 ${layout.width} ${layout.height}" style="width:${diagramState.zoom}%">
      <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#334155"></path></marker></defs>
      <style>.edge-label{fill:#334155;font:600 12px Arial;paint-order:stroke;stroke:#fff;stroke-width:4px}.node-label{fill:#0f172a;font:700 13px Arial}.node-icon{fill:#0f172a;font:700 10px Arial}.chapter-code{fill:#475569;font:700 10px Arial}</style>
      ${edges}${nodes}
    </svg>`;
  }

  function renderMetrics(dashboard = {}) {
    $('metric-tomes').textContent = dashboard.tome_count ?? '-';
    $('metric-chapters').textContent = dashboard.chapter_count ?? '-';
    $('metric-validated').textContent = dashboard.validated_count ?? '-';
    $('metric-missing').textContent = dashboard.to_complete_count ?? '-';
    $('metric-attachments').textContent = dashboard.attachment_count ?? '-';
    $('metric-completion').textContent = `${dashboard.completion_percent ?? 0} %`;
  }

  function renderTree() {
    const query = els.search.value.trim().toLowerCase();
    const visible = state.sections.filter((section) => {
      const text = `${section.code} ${section.title} ${section.content_text || ''} ${section.regulatory_references || ''}`.toLowerCase();
      return !section.archived_at && (!query || text.includes(query));
    });
    const visibleIds = new Set(visible.map((section) => section.id));
    const html = state.sections
      .filter((section) => section.section_type === 'tome' && !section.archived_at && (!query || visibleIds.has(section.id) || childrenOf(section.id).some((child) => visibleIds.has(child.id))))
      .map((tome) => {
        const chapters = childrenOf(tome.id).filter((chapter) => !query || visibleIds.has(chapter.id));
        return `<div class="quality-doc-tome">
          <button class="${state.currentId === tome.id ? 'active' : ''}" data-section-id="${tome.id}" type="button"><strong>${tome.code}</strong> ${tome.title}</button>
          ${chapters.map((chapter) => `<button class="chapter ${state.currentId === chapter.id ? 'active' : ''}" data-section-id="${chapter.id}" type="button"><span>${chapter.code}</span> ${chapter.title}</button>`).join('')}
        </div>`;
      }).join('');
    els.tree.innerHTML = html || '<div class="quality-empty-state">Aucun chapitre trouve.</div>';
  }

  function renderMissing() {
    const now = new Date().toISOString().slice(0, 10);
    let items = state.missing.filter((item) => item.status !== 'resolved');
    if (state.filter === 'blocking') items = items.filter((item) => item.severity === 'blocking');
    if (state.filter === 'before_submission') items = items.filter((item) => item.severity === 'before_submission');
    if (state.filter === 'overdue') items = items.filter((item) => item.due_at && item.due_at < now);
    els.missing.innerHTML = items.map((item) => `<article class="quality-doc-mini ${item.section_id === state.currentId ? 'active' : ''}">
      <strong>${item.section_code || ''} ${item.section_title || ''}</strong>
      <p>${item.description}</p>
      <small>${item.severity} ${item.due_at ? `- ${item.due_at}` : ''}</small>
      <div class="quality-actions"><button class="btn btn-secondary" data-open-section="${item.section_id}" type="button">Ouvrir</button><button class="btn btn-secondary" data-resolve-missing="${item.id}" type="button">Resoudre</button></div>
    </article>`).join('') || '<p class="quality-muted">Aucune information manquante ouverte.</p>';
  }

  function renderAttachments() {
    const attachments = state.attachments.filter((item) => item.section_id === state.currentId && !item.archived_at);
    els.attachments.innerHTML = attachments.map((item) => `<article class="quality-doc-mini">
      <strong>${item.filename}</strong>
      <small>${item.mime_type || ''}</small>
      <div class="quality-actions"><button class="btn btn-secondary" data-download-attachment="${item.id}" type="button">Telecharger</button><button class="btn btn-secondary" data-delete-attachment="${item.id}" type="button">Archiver</button></div>
    </article>`).join('') || '<p class="quality-muted">Aucune piece jointe.</p>';
  }

  function pushDiagramHistory() {
    if (!diagramState.data) return;
    diagramState.history.push(cloneDiagram(diagramState.data));
    if (diagramState.history.length > 30) diagramState.history.shift();
    diagramState.future = [];
  }

  function mutateDiagram(mutator) {
    pushDiagramHistory();
    mutator(diagramState.data);
    renderDiagramEditor();
  }

  function nodeTypeOptions(selected) {
    return DIAGRAM_NODE_TYPES.map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
  }

  function chapterOptions(selectedCode) {
    return ['<option value="">Aucun chapitre</option>', ...activeSections()
      .filter((section) => section.section_type !== 'tome')
      .map((section) => `<option value="${escapeHtml(section.code)}" ${section.code === selectedCode ? 'selected' : ''}>${escapeHtml(section.code)} - ${escapeHtml(section.title)}</option>`)]
      .join('');
  }

  function nodeOptions(selectedId) {
    return (diagramState.data?.nodes || [])
      .map((node) => `<option value="${escapeHtml(node.id)}" ${node.id === selectedId ? 'selected' : ''}>${escapeHtml(node.label)}</option>`)
      .join('');
  }

  function renderDiagramEditor() {
    const data = diagramState.data;
    if (!data) return;
    els.diagramTitle.value = data.title || '';
    els.diagramOrientation.value = data.orientation || 'vertical';
    els.diagramZoom.value = String(diagramState.zoom);
    els.diagramPreview.innerHTML = renderDiagramSvg(data);
    els.diagramNodeList.innerHTML = (data.nodes || []).map((node, index) => `<article class="quality-diagram-node-form" data-node-id="${escapeHtml(node.id)}">
      <div class="quality-diagram-form-row">
        <label>Libelle <input class="form-input" data-node-field="label" value="${escapeHtml(node.label)}"></label>
        <label>Type <select class="form-input" data-node-field="type">${nodeTypeOptions(node.type)}</select></label>
      </div>
      <label>Description <textarea class="form-input" data-node-field="description">${escapeHtml(node.description || '')}</textarea></label>
      <div class="quality-diagram-form-row">
        <label>Chapitre associe <select class="form-input" data-node-field="chapter_code">${chapterOptions(node.chapter_code)}</select></label>
        <label>Position <input class="form-input" data-node-field="position" value="${Number(node.x || 0)},${Number(node.y || index)}"></label>
      </div>
      <div class="quality-actions">
        <button class="btn btn-secondary" data-node-action="duplicate" type="button">Dupliquer</button>
        <button class="btn btn-secondary" data-node-action="delete" type="button">Supprimer</button>
      </div>
    </article>`).join('');
    els.diagramEdgeList.innerHTML = (data.edges || []).map((edge) => `<article class="quality-diagram-edge-form" data-edge-id="${escapeHtml(edge.id)}">
      <div class="quality-diagram-form-row">
        <label>De <select class="form-input" data-edge-field="from">${nodeOptions(edge.from)}</select></label>
        <label>Vers <select class="form-input" data-edge-field="to">${nodeOptions(edge.to)}</select></label>
      </div>
      <label>Libelle <input class="form-input" data-edge-field="label" value="${escapeHtml(edge.label || '')}"></label>
      <button class="btn btn-secondary" data-edge-action="delete" type="button">Supprimer la liaison</button>
    </article>`).join('');
  }

  function openDiagramModal(diagram = null) {
    const baseData = diagram?.diagram_data || templateData(els.diagramTemplate.value || 'blank');
    diagramState = {
      id: diagram?.id || null,
      data: cloneDiagram(baseData),
      history: [],
      future: [],
      zoom: 100,
    };
    els.diagramDelete.classList.toggle('hidden', !diagramState.id);
    els.diagramModal.classList.remove('hidden');
    renderDiagramEditor();
  }

  function closeDiagramModal() {
    els.diagramModal.classList.add('hidden');
  }

  function autoLayoutDiagram(data) {
    const horizontal = data.orientation === 'horizontal';
    (data.nodes || []).forEach((node, index) => {
      node.x = horizontal ? index : 0;
      node.y = horizontal ? 0 : index;
    });
  }

  async function saveDiagram() {
    const section = currentSection();
    if (!section || !diagramState.data) return;
    diagramState.data.title = els.diagramTitle.value || 'Diagramme qualite';
    diagramState.data.orientation = els.diagramOrientation.value || 'vertical';
    const path = diagramState.id ? `/diagrams/${diagramState.id}` : `/sections/${section.id}/diagrams`;
    const method = diagramState.id ? 'PUT' : 'POST';
    const saved = await request(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ diagram_data: diagramState.data }),
    });
    await load(section.id);
    closeDiagramModal();
    return saved;
  }

  function renderStructureControls(section) {
    const descendants = descendantsOf(section.id);
    const parentOptions = activeSections()
      .filter((item) => item.id !== section.id && !descendants.has(item.id))
      .map((item) => `<option value="${item.id}">${sectionLabel(item)}</option>`)
      .join('');
    els.parent.innerHTML = `<option value="">Aucun parent / Tome racine</option>${parentOptions}`;
    els.parent.value = section.parent_id || '';
    els.parent.disabled = !canEdit;

    const mergeOptions = activeSections()
      .filter((item) => item.id !== section.id && item.collection_id === section.collection_id)
      .map((item) => `<option value="${item.id}">${sectionLabel(item)}</option>`)
      .join('');
    els.mergeTarget.innerHTML = mergeOptions || '<option value="">Aucun chapitre cible</option>';
    els.mergeTarget.disabled = !canEdit || !mergeOptions;
    els.mergeSection.disabled = !canEdit || !mergeOptions;
  }

  function renderEditor() {
    const section = currentSection();
    const disabled = !section || !canEdit;
    [els.titleInput, els.editor, els.status, els.version, els.parent, els.order, els.revision, els.includeExport, els.references, els.comment, els.textColor, els.save, els.saveNext, els.review, els.validate, els.markMissing, els.insertDiagram, els.moveUp, els.moveDown, els.deleteSection].forEach((el) => {
      if (!el) return;
      if ('disabled' in el) el.disabled = disabled;
      if (el === els.editor) el.setAttribute('contenteditable', disabled ? 'false' : 'true');
    });
    document.querySelectorAll('[data-text-color]').forEach((button) => { button.disabled = disabled; });
    if (!section) return;
    els.code.textContent = section.code;
    els.heading.textContent = section.title;
    els.statusBadge.textContent = section.status;
    els.titleInput.value = section.title || '';
    els.editor.innerHTML = section.content_html || '';
    els.status.value = section.status || 'draft';
    els.version.value = section.version || '1.0';
    els.order.value = Number.isFinite(Number(section.display_order)) ? Number(section.display_order) : 0;
    els.revision.value = section.revision_due_at ? section.revision_due_at.slice(0, 10) : '';
    els.includeExport.checked = section.include_in_export !== false;
    els.references.value = section.regulatory_references || '';
    els.comment.value = section.comment_internal || '';
    renderStructureControls(section);
    state.dirty = false;
    renderMissing();
    renderAttachments();
  }

  async function load(selectId = null) {
    setFeedback('Chargement de la documentation...');
    const data = await request('/default');
    state.collection = data.collection;
    state.sections = data.sections;
    state.missing = data.missing_items;
    state.attachments = data.attachments;
    state.diagrams = data.diagrams || [];
    state.currentId = selectId || state.currentId || state.sections.find((section) => section.section_type !== 'tome')?.id || state.sections[0]?.id || null;
    els.title.textContent = state.collection.title;
    renderMetrics(data.dashboard);
    renderTree();
    renderEditor();
    setFeedback('');
  }

  function payload(extra = {}) {
    return {
      title: els.titleInput.value,
      content_html: els.editor.innerHTML,
      status: els.status.value,
      version: els.version.value,
      parent_id: els.parent.value || null,
      display_order: Number(els.order.value || 0),
      revision_due_at: els.revision.value || null,
      include_in_export: els.includeExport.checked,
      regulatory_references: els.references.value,
      comment_internal: els.comment.value,
      ...extra,
    };
  }

  async function save(extra = {}) {
    const section = currentSection();
    if (!section || !canEdit) return null;
    const updated = await request(`/sections/${section.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload(extra)),
    });
    await load(updated.id);
    return updated;
  }

  async function updateSectionOnly(sectionId, body) {
    return request(`/sections/${sectionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function moveCurrent(direction) {
    const section = currentSection();
    if (!section || !canEdit) return;
    const siblings = activeSections()
      .filter((item) => item.parent_id === section.parent_id && item.section_type === section.section_type)
      .sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0));
    const index = siblings.findIndex((item) => item.id === section.id);
    const sibling = siblings[index + direction];
    if (!sibling) return;
    const currentOrder = section.display_order;
    await save({ display_order: sibling.display_order, change_summary: direction < 0 ? 'Deplacement du chapitre vers le haut' : 'Deplacement du chapitre vers le bas' });
    await updateSectionOnly(sibling.id, { display_order: currentOrder, change_summary: 'Reordonnancement documentaire' });
    await load(section.id);
  }

  async function openPdf(path, download = false) {
    const blob = await requestPdf(path, {
      method: 'POST',
      body: JSON.stringify({ export_type: 'full', include_missing: true, include_attachments: true }),
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    if (download) link.download = 'Manuel_Qualite_ALTA_MAREE.pdf';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function openProtectedAttachment(id) {
    const response = await fetch(`${API_BASE_URL}/api/quality/documentation/attachments/${id}/download`, { headers: headers() });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Piece jointe introuvable');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function applyTextColor(color) {
    if (!color || !canEdit) return;
    els.editor.focus();
    document.execCommand('styleWithCSS', false, true);
    document.execCommand('foreColor', false, color);
    state.dirty = true;
  }

  document.querySelectorAll('[data-command]').forEach((button) => {
    button.addEventListener('click', () => document.execCommand(button.dataset.command, false, null));
  });
  document.querySelectorAll('[data-text-color]').forEach((button) => {
    button.addEventListener('click', () => applyTextColor(button.dataset.textColor));
  });
  els.textColor.addEventListener('change', () => {
    applyTextColor(els.textColor.value);
    els.textColor.value = '';
  });
  els.insertDiagram.addEventListener('click', () => openDiagramModal());
  els.editor.addEventListener('dblclick', (event) => {
    const block = event.target.closest?.('[data-diagram-id]');
    if (!block) return;
    const diagram = state.diagrams.find((item) => item.id === block.dataset.diagramId);
    if (diagram) openDiagramModal(diagram);
  });
  els.diagramClose.addEventListener('click', closeDiagramModal);
  els.diagramCancel.addEventListener('click', closeDiagramModal);
  els.diagramTemplate.addEventListener('change', () => {
    if (diagramState.id || !diagramState.data) return;
    diagramState.data = templateData(els.diagramTemplate.value);
    renderDiagramEditor();
  });
  els.diagramTitle.addEventListener('input', () => {
    if (diagramState.data) diagramState.data.title = els.diagramTitle.value;
  });
  els.diagramOrientation.addEventListener('change', () => mutateDiagram((data) => {
    data.orientation = els.diagramOrientation.value;
    autoLayoutDiagram(data);
  }));
  els.diagramZoom.addEventListener('input', () => {
    diagramState.zoom = Number(els.diagramZoom.value || 100);
    renderDiagramEditor();
  });
  els.diagramFit.addEventListener('click', () => {
    diagramState.zoom = 100;
    renderDiagramEditor();
  });
  els.diagramUndo.addEventListener('click', () => {
    if (!diagramState.history.length) return;
    diagramState.future.push(cloneDiagram(diagramState.data));
    diagramState.data = diagramState.history.pop();
    renderDiagramEditor();
  });
  els.diagramRedo.addEventListener('click', () => {
    if (!diagramState.future.length) return;
    diagramState.history.push(cloneDiagram(diagramState.data));
    diagramState.data = diagramState.future.pop();
    renderDiagramEditor();
  });
  els.diagramAutoLayout.addEventListener('click', () => mutateDiagram(autoLayoutDiagram));
  els.diagramAddStep.addEventListener('click', () => mutateDiagram((data) => {
    const index = data.nodes.length + 1;
    data.nodes.push({ id: `etape-${Date.now()}`, label: `Etape ${index}`, type: 'process', description: '', chapter_code: '', x: data.orientation === 'horizontal' ? index - 1 : 0, y: data.orientation === 'horizontal' ? 0 : index - 1 });
  }));
  els.diagramAddDecision.addEventListener('click', () => mutateDiagram((data) => {
    const index = data.nodes.length + 1;
    data.nodes.push({ id: `decision-${Date.now()}`, label: 'Decision', type: 'decision', description: '', chapter_code: '', x: data.orientation === 'horizontal' ? index - 1 : 1, y: data.orientation === 'horizontal' ? 1 : index - 1 });
  }));
  els.diagramAddEdge.addEventListener('click', () => mutateDiagram((data) => {
    if (data.nodes.length < 2) return;
    data.edges.push({ id: `edge-${Date.now()}`, from: data.nodes[0].id, to: data.nodes[1].id, label: '' });
  }));
  els.diagramNodeList.addEventListener('change', (event) => {
    const field = event.target.dataset.nodeField;
    const card = event.target.closest('[data-node-id]');
    if (!field || !card) return;
    mutateDiagram((data) => {
      const node = data.nodes.find((item) => item.id === card.dataset.nodeId);
      if (!node) return;
      if (field === 'position') {
        const [x, y] = String(event.target.value).split(',').map((value) => Number(value.trim()));
        node.x = Number.isFinite(x) ? x : node.x;
        node.y = Number.isFinite(y) ? y : node.y;
      } else {
        node[field] = event.target.value;
      }
    });
  });
  els.diagramNodeList.addEventListener('click', (event) => {
    const action = event.target.dataset.nodeAction;
    const card = event.target.closest('[data-node-id]');
    if (!action || !card) return;
    mutateDiagram((data) => {
      const index = data.nodes.findIndex((item) => item.id === card.dataset.nodeId);
      if (index < 0) return;
      if (action === 'delete') {
        const id = data.nodes[index].id;
        data.nodes.splice(index, 1);
        data.edges = data.edges.filter((edge) => edge.from !== id && edge.to !== id);
      }
      if (action === 'duplicate') {
        const copy = cloneDiagram(data.nodes[index]);
        copy.id = `${copy.id}-copie-${Date.now()}`;
        copy.label = `${copy.label} copie`;
        copy.y = Number(copy.y || 0) + 1;
        data.nodes.splice(index + 1, 0, copy);
      }
    });
  });
  els.diagramEdgeList.addEventListener('change', (event) => {
    const field = event.target.dataset.edgeField;
    const card = event.target.closest('[data-edge-id]');
    if (!field || !card) return;
    mutateDiagram((data) => {
      const edge = data.edges.find((item) => item.id === card.dataset.edgeId);
      if (edge) edge[field] = event.target.value;
    });
  });
  els.diagramEdgeList.addEventListener('click', (event) => {
    if (event.target.dataset.edgeAction !== 'delete') return;
    const card = event.target.closest('[data-edge-id]');
    if (!card) return;
    mutateDiagram((data) => {
      data.edges = data.edges.filter((edge) => edge.id !== card.dataset.edgeId);
    });
  });
  els.diagramSave.addEventListener('click', () => saveDiagram().catch((error) => setFeedback(error.message, 'error')));
  els.diagramDelete.addEventListener('click', async () => {
    if (!diagramState.id || !window.confirm('Supprimer ce diagramme ?')) return;
    try {
      await request(`/diagrams/${diagramState.id}`, { method: 'DELETE' });
      await load(state.currentId);
      closeDiagramModal();
    } catch (error) {
      setFeedback(error.message, 'error');
    }
  });
  [els.titleInput, els.editor, els.status, els.version, els.parent, els.order, els.revision, els.includeExport, els.references, els.comment].forEach((el) => {
    el.addEventListener('input', () => { state.dirty = true; });
    el.addEventListener('change', () => { state.dirty = true; });
  });
  els.tree.addEventListener('click', (event) => {
    const button = event.target.closest('[data-section-id]');
    if (!button) return;
    if (state.dirty && !window.confirm('Des modifications ne sont pas enregistrees. Continuer ?')) return;
    state.currentId = button.dataset.sectionId;
    renderTree();
    renderEditor();
  });
  els.search.addEventListener('input', renderTree);
  els.save.addEventListener('click', () => save().catch((error) => setFeedback(error.message, 'error')));
  els.saveNext.addEventListener('click', async () => {
    try {
      await save();
      const chapters = state.sections.filter((section) => section.section_type !== 'tome' && !section.archived_at);
      const index = chapters.findIndex((section) => section.id === state.currentId);
      state.currentId = chapters[index + 1]?.id || chapters[0]?.id || state.currentId;
      renderTree();
      renderEditor();
    } catch (error) {
      setFeedback(error.message, 'error');
    }
  });
  els.review.addEventListener('click', () => save({ status: 'ready_for_review', change_summary: 'Envoi en relecture' }).catch((error) => setFeedback(error.message, 'error')));
  els.validate.addEventListener('click', () => save({ status: 'validated', change_summary: 'Validation documentaire' }).catch((error) => setFeedback(error.message, 'error')));
  els.moveUp.addEventListener('click', () => moveCurrent(-1).catch((error) => setFeedback(error.message, 'error')));
  els.moveDown.addEventListener('click', () => moveCurrent(1).catch((error) => setFeedback(error.message, 'error')));
  els.deleteSection.addEventListener('click', async () => {
    const section = currentSection();
    if (!section || !canEdit || !window.confirm(`Supprimer le chapitre "${section.title}" ? Il sera archive et masque de l'export.`)) return;
    try {
      await request(`/sections/${section.id}`, { method: 'DELETE' });
      const next = activeSections().find((item) => item.id !== section.id)?.id || null;
      await load(next);
    } catch (error) {
      setFeedback(error.message, 'error');
    }
  });
  els.mergeSection.addEventListener('click', async () => {
    const section = currentSection();
    const targetId = els.mergeTarget.value;
    if (!section || !targetId || !canEdit) return;
    const target = state.sections.find((item) => item.id === targetId);
    if (!target || !window.confirm(`Fusionner "${section.title}" dans "${target.title}" ? Le chapitre source sera archive.`)) return;
    try {
      const merged = await request(`/sections/${section.id}/merge-into/${targetId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Fusion depuis l interface documentaire' }),
      });
      await load(merged.id);
    } catch (error) {
      setFeedback(error.message, 'error');
    }
  });
  els.markMissing.addEventListener('click', async () => {
    const selectedText = window.getSelection().toString().trim();
    const selection = selectedText || window.prompt('Information a completer');
    if (!selection) return;
    if (selectedText) {
      applyTextColor('#b42318');
    } else {
      els.editor.focus();
      document.execCommand('insertHTML', false, `<span class="missing-info" style="color: #b42318; font-weight: 700;">${escapeHtml(selection)}</span>`);
      state.dirty = true;
    }
    await request('/missing-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section_id: state.currentId, description: selection, severity: 'before_submission' }),
    });
    await save({ status: 'to_complete', change_summary: 'Ajout information a completer' });
  });
  els.add.addEventListener('click', async () => {
    const parent = currentSection();
    const title = window.prompt('Titre du nouveau chapitre');
    if (!title || !parent) return;
    const code = `${parent.code || 'DOC'}-${Date.now().toString().slice(-4)}`;
    try {
      const created = await request(`/${state.collection.id}/sections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent_id: parent.section_type === 'tome' ? parent.id : parent.parent_id, title, code, section_type: 'chapter', status: 'draft', display_order: parent.display_order + 1 }),
      });
      await load(created.id);
    } catch (error) {
      setFeedback(error.message, 'error');
    }
  });
  document.querySelectorAll('[data-missing-filter]').forEach((button) => button.addEventListener('click', () => {
    state.filter = button.dataset.missingFilter;
    renderMissing();
  }));
  els.missing.addEventListener('click', async (event) => {
    const open = event.target.closest('[data-open-section]');
    const resolve = event.target.closest('[data-resolve-missing]');
    if (open) {
      state.currentId = open.dataset.openSection;
      renderTree();
      renderEditor();
    }
    if (resolve) {
      await request(`/missing-items/${resolve.dataset.resolveMissing}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'resolved' }),
      });
      await load(state.currentId);
    }
  });
  els.attachmentForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!canEdit || !state.currentId || !els.attachmentFile.files[0]) return;
    const formData = new FormData();
    formData.set('file', els.attachmentFile.files[0]);
    formData.set('include_in_export', els.attachmentInclude.checked ? 'true' : 'false');
    const response = await fetch(`${API_BASE_URL}/api/quality/documentation/sections/${state.currentId}/attachments`, { method: 'POST', headers: headers(), body: formData });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Erreur piece jointe');
    }
    els.attachmentForm.reset();
    els.attachmentInclude.checked = true;
    await load(state.currentId);
  });
  els.attachments.addEventListener('click', async (event) => {
    const download = event.target.closest('[data-download-attachment]');
    const archive = event.target.closest('[data-delete-attachment]');
    if (download) await openProtectedAttachment(download.dataset.downloadAttachment);
    if (archive && window.confirm('Archiver cette piece jointe ?')) {
      await request(`/attachments/${archive.dataset.deleteAttachment}`, { method: 'DELETE' });
      await load(state.currentId);
    }
  });
  els.preview.disabled = !canExport;
  els.exportPdf.disabled = !canExport;
  els.preview.addEventListener('click', () => openPdf(`/${state.collection.id}/preview`, false).catch((error) => setFeedback(error.message, 'error')));
  els.exportPdf.addEventListener('click', () => openPdf(`/${state.collection.id}/export-pdf`, true).catch((error) => setFeedback(error.message, 'error')));
  window.addEventListener('beforeunload', (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  load().catch((error) => setFeedback(error.message, 'error'));
})();
