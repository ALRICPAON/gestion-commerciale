const crypto = require('crypto');

const { logQualityEvent } = require('./eventLogger');
const { recordSectionVersion } = require('./qualityDocumentationVersionService');
const { stripHtml } = require('./qualityDocumentationTemplateService');

const MAX_COLUMNS = 20;
const MAX_ROWS = 500;
const MAX_TITLE_LENGTH = 160;
const MAX_LABEL_LENGTH = 120;
const MAX_CELL_LENGTH = 1000;
const ALIGNMENTS = new Set(['left', 'center', 'right']);
const TEMPLATE_CATEGORIES = Object.freeze([
  'Produits',
  'HACCP',
  'Surveillance',
  'Nettoyage',
  'Equipements',
  'Non-conformite',
  'Autre',
]);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[char]));
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  throw err;
}

function rejectHtml(value, label) {
  const text = String(value ?? '');
  if (/<[^>]+>/.test(text)) badRequest(`${label} ne doit pas contenir de HTML`);
  if (/\b(?:script|iframe|object|embed|foreignObject|javascript:|data:|on[a-z]+\s*=)\b/i.test(text)) {
    badRequest(`${label} contient une valeur non autorisee`);
  }
}

function cleanText(value, maxLength, fallback = '') {
  rejectHtml(value, 'Le texte du tableau');
  const text = String(value ?? fallback).replace(/\r\n/g, '\n').trim();
  return text.slice(0, maxLength);
}

function cleanCategory(value) {
  const category = cleanText(value, 80, 'Autre');
  return TEMPLATE_CATEGORIES.includes(category) ? category : 'Autre';
}

function slugId(value, fallback) {
  const text = String(value ?? fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return text || fallback;
}

function normalizeColumns(columns) {
  const input = Array.isArray(columns) ? columns : [];
  if (!input.length) badRequest('Le tableau doit contenir au moins une colonne');
  if (input.length > MAX_COLUMNS) badRequest(`Le tableau est limite a ${MAX_COLUMNS} colonnes`);
  const ids = new Set();
  return input.map((raw, index) => {
    const id = slugId(raw.id || raw.label, `col-${index + 1}`);
    if (ids.has(id)) badRequest(`Identifiant de colonne duplique : ${id}`);
    ids.add(id);
    return {
      id,
      label: cleanText(raw.label, MAX_LABEL_LENGTH, `Colonne ${index + 1}`),
      alignment: ALIGNMENTS.has(raw.alignment) ? raw.alignment : 'left',
      width: Number.isFinite(Number(raw.width)) && Number(raw.width) > 0 ? Number(raw.width) : null,
    };
  });
}

function normalizeRows(rows, columns) {
  const input = Array.isArray(rows) ? rows : [];
  if (input.length > MAX_ROWS) badRequest(`Le tableau est limite a ${MAX_ROWS} lignes`);
  return input.map((raw, index) => {
    const cells = {};
    columns.forEach((column) => {
      const source = raw.cells && Object.prototype.hasOwnProperty.call(raw.cells, column.id)
        ? raw.cells[column.id]
        : raw[column.id];
      cells[column.id] = cleanText(source, MAX_CELL_LENGTH);
    });
    return { id: slugId(raw.id, `row-${index + 1}`), cells };
  });
}

function normalizeTableData(input = {}) {
  const columns = normalizeColumns(input.columns);
  const rows = normalizeRows(input.rows, columns);
  return {
    schema_version: 1,
    title: cleanText(input.title, MAX_TITLE_LENGTH, 'Tableau qualite'),
    header: input.header !== false,
    columns,
    rows,
  };
}

function renderTableHtml(tableData) {
  const data = normalizeTableData(tableData);
  const colgroup = data.columns.map((column) => {
    const width = column.width ? ` style="width:${Math.min(Math.max(column.width, 4), 80)}%"` : '';
    return `<col${width}>`;
  }).join('');
  const head = data.header ? `<thead><tr>${data.columns.map((column) => `<th scope="col" class="align-${column.alignment}">${escapeHtml(column.label)}</th>`).join('')}</tr></thead>` : '';
  const bodyRows = data.rows.map((row) => `<tr>${data.columns.map((column) => `<td class="align-${column.alignment}">${escapeHtml(row.cells[column.id]).replace(/\n/g, '<br>')}</td>`).join('')}</tr>`).join('');
  const empty = data.rows.length ? '' : `<tr><td colspan="${data.columns.length}">Aucune ligne renseignee.</td></tr>`;
  return `<div class="quality-table-scroll"><table class="quality-data-table">${colgroup ? `<colgroup>${colgroup}</colgroup>` : ''}${head}<tbody>${bodyRows || empty}</tbody></table></div>`;
}

function renderTableBlock(table) {
  const data = table.table_data || table;
  const title = cleanText(table.title || data.title, MAX_TITLE_LENGTH, 'Tableau qualite');
  return `<figure class="quality-table-block" data-table-id="${escapeHtml(table.id)}" data-block-id="${escapeHtml(table.block_id)}" contenteditable="false">
    <figcaption>${escapeHtml(title)}</figcaption>
    ${renderTableHtml(data)}
  </figure>`;
}

function replaceTableBlock(contentHtml, table) {
  const block = renderTableBlock(table);
  const escapedId = String(table.id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`<figure[^>]+data-table-id=["']${escapedId}["'][\\s\\S]*?<\\/figure>`, 'i');
  if (pattern.test(contentHtml || '')) return String(contentHtml || '').replace(pattern, block);
  return `${contentHtml || ''}\n${block}`;
}

function removeTableBlock(contentHtml, tableId) {
  const escapedId = String(tableId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(contentHtml || '').replace(new RegExp(`<figure[^>]+data-table-id=["']${escapedId}["'][\\s\\S]*?<\\/figure>`, 'i'), '');
}

function productFamiliesTable() {
  return normalizeTableData({
    title: 'Familles de produits',
    columns: [
      { id: 'famille', label: 'Famille de produits' },
      { id: 'exemples', label: 'Exemples' },
      { id: 'presentation', label: 'Presentation' },
      { id: 'temperature', label: 'Temperature cible' },
      { id: 'risques', label: 'Risques principaux' },
      { id: 'surveillance', label: 'Surveillance associee' },
    ],
    rows: [
      { cells: { famille: 'Poissons entiers frais', exemples: 'Bar, dorade, lieu, merlu', presentation: 'Entier, sous glace', temperature: '0 a +2 C', risques: 'Temperature, alterabilite, tracabilite', surveillance: 'Controle reception, temperature, etiquetage' } },
      { cells: { famille: 'Filets et decoupes', exemples: 'Filets, darnes, portions', presentation: 'Bacs, caisses, sous glace', temperature: '0 a +2 C', risques: 'Manipulation, contamination croisee', surveillance: 'Hygiene, DLC/DDM, controle visuel' } },
      { cells: { famille: 'Coquillages et crustaces', exemples: 'Moules, huitres, langoustines', presentation: 'Vivant ou frais selon espece', temperature: 'Selon produit et reglementation', risques: 'Vitalite, origine, contamination', surveillance: 'Agrements, documents sanitaires, lots' } },
    ],
  });
}

function storageConditionsTable() {
  return normalizeTableData({
    title: 'Conditions de conservation',
    columns: [
      { id: 'zone', label: 'Zone / produit' },
      { id: 'temperature', label: 'Temperature' },
      { id: 'duree', label: 'Duree indicative' },
      { id: 'surveillance', label: 'Surveillance' },
      { id: 'action', label: 'Action en cas d ecart' },
    ],
    rows: [
      { cells: { zone: 'Chambre froide produits frais', temperature: '0 a +2 C', duree: 'Selon DLC ou rotation interne', surveillance: 'Releve automatique ou manuel', action: 'Isolement, verification produit, action corrective' } },
      { cells: { zone: 'Atelier de preparation', temperature: 'Temperature maitrisee', duree: 'Temps de presence limite', surveillance: 'Controle visuel et temperature ambiante', action: 'Reduction du temps d exposition, retour au froid' } },
      { cells: { zone: 'Transport frigorifique', temperature: '0 a +2 C selon produit', duree: 'Tournee de livraison', surveillance: 'Controle au chargement et livraison', action: 'Information responsable qualite et decision lot' } },
    ],
  });
}

function tableTemplates() {
  const blank = normalizeTableData({
    title: 'Nouveau tableau qualite',
    columns: [{ id: 'point', label: 'Point' }, { id: 'description', label: 'Description' }, { id: 'responsable', label: 'Responsable' }],
    rows: [{ cells: { point: '', description: '', responsable: '' } }],
  });
  return {
    blank: { id: 'system:blank', key: 'blank', name: 'Tableau vide', title: blank.title, category: 'Autre', description: 'Structure libre a completer.', table_data: blank, is_system: true },
    product_families: { id: 'system:product_families', key: 'product_families', name: 'Familles de produits', title: 'Familles de produits', category: 'Produits', description: 'Familles de produits de la peche et surveillances associees.', table_data: productFamiliesTable(), is_system: true },
    storage_conditions: { id: 'system:storage_conditions', key: 'storage_conditions', name: 'Conditions de conservation', title: 'Conditions de conservation', category: 'Surveillance', description: 'Temperatures, durees et actions correctives.', table_data: storageConditionsTable(), is_system: true },
    haccp_hazards: { id: 'system:haccp_hazards', key: 'haccp_hazards', name: 'Analyse des dangers HACCP', title: 'Analyse des dangers HACCP', category: 'HACCP', description: 'Danger, cause, mesure de maitrise et surveillance.', table_data: normalizeTableData({ title: 'Analyse des dangers HACCP', columns: [{ id: 'etape', label: 'Etape' }, { id: 'danger', label: 'Danger' }, { id: 'cause', label: 'Cause' }, { id: 'maitrise', label: 'Mesure de maitrise' }, { id: 'surveillance', label: 'Surveillance' }], rows: [{ cells: { etape: 'Reception', danger: 'Rupture de temperature', cause: 'Transport non conforme', maitrise: 'Controle temperature reception', surveillance: 'Fiche reception / ALTA' } }] }), is_system: true },
    monitoring_plan: { id: 'system:monitoring_plan', key: 'monitoring_plan', name: 'Plan de surveillance', title: 'Plan de surveillance', category: 'Surveillance', description: 'Points de controle recurrents.', table_data: normalizeTableData({ title: 'Plan de surveillance', columns: [{ id: 'point', label: 'Point surveille' }, { id: 'frequence', label: 'Frequence' }, { id: 'responsable', label: 'Responsable' }, { id: 'preuve', label: 'Preuve' }, { id: 'action', label: 'Action si ecart' }], rows: [{ cells: { point: 'Temperature chambre froide', frequence: 'Quotidienne', responsable: 'Responsable qualite', preuve: 'Releve temperature', action: 'Action corrective et evaluation produits' } }] }), is_system: true },
    cleaning_plan: { id: 'system:cleaning_plan', key: 'cleaning_plan', name: 'Plan de nettoyage', title: 'Plan de nettoyage', category: 'Nettoyage', description: 'Zone, produit, frequence et controle.', table_data: normalizeTableData({ title: 'Plan de nettoyage', columns: [{ id: 'zone', label: 'Zone' }, { id: 'operation', label: 'Operation' }, { id: 'produit', label: 'Produit' }, { id: 'frequence', label: 'Frequence' }, { id: 'controle', label: 'Controle' }], rows: [{ cells: { zone: 'Atelier', operation: 'Nettoyage et desinfection', produit: 'Produit homologue contact alimentaire', frequence: 'Chaque fin de production', controle: 'Controle visuel' } }] }), is_system: true },
    equipment_list: { id: 'system:equipment_list', key: 'equipment_list', name: 'Liste des equipements', title: 'Liste des equipements', category: 'Equipements', description: 'Equipements et maintenance.', table_data: normalizeTableData({ title: 'Liste des equipements', columns: [{ id: 'equipement', label: 'Equipement' }, { id: 'zone', label: 'Zone' }, { id: 'usage', label: 'Usage' }, { id: 'maintenance', label: 'Maintenance' }], rows: [{ cells: { equipement: 'Balance', zone: 'Preparation', usage: 'Pesage commandes', maintenance: 'Verification periodique' } }] }), is_system: true },
    corrective_actions: { id: 'system:corrective_actions', key: 'corrective_actions', name: 'Actions correctives', title: 'Actions correctives', category: 'Non-conformite', description: 'Suivi des ecarts et decisions.', table_data: normalizeTableData({ title: 'Actions correctives', columns: [{ id: 'ecart', label: 'Ecart' }, { id: 'decision', label: 'Decision' }, { id: 'responsable', label: 'Responsable' }, { id: 'delai', label: 'Delai' }, { id: 'preuve', label: 'Preuve' }], rows: [{ cells: { ecart: 'Temperature hors limite', decision: 'Isolement du lot et evaluation', responsable: 'Qualite', delai: 'Immediat', preuve: 'Fiche non-conformite' } }] }), is_system: true },
  };
}

function systemTemplateRows() {
  return Object.values(tableTemplates()).map((template) => ({
    id: template.id,
    store_id: null,
    name: template.name,
    title: template.title,
    description: template.description,
    category: template.category,
    table_data: template.table_data,
    is_system: true,
    created_at: null,
    updated_at: null,
  }));
}

async function getSection(db, storeId, sectionId) {
  const result = await db.query('SELECT * FROM quality_documentation_sections WHERE id = $1 AND store_id = $2 LIMIT 1', [sectionId, storeId]);
  return result.rows[0] || null;
}

async function listTables(db, storeId, sectionId) {
  const result = await db.query(
    `SELECT * FROM quality_document_tables
     WHERE store_id = $1 AND section_id = $2 AND archived_at IS NULL
     ORDER BY created_at ASC`,
    [storeId, sectionId]
  );
  return result.rows;
}

async function listTableTemplates(db, storeId) {
  const custom = await db.query(
    `SELECT id, store_id, name, name AS title, description, category, table_data, is_system, created_at, updated_at
     FROM quality_document_table_templates
     WHERE archived_at IS NULL AND store_id = $1
     ORDER BY category ASC, name ASC`,
    [storeId]
  ).catch((err) => {
    if (err.code === '42P01' || err.code === '42703') return { rows: [] };
    throw err;
  });
  return [...systemTemplateRows(), ...custom.rows];
}

async function createTableTemplate(db, storeId, userId, body = {}) {
  const name = cleanText(body.name, 120);
  if (!name) badRequest('Nom du modele obligatoire');
  const tableData = normalizeTableData(body.table_data || body);
  const result = await db.query(
    `INSERT INTO quality_document_table_templates
     (store_id, name, description, category, table_data, is_system, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5::jsonb,false,$6,$6)
     RETURNING id, store_id, name, name AS title, description, category, table_data, is_system, created_at, updated_at`,
    [storeId, name, cleanText(body.description, 500), cleanCategory(body.category), JSON.stringify(tableData), userId]
  );
  return result.rows[0];
}

async function updateTableTemplate(db, storeId, templateId, userId, body = {}) {
  if (String(templateId).startsWith('system:')) badRequest('Les modeles systeme ne sont pas modifiables');
  const before = await db.query(
    `SELECT * FROM quality_document_table_templates
     WHERE id = $1 AND store_id = $2 AND is_system = false AND archived_at IS NULL
     LIMIT 1`,
    [templateId, storeId]
  );
  if (!before.rows[0]) return null;
  const name = cleanText(body.name ?? before.rows[0].name, 120);
  if (!name) badRequest('Nom du modele obligatoire');
  const tableData = normalizeTableData(body.table_data || before.rows[0].table_data);
  const result = await db.query(
    `UPDATE quality_document_table_templates
     SET name = $3, description = $4, category = $5, table_data = $6::jsonb, updated_by = $7, updated_at = now()
     WHERE id = $1 AND store_id = $2 AND is_system = false AND archived_at IS NULL
     RETURNING id, store_id, name, name AS title, description, category, table_data, is_system, created_at, updated_at`,
    [templateId, storeId, name, cleanText(body.description ?? before.rows[0].description, 500), cleanCategory(body.category ?? before.rows[0].category), JSON.stringify(tableData), userId]
  );
  return result.rows[0] || null;
}

async function deleteTableTemplate(db, storeId, templateId, userId) {
  if (String(templateId).startsWith('system:')) badRequest('Les modeles systeme ne sont pas supprimables');
  const result = await db.query(
    `UPDATE quality_document_table_templates
     SET archived_at = COALESCE(archived_at, now()), updated_by = $3, updated_at = now()
     WHERE id = $1 AND store_id = $2 AND is_system = false AND archived_at IS NULL
     RETURNING id, store_id, name, name AS title, description, category, table_data, is_system, created_at, updated_at`,
    [templateId, storeId, userId]
  );
  return result.rows[0] || null;
}

async function createTable(db, storeId, sectionId, userId, body = {}) {
  const section = await getSection(db, storeId, sectionId);
  if (!section) return null;
  const template = tableTemplates()[body.template_key];
  const data = normalizeTableData(body.table_data || template?.table_data || tableTemplates().blank.table_data);
  const blockId = body.block_id || `table-${crypto.randomUUID()}`;
  const result = await db.query(
    `INSERT INTO quality_document_tables
     (store_id, collection_id, section_id, block_id, title, table_type, schema_version, table_data, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,1,$7::jsonb,$8,$8)
     RETURNING *`,
    [storeId, section.collection_id, sectionId, blockId, data.title, body.table_type || 'generic', JSON.stringify(data), userId]
  );
  const table = result.rows[0];
  const updatedHtml = replaceTableBlock(section.content_html, table);
  const updated = await db.query(
    `UPDATE quality_documentation_sections
     SET content_html = $3, content_text = $4, updated_by = $5, updated_at = now()
     WHERE id = $1 AND store_id = $2
     RETURNING *`,
    [sectionId, storeId, updatedHtml, stripHtml(updatedHtml), userId]
  );
  await recordSectionVersion(db, storeId, updated.rows[0], userId, `Insertion du tableau ${data.title}`, 'table_create', section);
  await logQualityEvent({ dbPool: db, storeId, actorId: userId, eventType: 'quality.documentation.table.created', targetType: 'quality_document_table', targetId: table.id, after: table });
  return { ...table, block_html: renderTableBlock(table) };
}

async function updateTable(db, storeId, tableId, userId, body = {}) {
  const beforeResult = await db.query('SELECT * FROM quality_document_tables WHERE id = $1 AND store_id = $2 AND archived_at IS NULL LIMIT 1', [tableId, storeId]);
  const before = beforeResult.rows[0];
  if (!before) return null;
  const section = await getSection(db, storeId, before.section_id);
  if (!section) return null;
  const data = normalizeTableData(body.table_data || before.table_data);
  const updatedResult = await db.query(
    `UPDATE quality_document_tables
     SET title = $3, table_type = $4, table_data = $5::jsonb, updated_by = $6, updated_at = now()
     WHERE id = $1 AND store_id = $2
     RETURNING *`,
    [tableId, storeId, data.title, body.table_type || before.table_type || 'generic', JSON.stringify(data), userId]
  );
  const table = updatedResult.rows[0];
  const updatedHtml = replaceTableBlock(section.content_html, table);
  const updatedSection = await db.query(
    `UPDATE quality_documentation_sections
     SET content_html = $3, content_text = $4, updated_by = $5, updated_at = now()
     WHERE id = $1 AND store_id = $2
     RETURNING *`,
    [section.id, storeId, updatedHtml, stripHtml(updatedHtml), userId]
  );
  await recordSectionVersion(db, storeId, updatedSection.rows[0], userId, `Modification du tableau ${data.title}`, 'table_update', section);
  await logQualityEvent({ dbPool: db, storeId, actorId: userId, eventType: 'quality.documentation.table.updated', targetType: 'quality_document_table', targetId: table.id, before, after: table });
  return { ...table, block_html: renderTableBlock(table) };
}

async function archiveTable(db, storeId, tableId, userId) {
  const beforeResult = await db.query('SELECT * FROM quality_document_tables WHERE id = $1 AND store_id = $2 AND archived_at IS NULL LIMIT 1', [tableId, storeId]);
  const before = beforeResult.rows[0];
  if (!before) return null;
  const section = await getSection(db, storeId, before.section_id);
  const result = await db.query(
    `UPDATE quality_document_tables
     SET archived_at = COALESCE(archived_at, now()), updated_by = $3, updated_at = now()
     WHERE id = $1 AND store_id = $2
     RETURNING *`,
    [tableId, storeId, userId]
  );
  if (section) {
    const updatedHtml = removeTableBlock(section.content_html, tableId);
    const updatedSection = await db.query(
      `UPDATE quality_documentation_sections SET content_html = $3, content_text = $4, updated_by = $5, updated_at = now()
       WHERE id = $1 AND store_id = $2 RETURNING *`,
      [section.id, storeId, updatedHtml, stripHtml(updatedHtml), userId]
    );
    await recordSectionVersion(db, storeId, updatedSection.rows[0], userId, `Suppression du tableau ${before.title}`, 'table_delete', section);
  }
  return result.rows[0];
}

async function duplicateTable(db, storeId, tableId, userId) {
  const sourceResult = await db.query('SELECT * FROM quality_document_tables WHERE id = $1 AND store_id = $2 AND archived_at IS NULL LIMIT 1', [tableId, storeId]);
  const source = sourceResult.rows[0];
  if (!source) return null;
  const data = normalizeTableData({ ...source.table_data, title: `${source.title} - copie` });
  return createTable(db, storeId, source.section_id, userId, { table_data: data, table_type: source.table_type });
}

async function ensureDefaultProductTables(db, storeId, userId) {
  const sectionResult = await db.query(
    `SELECT * FROM quality_documentation_sections
     WHERE store_id = $1 AND code = 'T4-C03' AND archived_at IS NULL
     LIMIT 1`,
    [storeId]
  ).catch((err) => {
    if (err.code === '42P01' || err.code === '42703') return { rows: [] };
    throw err;
  });
  const section = sectionResult.rows[0];
  if (!section) return [];
  const created = [];
  for (const data of [productFamiliesTable(), storageConditionsTable()]) {
    const existing = await db.query(
      `SELECT * FROM quality_document_tables
       WHERE store_id = $1 AND section_id = $2 AND archived_at IS NULL AND title = $3
       LIMIT 1`,
      [storeId, section.id, data.title]
    ).catch((err) => {
      if (err.code === '42P01' || err.code === '42703') return { rows: [] };
      throw err;
    });
    if (!existing.rows[0]) created.push(await createTable(db, storeId, section.id, userId, { table_data: data, table_type: 'product' }));
  }
  return created;
}

module.exports = {
  MAX_COLUMNS,
  MAX_ROWS,
  archiveTable,
  createTable,
  createTableTemplate,
  deleteTableTemplate,
  duplicateTable,
  ensureDefaultProductTables,
  listTableTemplates,
  listTables,
  normalizeTableData,
  productFamiliesTable,
  renderTableBlock,
  renderTableHtml,
  storageConditionsTable,
  tableTemplates,
  updateTable,
  updateTableTemplate,
};
