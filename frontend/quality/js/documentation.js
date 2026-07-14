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
    insertTable: $('insert-table-btn'),
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
    diagramVisualTab: $('diagram-visual-tab'),
    diagramMermaidTab: $('diagram-mermaid-tab'),
    diagramVisualPanel: $('diagram-visual-panel'),
    diagramMermaidPanel: $('diagram-mermaid-panel'),
    mermaidTitle: $('mermaid-title'),
    mermaidTemplate: $('mermaid-template'),
    mermaidLoadTemplate: $('mermaid-load-template-btn'),
    mermaidFormat: $('mermaid-format-btn'),
    mermaidPreviewBtn: $('mermaid-preview-btn'),
    mermaidExpand: $('mermaid-expand-btn'),
    mermaidStatus: $('mermaid-status'),
    mermaidSource: $('mermaid-source'),
    mermaidPreview: $('mermaid-preview'),
    mermaidError: $('mermaid-error'),
    mermaidSaveTemplate: $('mermaid-save-template-btn'),
    mermaidManageTemplates: $('mermaid-manage-templates-btn'),
    mermaidFullscreen: $('mermaid-fullscreen'),
    mermaidCollapse: $('mermaid-collapse-btn'),
    mermaidFullscreenTitle: $('mermaid-fullscreen-title-input'),
    mermaidFullscreenSource: $('mermaid-fullscreen-source'),
    mermaidFullscreenPreview: $('mermaid-fullscreen-preview'),
    mermaidFullscreenError: $('mermaid-fullscreen-error'),
    mermaidFullscreenPreviewBtn: $('mermaid-fullscreen-preview-btn'),
    mermaidFullscreenSave: $('mermaid-fullscreen-save-btn'),
    mermaidFullscreenClose: $('mermaid-fullscreen-close-btn'),
    mermaidTemplateManager: $('mermaid-template-manager'),
    mermaidTemplateManagerClose: $('mermaid-template-manager-close-btn'),
    mermaidTemplateList: $('mermaid-template-list'),
    mermaidTemplateForm: $('mermaid-template-form'),
    mermaidTemplateId: $('mermaid-template-id'),
    mermaidTemplateName: $('mermaid-template-name'),
    mermaidTemplateDescription: $('mermaid-template-description'),
    mermaidTemplateCategory: $('mermaid-template-category'),
    mermaidTemplateSource: $('mermaid-template-source'),
    mermaidTemplateDuplicate: $('mermaid-template-duplicate-btn'),
    mermaidTemplateDelete: $('mermaid-template-delete-btn'),
    tableModal: $('table-modal'),
    tableClose: $('table-close-btn'),
    tableCancel: $('table-cancel-btn'),
    tableSave: $('table-save-btn'),
    tableDelete: $('table-delete-btn'),
    tableVisualTab: $('table-visual-tab'),
    tableMarkdownTab: $('table-markdown-tab'),
    tableVisualPanel: $('table-visual-panel'),
    tableMarkdownPanel: $('table-markdown-panel'),
    tableTitle: $('table-title'),
    tableTemplate: $('table-template'),
    tableLoadTemplate: $('table-load-template-btn'),
    tableSaveTemplate: $('table-save-template-btn'),
    tableManageTemplates: $('table-manage-templates-btn'),
    tableHeader: $('table-header-checkbox'),
    tableGrid: $('table-grid'),
    tableAddRow: $('table-add-row-btn'),
    tableAddColumn: $('table-add-column-btn'),
    tableRemoveRow: $('table-remove-row-btn'),
    tableRemoveColumn: $('table-remove-column-btn'),
    tableMarkdownSource: $('table-markdown-source'),
    tableMarkdownPreviewBtn: $('table-markdown-preview-btn'),
    tableMarkdownError: $('table-markdown-error'),
    tableMarkdownPreview: $('table-markdown-preview'),
    tableTemplateManager: $('table-template-manager'),
    tableTemplateManagerClose: $('table-template-manager-close-btn'),
    tableTemplateList: $('table-template-list'),
    tableTemplateForm: $('table-template-form'),
    tableTemplateId: $('table-template-id'),
    tableTemplateName: $('table-template-name'),
    tableTemplateDescription: $('table-template-description'),
    tableTemplateCategory: $('table-template-category'),
    tableTemplateSource: $('table-template-source'),
    tableTemplateDuplicate: $('table-template-duplicate-btn'),
    tableTemplateDelete: $('table-template-delete-btn'),
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

  let state = { collection: null, sections: [], missing: [], attachments: [], diagrams: [], tables: [], currentId: null, dirty: false, filter: 'all', mermaidTemplates: [], tableTemplates: [] };
  let diagramState = { id: null, data: null, history: [], future: [], zoom: 100, mode: 'structured', mermaidSvg: '', mermaidDirty: false };
  let tableState = { id: null, data: null, mode: 'visual' };

  if (window.mermaid) {
    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      htmlLabels: false,
      flowchart: { htmlLabels: false, useMaxWidth: true },
      theme: 'base',
      themeVariables: {
        fontFamily: 'Arial, sans-serif',
        primaryTextColor: '#111827',
        lineColor: '#334155',
        primaryBorderColor: '#1f2937',
        primaryColor: '#ffffff',
        secondaryColor: '#f8fafc',
        tertiaryColor: '#fef2f2',
      },
    });
  }

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

  function setMermaidStatus(message = '', type = '') {
    els.mermaidStatus.textContent = message;
    els.mermaidStatus.className = message ? `quality-inline-status ${type}`.trim() : 'quality-inline-status hidden';
  }

  function reportActionError(error, fallback = 'Erreur') {
    console.error(fallback, error);
    setFeedback(error.message || fallback, 'error');
    setMermaidStatus(error.message || fallback, 'error');
  }

  function systemMermaidTemplates() {
    const builtIns = mermaidTemplateData();
    return Object.entries(builtIns).map(([key, template]) => ({
      id: `system:${key}`,
      key,
      name: template.name || template.title,
      title: template.title,
      description: template.description || '',
      category: template.category || 'Autre',
      source: template.source,
      is_system: true,
      editor_mode: 'mermaid',
    }));
  }

  function renderMermaidTemplateSelect() {
    const templates = state.mermaidTemplates.length ? state.mermaidTemplates : systemMermaidTemplates();
    els.mermaidTemplate.innerHTML = templates.map((template) => {
      const badge = template.is_system ? 'Systeme' : 'Personnalise';
      return `<option value="${escapeHtml(template.id)}">${escapeHtml(template.category || 'Autre')} - ${escapeHtml(template.name || template.title)} (${badge})</option>`;
    }).join('');
  }

  async function loadMermaidTemplates() {
    try {
      const templates = await request('/diagrams/template-library');
      state.mermaidTemplates = templates;
    } catch (error) {
      state.mermaidTemplates = systemMermaidTemplates();
    }
    renderMermaidTemplateSelect();
    return state.mermaidTemplates;
  }

  function selectedMermaidTemplate() {
    const templates = state.mermaidTemplates.length ? state.mermaidTemplates : systemMermaidTemplates();
    return templates.find((template) => template.id === els.mermaidTemplate.value) || templates[0] || systemMermaidTemplates()[0];
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

  function mermaidTemplateData(key = null) {
    const templates = {
      seafood_fabrication: {
        name: 'Fabrication produits de la peche',
        title: 'Diagramme de fabrication - Produits de la peche prepares',
        description: 'Flux complet de preparation de produits de la peche avec branche non-conformite.',
        category: 'Fabrication',
        source: `flowchart TD
    A([Début]) --> B[Réception des poissons]
    B --> C[Contrôle à réception]
    C --> D{Lot conforme ?}

    D -- Oui --> E[Stockage en chambre froide ou préparation immédiate]
    D -- Non --> NC1[Isolement du lot]
    NC1 --> NC2[Création d'une non-conformité dans ALTA]
    NC2 --> NC3[Photographies et information de la criée]
    NC3 --> NC4[Décision : retour, avoir, destruction ou déclassement]

    E --> F[Préparation]
    F --> G[Découpe]
    G --> H[Filetage]
    H --> I[Parage]
    I --> J[Pelage si nécessaire]
    J --> K[Conditionnement]
    K --> L[Mise sous glace]
    L --> M[Filmage]
    M --> N[Étiquetage]
    N --> O[Préparation de la commande]
    O --> P[Contrôle final]
    P --> Q{Commande conforme ?}

    Q -- Oui --> R[Chargement en véhicule frigorifique]
    Q -- Non --> NC5[Isolement et correction de la commande]
    NC5 --> P

    R --> S[Expédition]
    S --> T([Fin])`,
      },
      live_shellfish: {
        name: 'Crustaces vivants',
        title: 'Crustaces vivants',
        description: 'Reception, controle et expedition de crustaces vivants.',
        category: 'Fabrication',
        source: `flowchart TD
    A([Debut]) --> B[Reception des crustaces vivants]
    B --> C[Controle vitalite et temperature]
    C --> D{Lot conforme ?}
    D -- Oui --> E[Stockage en vivier ou zone adaptee]
    D -- Non --> NC1[Isolement du lot]
    NC1 --> NC2[Non-conformite fournisseur]
    E --> F[Preparation de commande]
    F --> G[Controle final]
    G --> H[Expedition]
    H --> I([Fin])`,
      },
      trading_with_transit: {
        name: 'Negoce avec transit',
        title: 'Negoce avec transit',
        description: 'Negoce avec passage physique en chambre froide.',
        category: 'Flux',
        source: `flowchart TD
    A([Debut]) --> B[Reception produit]
    B --> C[Controle documentaire et temperature]
    C --> D{Conforme ?}
    D -- Oui --> E[Transit en chambre froide]
    D -- Non --> NC1[Isolement et non-conformite]
    E --> F[Preparation expedition]
    F --> G[Chargement]
    G --> H[Livraison client]
    H --> I([Fin])`,
      },
      trading_without_transit: {
        name: 'Negoce sans transit',
        title: 'Negoce sans transit',
        description: 'Negoce sans passage physique par l atelier.',
        category: 'Flux',
        source: `flowchart TD
    A([Debut]) --> B[Commande fournisseur]
    B --> C[Controle documents et tracabilite]
    C --> D[Expedition directe fournisseur vers client]
    D --> E[Controle reception client]
    E --> F{Anomalie ?}
    F -- Non --> G([Fin])
    F -- Oui --> NC1[Ouverture non-conformite]`,
      },
      non_conformity: {
        name: 'Non-conformite',
        title: 'Non-conformite',
        description: 'Traitement d une anomalie produit ou fournisseur.',
        category: 'Non-conformite',
        source: `flowchart TD
    A([Debut]) --> B[Detection anomalie]
    B --> C[Isolement du produit]
    C --> D[Enregistrement dans ALTA]
    D --> E{Decision ?}
    E -- Retour --> F[Retour fournisseur]
    E -- Avoir --> G[Demande avoir]
    E -- Destruction --> H[Destruction maitrisee]
    F --> I([Fin])
    G --> I
    H --> I`,
      },
      recall: {
        name: 'Retrait / rappel',
        title: 'Retrait / rappel',
        description: 'Gestion d une alerte, d un retrait ou d un rappel.',
        category: 'Retrait / rappel',
        source: `flowchart TD
    A([Debut]) --> B[Alerte sanitaire ou interne]
    B --> C[Identification du lot]
    C --> D[Blocage du stock]
    D --> E[Identification des clients]
    E --> F[Information autorites et clients]
    F --> G[Retrait ou rappel]
    G --> H[Bilan et action corrective]
    H --> I([Fin])`,
      },
      simple_process: {
        name: 'Processus simple',
        title: 'Processus simple',
        description: 'Base courte pour decrire un processus controle.',
        category: 'Flux',
        source: `flowchart TD
    A([Debut]) --> B[Etape]
    B --> C[Controle]
    C --> D{Conforme ?}
    D -- Oui --> E([Fin])
    D -- Non --> F[Action corrective]
    F --> B`,
      },
    };
    if (!key) return cloneDiagram(templates);
    return cloneDiagram(templates[key] || templates.seafood_fabrication);
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

  function sanitizeMermaidSource(source) {
    const text = String(source || '').replace(/\r\n/g, '\n').trim();
    if (!text) throw new Error('Le code Mermaid est obligatoire.');
    if (!/^flowchart\s+(TD|TB|BT|LR|RL)\b/i.test(text)) throw new Error('Seuls les diagrammes Mermaid flowchart sont autorises.');
    if (/<[^>]+>/i.test(text) || /\bclick\b/i.test(text) || /\bhref\b/i.test(text) || /javascript\s*:/i.test(text) || /https?:\/\//i.test(text)) {
      throw new Error('Le code Mermaid contient une instruction non autorisee.');
    }
    return text;
  }

  function sanitizeMermaidSvg(svg) {
    const text = String(svg || '').trim();
    if (!/^<svg[\s>]/i.test(text)) throw new Error('Mermaid n a pas produit de SVG.');
    if (/<script[\s>]/i.test(text) || /<foreignObject[\s>]/i.test(text) || /\son[a-z]+\s*=/i.test(text) || /\b(?:href|xlink:href|src)\s*=\s*["']?\s*(?:javascript|data)\s*:/i.test(text)) {
      throw new Error('Le SVG Mermaid contient un contenu non autorise.');
    }
    return text;
  }

  function formatMermaidSource(source) {
    return String(source || '')
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return '';
        return index === 0 || /^flowchart\b/i.test(trimmed) ? trimmed : `    ${trimmed}`;
      })
      .join('\n')
      .trim();
  }

  function mermaidErrorMessage(error) {
    const message = String(error?.str || error?.message || error || 'Erreur Mermaid');
    const hashLine = error?.hash?.loc?.first_line;
    const match = message.match(/line\s+(\d+)/i);
    const line = hashLine || match?.[1];
    return line ? `Erreur Mermaid ligne ${line} : ${message}` : `Erreur Mermaid : ${message}`;
  }

  async function previewMermaid(options = {}) {
    if (!window.mermaid) throw new Error('La bibliotheque Mermaid locale est indisponible.');
    const sourceEl = options.sourceEl || els.mermaidSource;
    const previewEl = options.previewEl || els.mermaidPreview;
    const errorEl = options.errorEl || els.mermaidError;
    const button = options.button || els.mermaidPreviewBtn;
    const source = sanitizeMermaidSource(sourceEl.value);
    errorEl.classList.add('hidden');
    errorEl.textContent = '';
    previewEl.innerHTML = '<div class="quality-empty-state">Generation de l apercu...</div>';
    setMermaidStatus('Generation de l apercu...', 'loading');
    if (button) button.disabled = true;
    try {
      if (window.mermaid.parse) await window.mermaid.parse(source);
      const id = `quality-mermaid-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const rendered = await window.mermaid.render(id, source);
      const svg = sanitizeMermaidSvg(rendered.svg || rendered);
      previewEl.innerHTML = svg;
      diagramState.mermaidSvg = svg;
      setMermaidStatus('Apercu genere.', 'success');
      return svg;
    } catch (error) {
      diagramState.mermaidSvg = '';
      previewEl.innerHTML = '';
      errorEl.textContent = mermaidErrorMessage(error);
      errorEl.classList.remove('hidden');
      setMermaidStatus('Erreur Mermaid. Corrige le code puis relance la previsualisation.', 'error');
      throw error;
    } finally {
      if (button) button.disabled = false;
    }
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
    const isMermaid = diagramState.mode === 'mermaid';
    els.diagramVisualTab.classList.toggle('active', !isMermaid);
    els.diagramMermaidTab.classList.toggle('active', isMermaid);
    els.diagramVisualPanel.classList.toggle('hidden', isMermaid);
    els.diagramMermaidPanel.classList.toggle('hidden', !isMermaid);
    els.diagramTitle.value = data.title || '';
    els.mermaidTitle.value = data.title || '';
    if (isMermaid) {
      if (!diagramState.mermaidDirty) els.mermaidSource.value = data.source || '';
      els.mermaidPreview.innerHTML = diagramState.mermaidSvg || data.rendered_svg || '';
      return;
    }
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
    const mode = baseData.editor_mode === 'mermaid' ? 'mermaid' : 'structured';
    diagramState = {
      id: diagram?.id || null,
      data: cloneDiagram(baseData),
      history: [],
      future: [],
      zoom: 100,
      mode,
      mermaidSvg: baseData.rendered_svg || '',
      mermaidDirty: false,
    };
    els.diagramDelete.classList.toggle('hidden', !diagramState.id);
    els.diagramModal.classList.remove('hidden');
    renderDiagramEditor();
    if (mode === 'mermaid' && !diagramState.mermaidSvg) previewMermaid().catch(() => {});
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

  function switchDiagramMode(mode) {
    if (!diagramState.data || diagramState.mode === mode) return;
    if (diagramState.id && !window.confirm('Changer de mode remplace le contenu editable du diagramme. Continuer ?')) return;
    diagramState.mode = mode;
    if (mode === 'mermaid') {
      const template = selectedMermaidTemplate();
      diagramState.data = { editor_mode: 'mermaid', title: template.title, source: template.source, rendered_svg: '', schema_version: 1 };
      diagramState.mermaidSvg = '';
      diagramState.mermaidDirty = false;
      renderDiagramEditor();
      return;
    }
    diagramState.data = templateData(els.diagramTemplate.value || 'blank');
    diagramState.mermaidSvg = '';
    renderDiagramEditor();
  }

  async function saveDiagram() {
    const section = currentSection();
    if (!section || !diagramState.data) return;
    els.diagramSave.disabled = true;
    setMermaidStatus('Enregistrement...', 'loading');
    setFeedback('Enregistrement du diagramme...');
    try {
      if (diagramState.mode === 'mermaid') {
        const source = sanitizeMermaidSource(els.mermaidSource.value);
        const svg = diagramState.mermaidSvg || await previewMermaid();
        diagramState.data = {
          editor_mode: 'mermaid',
          schema_version: 1,
          title: els.mermaidTitle.value || 'Diagramme Mermaid',
          source,
          rendered_svg: svg,
        };
      } else {
        diagramState.data.title = els.diagramTitle.value || 'Diagramme qualite';
        diagramState.data.orientation = els.diagramOrientation.value || 'vertical';
        diagramState.data.editor_mode = 'structured';
      }
      const path = diagramState.id ? `/diagrams/${diagramState.id}` : `/sections/${section.id}/diagrams`;
      const method = diagramState.id ? 'PUT' : 'POST';
      const saved = await request(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ diagram_data: diagramState.data, editor_mode: diagramState.mode, confirm_mode_change: true }),
      });
      await load(section.id);
      setFeedback('Diagramme enregistre.', 'success');
      setMermaidStatus('Enregistre.', 'success');
      closeDiagramModal();
      return saved;
    } catch (error) {
      console.error('Erreur enregistrement diagramme', error);
      setMermaidStatus(`Erreur d enregistrement : ${error.message}`, 'error');
      setFeedback(error.message, 'error');
      throw error;
    } finally {
      els.diagramSave.disabled = false;
    }
  }

  function renderTemplateManager(selectedId = '') {
    const templates = state.mermaidTemplates.length ? state.mermaidTemplates : systemMermaidTemplates();
    els.mermaidTemplateList.innerHTML = templates.map((template) => `<article class="quality-template-list-item ${template.id === selectedId ? 'active' : ''}" data-template-id="${escapeHtml(template.id)}">
      <button data-template-action="select" type="button">
        <strong>${escapeHtml(template.name || template.title)}</strong>
        <small>${escapeHtml(template.category || 'Autre')} - ${template.is_system ? 'Modele systeme' : 'Modele personnalise'}${template.updated_at ? ` - modifie le ${escapeHtml(String(template.updated_at).slice(0, 10))}` : ''}</small>
        ${template.description ? `<small>${escapeHtml(template.description)}</small>` : ''}
      </button>
      <div class="quality-actions">
        <button class="btn btn-secondary" data-template-action="load" type="button">Charger</button>
        <button class="btn btn-secondary" data-template-action="duplicate" type="button">Dupliquer</button>
        ${template.is_system ? '' : '<button class="btn btn-secondary" data-template-action="delete" type="button">Supprimer</button>'}
      </div>
    </article>`).join('');
  }

  function fillTemplateForm(template = null, duplicate = false) {
    const item = template || selectedMermaidTemplate();
    const isSystem = item?.is_system && !duplicate;
    els.mermaidTemplateId.value = duplicate ? '' : (item?.id || '');
    els.mermaidTemplateName.value = duplicate ? `Copie - ${item?.name || item?.title || ''}` : (item?.name || item?.title || '');
    els.mermaidTemplateDescription.value = item?.description || '';
    els.mermaidTemplateCategory.value = item?.category || 'Autre';
    els.mermaidTemplateSource.value = item?.source || els.mermaidSource.value || '';
    [els.mermaidTemplateName, els.mermaidTemplateDescription, els.mermaidTemplateCategory, els.mermaidTemplateSource].forEach((field) => {
      field.disabled = isSystem;
    });
    els.mermaidTemplateDuplicate.disabled = !item;
    els.mermaidTemplateDelete.disabled = isSystem || !item?.id;
    els.mermaidTemplateForm.querySelector('button[type="submit"]').disabled = isSystem;
  }

  async function openTemplateManager() {
    await loadMermaidTemplates();
    const selected = selectedMermaidTemplate();
    renderTemplateManager(selected?.id);
    fillTemplateForm(selected);
    els.mermaidTemplateManager.classList.remove('hidden');
  }

  async function saveCurrentAsTemplate() {
    await loadMermaidTemplates();
    renderTemplateManager('');
    fillTemplateForm({
      id: '',
      name: els.mermaidTitle.value || '',
      title: els.mermaidTitle.value || '',
      description: '',
      category: 'Autre',
      source: els.mermaidSource.value,
      is_system: false,
    }, true);
    els.mermaidTemplateManager.classList.remove('hidden');
    setMermaidStatus('Complete le nom puis enregistre le modele.', 'loading');
  }

  function tableTemplateData() {
    const table = (title, columns, rows) => ({
      schema_version: 1,
      title,
      header: true,
      columns: columns.map((label, index) => ({ id: slugTableId(label, `col-${index + 1}`), label, alignment: 'left', width: null })),
      rows: rows.map((values, rowIndex) => ({
        id: `row-${rowIndex + 1}`,
        cells: Object.fromEntries(columns.map((label, index) => [slugTableId(label, `col-${index + 1}`), values[index] || ''])),
      })),
    });
    return {
      blank: table('Nouveau tableau qualite', ['Point', 'Description', 'Responsable'], [['', '', '']]),
      product_families: table('Familles de produits', ['Famille de produits', 'Exemples', 'Presentation', 'Temperature cible', 'Risques principaux', 'Surveillance associee'], [
        ['Poissons entiers frais', 'Bar, dorade, lieu, merlu', 'Entier, sous glace', '0 a +2 C', 'Temperature, alterabilite, tracabilite', 'Controle reception, temperature, etiquetage'],
        ['Filets et decoupes', 'Filets, darnes, portions', 'Bacs, caisses, sous glace', '0 a +2 C', 'Manipulation, contamination croisee', 'Hygiene, DLC/DDM, controle visuel'],
        ['Coquillages et crustaces', 'Moules, huitres, langoustines', 'Vivant ou frais selon espece', 'Selon produit et reglementation', 'Vitalite, origine, contamination', 'Agrements, documents sanitaires, lots'],
      ]),
      storage_conditions: table('Conditions de conservation', ['Zone / produit', 'Temperature', 'Duree indicative', 'Surveillance', 'Action en cas d ecart'], [
        ['Chambre froide produits frais', '0 a +2 C', 'Selon DLC ou rotation interne', 'Releve automatique ou manuel', 'Isolement, verification produit, action corrective'],
        ['Atelier de preparation', 'Temperature maitrisee', 'Temps de presence limite', 'Controle visuel et temperature ambiante', 'Reduction du temps d exposition, retour au froid'],
        ['Transport frigorifique', '0 a +2 C selon produit', 'Tournee de livraison', 'Controle au chargement et livraison', 'Information responsable qualite et decision lot'],
      ]),
      haccp_hazards: table('Analyse des dangers HACCP', ['Etape', 'Danger', 'Cause', 'Mesure de maitrise', 'Surveillance'], [['Reception', 'Rupture de temperature', 'Transport non conforme', 'Controle temperature reception', 'Fiche reception / ALTA']]),
      monitoring_plan: table('Plan de surveillance', ['Point surveille', 'Frequence', 'Responsable', 'Preuve', 'Action si ecart'], [['Temperature chambre froide', 'Quotidienne', 'Responsable qualite', 'Releve temperature', 'Action corrective et evaluation produits']]),
      cleaning_plan: table('Plan de nettoyage', ['Zone', 'Operation', 'Produit', 'Frequence', 'Controle'], [['Atelier', 'Nettoyage et desinfection', 'Produit homologue contact alimentaire', 'Chaque fin de production', 'Controle visuel']]),
      equipment_list: table('Liste des equipements', ['Equipement', 'Zone', 'Usage', 'Maintenance'], [['Balance', 'Preparation', 'Pesage commandes', 'Verification periodique']]),
      corrective_actions: table('Actions correctives', ['Ecart', 'Decision', 'Responsable', 'Delai', 'Preuve'], [['Temperature hors limite', 'Isolement du lot et evaluation', 'Qualite', 'Immediat', 'Fiche non-conformite']]),
    };
  }

  function slugTableId(value, fallback) {
    const text = String(value || fallback).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    return text || fallback;
  }

  function normalizeTableClient(input = {}) {
    const columns = Array.isArray(input.columns) && input.columns.length ? input.columns : tableTemplateData().blank.columns;
    const normalizedColumns = columns.slice(0, 20).map((column, index) => ({
      id: slugTableId(column.id || column.label, `col-${index + 1}`),
      label: String(column.label || `Colonne ${index + 1}`).replace(/<[^>]+>/g, '').slice(0, 120),
      alignment: ['left', 'center', 'right'].includes(column.alignment) ? column.alignment : 'left',
      width: Number.isFinite(Number(column.width)) ? Number(column.width) : null,
    }));
    const rows = Array.isArray(input.rows) ? input.rows.slice(0, 500) : [];
    return {
      schema_version: 1,
      title: String(input.title || 'Tableau qualite').replace(/<[^>]+>/g, '').slice(0, 160),
      header: input.header !== false,
      columns: normalizedColumns,
      rows: rows.map((row, rowIndex) => ({
        id: slugTableId(row.id, `row-${rowIndex + 1}`),
        cells: Object.fromEntries(normalizedColumns.map((column) => {
          const value = row.cells && Object.prototype.hasOwnProperty.call(row.cells, column.id) ? row.cells[column.id] : row[column.id];
          return [column.id, String(value || '').replace(/<[^>]+>/g, '').slice(0, 1000)];
        })),
      })),
    };
  }

  function systemTableTemplates() {
    return Object.entries(tableTemplateData()).map(([key, table_data]) => ({
      id: `system:${key}`,
      key,
      name: table_data.title,
      title: table_data.title,
      category: key === 'blank' ? 'Autre' : 'Produits',
      description: '',
      table_data,
      is_system: true,
    }));
  }

  async function loadTableTemplates() {
    try {
      state.tableTemplates = await request('/tables/template-library');
    } catch (error) {
      console.warn('Modeles de tableaux indisponibles', error);
      state.tableTemplates = systemTableTemplates();
    }
    renderTableTemplateOptions();
    return state.tableTemplates;
  }

  function renderTableTemplateOptions() {
    const templates = state.tableTemplates.length ? state.tableTemplates : systemTableTemplates();
    els.tableTemplate.innerHTML = templates.map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.category || 'Autre')} - ${escapeHtml(template.name || template.title)}</option>`).join('');
  }

  function selectedTableTemplate() {
    const templates = state.tableTemplates.length ? state.tableTemplates : systemTableTemplates();
    return templates.find((template) => template.id === els.tableTemplate.value) || templates[0] || systemTableTemplates()[0];
  }

  function renderTableHtml(data) {
    const table = normalizeTableClient(data);
    const head = table.header ? `<thead><tr>${table.columns.map((column) => `<th class="align-${column.alignment}">${escapeHtml(column.label)}</th>`).join('')}</tr></thead>` : '';
    const rows = table.rows.map((row) => `<tr>${table.columns.map((column) => `<td class="align-${column.alignment}">${escapeHtml(row.cells[column.id] || '').replace(/\n/g, '<br>')}</td>`).join('')}</tr>`).join('');
    return `<div class="quality-table-scroll"><table class="quality-data-table">${head}<tbody>${rows || `<tr><td colspan="${table.columns.length}">Aucune ligne renseignee.</td></tr>`}</tbody></table></div>`;
  }

  function renderTableGrid() {
    const data = normalizeTableClient(tableState.data);
    tableState.data = data;
    els.tableTitle.value = data.title;
    els.tableHeader.checked = data.header;
    els.tableGrid.innerHTML = `<table><thead><tr>${data.columns.map((column, index) => `<th><input data-table-col-label="${index}" value="${escapeHtml(column.label)}" aria-label="Colonne ${index + 1}"></th>`).join('')}</tr></thead><tbody>${data.rows.map((row, rowIndex) => `<tr>${data.columns.map((column, colIndex) => `<td><textarea data-table-cell="${rowIndex}:${colIndex}" rows="2">${escapeHtml(row.cells[column.id] || '')}</textarea></td>`).join('')}</tr>`).join('')}</tbody></table>`;
    els.tableMarkdownSource.value = tableToMarkdown(data);
    els.tableMarkdownPreview.innerHTML = renderTableHtml(data);
  }

  function setTableMode(mode) {
    tableState.mode = mode;
    els.tableVisualTab.classList.toggle('active', mode === 'visual');
    els.tableMarkdownTab.classList.toggle('active', mode === 'markdown');
    els.tableVisualPanel.classList.toggle('hidden', mode !== 'visual');
    els.tableMarkdownPanel.classList.toggle('hidden', mode !== 'markdown');
    if (mode === 'markdown') els.tableMarkdownSource.value = tableToMarkdown(tableState.data);
  }

  function openTableModal(table = null) {
    const template = tableTemplateData().blank;
    tableState = { id: table?.id || null, data: normalizeTableClient(table?.table_data || template), mode: 'visual' };
    renderTableTemplateOptions();
    renderTableGrid();
    setTableMode('visual');
    els.tableDelete.classList.toggle('hidden', !tableState.id);
    els.tableModal.classList.remove('hidden');
  }

  function closeTableModal() {
    els.tableModal.classList.add('hidden');
    tableState = { id: null, data: null, mode: 'visual' };
  }

  function updateTableFromGrid() {
    if (!tableState.data) return;
    const data = normalizeTableClient(tableState.data);
    data.title = els.tableTitle.value || data.title;
    data.header = els.tableHeader.checked;
    els.tableGrid.querySelectorAll('[data-table-col-label]').forEach((input) => {
      const index = Number(input.dataset.tableColLabel);
      if (data.columns[index]) data.columns[index].label = input.value;
    });
    els.tableGrid.querySelectorAll('[data-table-cell]').forEach((input) => {
      const [rowIndex, colIndex] = input.dataset.tableCell.split(':').map(Number);
      const row = data.rows[rowIndex];
      const column = data.columns[colIndex];
      if (row && column) row.cells[column.id] = input.value;
    });
    tableState.data = normalizeTableClient(data);
  }

  function tableToMarkdown(data) {
    const table = normalizeTableClient(data);
    const headers = table.columns.map((column) => column.label);
    const separator = table.columns.map(() => '---');
    const rows = table.rows.map((row) => table.columns.map((column) => String(row.cells[column.id] || '').replace(/\n/g, ' ')));
    return [headers, separator, ...rows].map((line) => `| ${line.join(' | ')} |`).join('\n');
  }

  function parseMarkdownTable(text) {
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n').map((line) => line.trim()).filter(Boolean);
    if (!lines.length) throw new Error('Le tableau est vide.');
    const split = (line) => {
      if (line.includes('|')) return line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
      return line.split('\t').map((cell) => cell.trim());
    };
    const headers = split(lines[0]);
    if (!headers.length) throw new Error('Le tableau doit contenir au moins une colonne.');
    const start = lines[1] && /^[:\-\s|]+$/.test(lines[1]) ? 2 : 1;
    const columns = headers.map((label, index) => ({ id: slugTableId(label, `col-${index + 1}`), label: label || `Colonne ${index + 1}`, alignment: 'left', width: null }));
    const rows = lines.slice(start).map((line, rowIndex) => {
      const values = split(line);
      return { id: `row-${rowIndex + 1}`, cells: Object.fromEntries(columns.map((column, index) => [column.id, values[index] || ''])) };
    });
    return normalizeTableClient({ title: els.tableTitle.value || 'Tableau qualite', header: true, columns, rows });
  }

  async function saveTable() {
    const section = currentSection();
    if (!section || !canEdit) return;
    if (tableState.mode === 'markdown') tableState.data = parseMarkdownTable(els.tableMarkdownSource.value);
    else updateTableFromGrid();
    tableState.data.title = els.tableTitle.value || tableState.data.title;
    const path = tableState.id ? `/tables/${tableState.id}` : `/sections/${section.id}/tables`;
    await request(path, {
      method: tableState.id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table_data: tableState.data }),
    });
    closeTableModal();
    await load(section.id);
    setFeedback('Tableau enregistre.', 'success');
  }

  async function deleteTableById(tableId) {
    if (!tableId || !window.confirm('Supprimer ce tableau du chapitre ? Cette action est definitive.')) return;
    await request(`/tables/${tableId}`, { method: 'DELETE' });
    await load(state.currentId);
    setFeedback('Tableau supprime.', 'success');
  }

  async function duplicateTable(tableId) {
    if (!tableId) return;
    await request(`/tables/${tableId}/duplicate`, { method: 'POST' });
    await load(state.currentId);
    setFeedback('Tableau duplique.', 'success');
  }

  function renderTableTemplateManager(selectedId = '') {
    const templates = state.tableTemplates.length ? state.tableTemplates : systemTableTemplates();
    els.tableTemplateList.innerHTML = templates.map((template) => `<article class="quality-template-list-item ${template.id === selectedId ? 'active' : ''}">
      <button data-table-template-id="${escapeHtml(template.id)}" type="button">
        <strong>${escapeHtml(template.name || template.title)}</strong>
        <small>${escapeHtml(template.category || 'Autre')} - ${template.is_system ? 'Modele systeme' : 'Modele personnalise'}</small>
      </button>
    </article>`).join('');
  }

  async function saveCurrentTableAsTemplate() {
    updateTableFromGrid();
    els.tableTemplateId.value = '';
    els.tableTemplateName.value = els.tableTitle.value || tableState.data?.title || '';
    els.tableTemplateDescription.value = '';
    els.tableTemplateCategory.value = 'Autre';
    els.tableTemplateSource.value = tableToMarkdown(tableState.data);
    await loadTableTemplates();
    renderTableTemplateManager('');
    els.tableTemplateManager.classList.remove('hidden');
  }

  function editorContentHtml() {
    const clone = els.editor.cloneNode(true);
    clone.querySelectorAll('[data-diagram-controls]').forEach((node) => node.remove());
    clone.querySelectorAll('[data-table-controls]').forEach((node) => node.remove());
    return clone.innerHTML;
  }

  function decorateDiagramBlocks() {
    els.editor.querySelectorAll('[data-diagram-id]').forEach((block) => {
      if (block.querySelector('[data-diagram-controls]')) return;
      const controls = document.createElement('div');
      controls.className = 'quality-diagram-controls';
      controls.setAttribute('data-diagram-controls', 'true');
      controls.setAttribute('contenteditable', 'false');
      controls.innerHTML = '<button class="btn btn-secondary" data-diagram-action="edit" type="button">Modifier</button><button class="btn btn-secondary" data-diagram-action="duplicate" type="button">Dupliquer</button><button class="btn btn-secondary" data-diagram-action="delete" type="button">Supprimer</button>';
      block.prepend(controls);
    });
  }

  function decorateTableBlocks() {
    els.editor.querySelectorAll('[data-table-id]').forEach((block) => {
      if (block.querySelector('[data-table-controls]')) return;
      const controls = document.createElement('div');
      controls.className = 'quality-table-controls';
      controls.setAttribute('data-table-controls', 'true');
      controls.setAttribute('contenteditable', 'false');
      controls.innerHTML = '<button class="btn btn-secondary" data-table-action="edit" type="button">Modifier</button><button class="btn btn-secondary" data-table-action="duplicate" type="button">Dupliquer</button><button class="btn btn-secondary" data-table-action="delete" type="button">Supprimer</button>';
      block.prepend(controls);
    });
  }

  async function deleteDiagramById(diagramId) {
    if (!diagramId || !window.confirm('Supprimer ce diagramme du chapitre ? Cette action est definitive.')) return;
    await request(`/diagrams/${diagramId}`, { method: 'DELETE' });
    await load(state.currentId);
    setFeedback('Diagramme supprime.', 'success');
  }

  async function duplicateDiagram(diagramId) {
    const section = currentSection();
    const diagram = state.diagrams.find((item) => item.id === diagramId);
    if (!section || !diagram) return;
    const copy = cloneDiagram(diagram.diagram_data || {});
    copy.title = `${copy.title || diagram.title || 'Diagramme'} copie`;
    await request(`/sections/${section.id}/diagrams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ diagram_data: copy, editor_mode: copy.editor_mode || 'structured', diagram_type: diagram.diagram_type || 'process' }),
    });
    await load(section.id);
    setFeedback('Diagramme duplique.', 'success');
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
    [els.titleInput, els.editor, els.status, els.version, els.parent, els.order, els.revision, els.includeExport, els.references, els.comment, els.textColor, els.save, els.saveNext, els.review, els.validate, els.markMissing, els.insertDiagram, els.insertTable, els.moveUp, els.moveDown, els.deleteSection].forEach((el) => {
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
    decorateDiagramBlocks();
    decorateTableBlocks();
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
    if (!state.mermaidTemplates.length) await loadMermaidTemplates();
    if (!state.tableTemplates.length) await loadTableTemplates();
    const data = await request('/default');
    state.collection = data.collection;
    state.sections = data.sections;
    state.missing = data.missing_items;
    state.attachments = data.attachments;
    state.diagrams = data.diagrams || [];
    state.tables = data.tables || [];
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
      content_html: editorContentHtml(),
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
  els.insertTable.addEventListener('click', () => openTableModal());
  els.editor.addEventListener('dblclick', (event) => {
    const tableBlock = event.target.closest?.('[data-table-id]');
    if (tableBlock) {
      const table = state.tables.find((item) => item.id === tableBlock.dataset.tableId);
      if (table) openTableModal(table);
      return;
    }
    const block = event.target.closest?.('[data-diagram-id]');
    if (!block) return;
    const diagram = state.diagrams.find((item) => item.id === block.dataset.diagramId);
    if (diagram) openDiagramModal(diagram);
  });
  els.editor.addEventListener('click', (event) => {
    const tableAction = event.target.closest?.('[data-table-action]');
    if (tableAction) {
      event.preventDefault();
      const block = tableAction.closest('[data-table-id]');
      const tableId = block?.dataset.tableId;
      const table = state.tables.find((item) => item.id === tableId);
      if (tableAction.dataset.tableAction === 'edit' && table) openTableModal(table);
      if (tableAction.dataset.tableAction === 'duplicate') duplicateTable(tableId).catch((error) => reportActionError(error, 'Erreur duplication tableau'));
      if (tableAction.dataset.tableAction === 'delete') deleteTableById(tableId).catch((error) => reportActionError(error, 'Erreur suppression tableau'));
      return;
    }
    const action = event.target.closest?.('[data-diagram-action]');
    if (!action) return;
    event.preventDefault();
    const block = action.closest('[data-diagram-id]');
    const diagramId = block?.dataset.diagramId;
    const diagram = state.diagrams.find((item) => item.id === diagramId);
    if (action.dataset.diagramAction === 'edit' && diagram) openDiagramModal(diagram);
    if (action.dataset.diagramAction === 'duplicate') duplicateDiagram(diagramId).catch((error) => reportActionError(error, 'Erreur duplication diagramme'));
    if (action.dataset.diagramAction === 'delete') deleteDiagramById(diagramId).catch((error) => reportActionError(error, 'Erreur suppression diagramme'));
  });
  els.tableClose.addEventListener('click', closeTableModal);
  els.tableCancel.addEventListener('click', closeTableModal);
  els.tableVisualTab.addEventListener('click', () => setTableMode('visual'));
  els.tableMarkdownTab.addEventListener('click', () => setTableMode('markdown'));
  els.tableLoadTemplate.addEventListener('click', () => {
    const template = selectedTableTemplate();
    if (!template) return;
    tableState.data = normalizeTableClient(template.table_data || tableTemplateData().blank);
    renderTableGrid();
  });
  els.tableSave.addEventListener('click', () => saveTable().catch((error) => reportActionError(error, 'Erreur enregistrement tableau')));
  els.tableDelete.addEventListener('click', () => {
    const id = tableState.id;
    closeTableModal();
    deleteTableById(id).catch((error) => reportActionError(error, 'Erreur suppression tableau'));
  });
  els.tableTitle.addEventListener('input', () => {
    if (tableState.data) tableState.data.title = els.tableTitle.value;
  });
  els.tableHeader.addEventListener('change', () => {
    updateTableFromGrid();
    tableState.data.header = els.tableHeader.checked;
    renderTableGrid();
  });
  els.tableGrid.addEventListener('input', updateTableFromGrid);
  els.tableAddRow.addEventListener('click', () => {
    updateTableFromGrid();
    const data = tableState.data;
    data.rows.push({ id: `row-${data.rows.length + 1}`, cells: Object.fromEntries(data.columns.map((column) => [column.id, ''])) });
    renderTableGrid();
  });
  els.tableAddColumn.addEventListener('click', () => {
    updateTableFromGrid();
    const data = tableState.data;
    const id = `col-${data.columns.length + 1}`;
    data.columns.push({ id, label: `Colonne ${data.columns.length + 1}`, alignment: 'left', width: null });
    data.rows.forEach((row) => { row.cells[id] = ''; });
    renderTableGrid();
  });
  els.tableRemoveRow.addEventListener('click', () => {
    updateTableFromGrid();
    if (tableState.data.rows.length > 1) tableState.data.rows.pop();
    renderTableGrid();
  });
  els.tableRemoveColumn.addEventListener('click', () => {
    updateTableFromGrid();
    const data = tableState.data;
    if (data.columns.length <= 1) return;
    const removed = data.columns.pop();
    data.rows.forEach((row) => { delete row.cells[removed.id]; });
    renderTableGrid();
  });
  els.tableMarkdownPreviewBtn.addEventListener('click', () => {
    try {
      tableState.data = parseMarkdownTable(els.tableMarkdownSource.value);
      els.tableMarkdownError.className = 'page-feedback error hidden';
      els.tableMarkdownError.textContent = '';
      els.tableMarkdownPreview.innerHTML = renderTableHtml(tableState.data);
    } catch (error) {
      els.tableMarkdownError.textContent = error.message;
      els.tableMarkdownError.className = 'page-feedback error';
    }
  });
  els.tableSaveTemplate.addEventListener('click', () => saveCurrentTableAsTemplate().catch((error) => reportActionError(error, 'Erreur modele tableau')));
  els.tableManageTemplates.addEventListener('click', async () => {
    await loadTableTemplates();
    renderTableTemplateManager('');
    els.tableTemplateManager.classList.remove('hidden');
  });
  els.tableTemplateManagerClose.addEventListener('click', () => els.tableTemplateManager.classList.add('hidden'));
  els.tableTemplateList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-table-template-id]');
    if (!button) return;
    const template = state.tableTemplates.find((item) => item.id === button.dataset.tableTemplateId);
    if (!template) return;
    els.tableTemplateId.value = template.is_system ? '' : template.id;
    els.tableTemplateName.value = template.name || template.title || '';
    els.tableTemplateDescription.value = template.description || '';
    els.tableTemplateCategory.value = template.category || 'Autre';
    els.tableTemplateSource.value = tableToMarkdown(template.table_data);
    renderTableTemplateManager(template.id);
  });
  els.tableTemplateForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = parseMarkdownTable(els.tableTemplateSource.value);
    data.title = els.tableTemplateName.value || data.title;
    const body = {
      name: els.tableTemplateName.value,
      description: els.tableTemplateDescription.value,
      category: els.tableTemplateCategory.value,
      table_data: data,
    };
    const id = els.tableTemplateId.value;
    await request(id ? `/tables/template-library/${id}` : '/tables/template-library', {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    await loadTableTemplates();
    renderTableTemplateOptions();
    renderTableTemplateManager(id);
    setFeedback('Modele de tableau enregistre.', 'success');
  });
  els.tableTemplateDuplicate.addEventListener('click', () => {
    els.tableTemplateId.value = '';
    els.tableTemplateName.value = `${els.tableTemplateName.value || 'Modele'} copie`;
  });
  els.tableTemplateDelete.addEventListener('click', async () => {
    const id = els.tableTemplateId.value;
    if (!id || !window.confirm('Supprimer ce modele de tableau ?')) return;
    await request(`/tables/template-library/${id}`, { method: 'DELETE' });
    await loadTableTemplates();
    renderTableTemplateOptions();
    renderTableTemplateManager('');
    els.tableTemplateId.value = '';
    els.tableTemplateName.value = '';
    els.tableTemplateDescription.value = '';
    els.tableTemplateSource.value = '';
    setFeedback('Modele de tableau supprime.', 'success');
  });
  els.diagramClose.addEventListener('click', closeDiagramModal);
  els.diagramCancel.addEventListener('click', closeDiagramModal);
  els.diagramVisualTab.addEventListener('click', () => switchDiagramMode('structured'));
  els.diagramMermaidTab.addEventListener('click', () => switchDiagramMode('mermaid'));
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
  els.mermaidLoadTemplate.addEventListener('click', () => {
    if (diagramState.mermaidDirty && !window.confirm('Le chargement d un nouveau modele remplacera le code actuel. Continuer ?')) return;
    const template = selectedMermaidTemplate();
    if (!els.mermaidTitle.value.trim()) els.mermaidTitle.value = template.title || template.name || '';
    els.mermaidSource.value = template.source;
    diagramState.data = { editor_mode: 'mermaid', schema_version: 1, title: els.mermaidTitle.value || template.title || template.name, source: template.source, rendered_svg: '' };
    diagramState.mermaidSvg = '';
    diagramState.mermaidDirty = true;
    els.mermaidPreview.innerHTML = '';
    setMermaidStatus('Modele charge. Le code est modifiable et non sauvegarde.', 'success');
  });
  els.mermaidFormat.addEventListener('click', () => {
    try {
      els.mermaidSource.value = formatMermaidSource(els.mermaidSource.value);
      diagramState.mermaidSvg = '';
      diagramState.mermaidDirty = true;
      setMermaidStatus('Code indente.', 'success');
    } catch (error) {
      setMermaidStatus(error.message, 'error');
    }
  });
  els.mermaidPreviewBtn.addEventListener('click', () => previewMermaid().catch(() => {}));
  els.mermaidExpand.addEventListener('click', () => {
    const fullscreen = els.diagramModal.classList.toggle('quality-modal-fullscreen');
    els.mermaidExpand.textContent = fullscreen ? 'Reduire l editeur' : 'Agrandir l editeur';
    setMermaidStatus(fullscreen ? 'Editeur agrandi.' : 'Editeur reduit.', 'success');
  });
  function closeMermaidFullscreen(sync = true) {
    if (sync) {
      els.mermaidTitle.value = els.mermaidFullscreenTitle.value;
      els.mermaidSource.value = els.mermaidFullscreenSource.value;
      els.mermaidPreview.innerHTML = els.mermaidFullscreenPreview.innerHTML;
      diagramState.mermaidDirty = true;
      if (diagramState.data) {
        diagramState.data.title = els.mermaidTitle.value;
        diagramState.data.source = els.mermaidSource.value;
      }
    }
    els.mermaidFullscreen.classList.add('hidden');
  }
  els.mermaidCollapse.addEventListener('click', () => closeMermaidFullscreen(true));
  els.mermaidFullscreenClose.addEventListener('click', () => closeMermaidFullscreen(true));
  els.mermaidFullscreenPreviewBtn.addEventListener('click', () => previewMermaid({
    sourceEl: els.mermaidFullscreenSource,
    previewEl: els.mermaidFullscreenPreview,
    errorEl: els.mermaidFullscreenError,
    button: els.mermaidFullscreenPreviewBtn,
  }).catch(() => {}));
  els.mermaidFullscreenSave.addEventListener('click', async () => {
    closeMermaidFullscreen(true);
    await saveDiagram().catch((error) => setFeedback(error.message, 'error'));
  });
  els.mermaidSource.addEventListener('input', () => {
    diagramState.mermaidSvg = '';
    diagramState.mermaidDirty = true;
    if (diagramState.data) diagramState.data.source = els.mermaidSource.value;
    setMermaidStatus('Code modifie. Relance la previsualisation avant enregistrement.', 'loading');
  });
  els.mermaidTitle.addEventListener('input', () => {
    if (diagramState.data) diagramState.data.title = els.mermaidTitle.value;
  });
  els.mermaidSaveTemplate.addEventListener('click', () => saveCurrentAsTemplate().catch((error) => setMermaidStatus(error.message, 'error')));
  els.mermaidManageTemplates.addEventListener('click', () => openTemplateManager().catch((error) => setMermaidStatus(error.message, 'error')));
  els.mermaidTemplateManagerClose.addEventListener('click', () => els.mermaidTemplateManager.classList.add('hidden'));
  els.mermaidTemplateList.addEventListener('click', (event) => {
    const item = event.target.closest('[data-template-id]');
    if (!item) return;
    const action = event.target.closest('[data-template-action]')?.dataset.templateAction || 'select';
    const template = state.mermaidTemplates.find((entry) => entry.id === item.dataset.templateId);
    if (!template) return;
    renderTemplateManager(item.dataset.templateId);
    fillTemplateForm(template);
    if (action === 'load') {
      if (diagramState.mermaidDirty && !window.confirm('Le chargement d un nouveau modele remplacera le code actuel. Continuer ?')) return;
      els.mermaidTitle.value = template.title || template.name || '';
      els.mermaidSource.value = template.source || '';
      diagramState.data = { editor_mode: 'mermaid', schema_version: 1, title: els.mermaidTitle.value, source: els.mermaidSource.value, rendered_svg: '' };
      diagramState.mermaidSvg = '';
      diagramState.mermaidDirty = true;
      els.mermaidTemplateManager.classList.add('hidden');
      setMermaidStatus('Modele charge.', 'success');
    }
    if (action === 'duplicate') {
      fillTemplateForm(template, true);
      setMermaidStatus('Modele duplique dans le formulaire. Enregistre pour l ajouter.', 'loading');
    }
    if (action === 'delete') {
      if (template.is_system) return;
      if (!window.confirm('Supprimer definitivement ce modele ?')) return;
      request(`/diagrams/template-library/${template.id}`, { method: 'DELETE' })
        .then(() => loadMermaidTemplates())
        .then(() => {
          renderTemplateManager();
          fillTemplateForm(state.mermaidTemplates[0]);
          setMermaidStatus('Modele supprime.', 'success');
        })
        .catch((error) => reportActionError(error, 'Erreur suppression modele'));
    }
  });
  els.mermaidTemplateDuplicate.addEventListener('click', () => {
    const template = state.mermaidTemplates.find((item) => item.id === els.mermaidTemplateId.value) || selectedMermaidTemplate();
    fillTemplateForm(template, true);
  });
  els.mermaidTemplateDelete.addEventListener('click', async () => {
    const id = els.mermaidTemplateId.value;
    if (!id || id.startsWith('system:')) return;
    if (!window.confirm('Supprimer ce modele personnalise ?')) return;
    await request(`/diagrams/template-library/${id}`, { method: 'DELETE' });
    await loadMermaidTemplates();
    renderTemplateManager();
    fillTemplateForm(state.mermaidTemplates[0]);
    setMermaidStatus('Modele supprime.', 'success');
  });
  els.mermaidTemplateForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const id = els.mermaidTemplateId.value;
    const body = {
      name: els.mermaidTemplateName.value,
      description: els.mermaidTemplateDescription.value,
      category: els.mermaidTemplateCategory.value,
      source: els.mermaidTemplateSource.value,
    };
    const saved = await request(id ? `/diagrams/template-library/${id}` : '/diagrams/template-library', {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    await loadMermaidTemplates();
    els.mermaidTemplate.value = saved.id;
    renderTemplateManager(saved.id);
    fillTemplateForm(saved);
    setMermaidStatus('Modele enregistre dans la bibliotheque.', 'success');
  });
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
  els.diagramSave.addEventListener('click', () => saveDiagram().catch((error) => reportActionError(error, 'Erreur enregistrement diagramme')));
  els.diagramDelete.addEventListener('click', async () => {
    if (!diagramState.id || !window.confirm('Supprimer ce diagramme du chapitre ? Cette action est definitive.')) return;
    try {
      await request(`/diagrams/${diagramState.id}`, { method: 'DELETE' });
      await load(state.currentId);
      closeDiagramModal();
      setFeedback('Diagramme supprime.', 'success');
    } catch (error) {
      reportActionError(error, 'Erreur suppression diagramme');
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
