const documentation = require('./qualityDocumentationService');
const blocks = require('./qualityDocumentBlockService');
const tables = require('./qualityDocumentationTableService');
const diagrams = require('./qualityDocumentationDiagramService');
const documents = require('./documents');
const digitalTwin = require('./digitalTwin');
const temperatures = require('./temperatures');
const cleaning = require('./cleaning');
const tasks = require('./tasks');
const versions = require('./qualityDocumentationVersionService');

function text(value) {
  return String(value || '').trim();
}

function stripHtml(value = '') {
  return String(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function limit(value, fallback = 50, max = 200) {
  const parsed = Number(value);
  return Math.min(Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback, max);
}

async function findQualitySection(db, storeId, input = {}) {
  const query = text(input.section_id || input.code || input.query);
  if (!query) return null;
  const result = await db.query(
    `SELECT *
     FROM quality_documentation_sections
     WHERE store_id = $1
       AND archived_at IS NULL
       AND (id::text = $2 OR LOWER(COALESCE(code, '')) = LOWER($2) OR LOWER(COALESCE(title, '')) LIKE LOWER($3))
     ORDER BY CASE WHEN LOWER(COALESCE(code, '')) = LOWER($2) THEN 0 ELSE 1 END, display_order ASC
     LIMIT 1`,
    [storeId, query, `%${query}%`]
  );
  return result.rows[0] || null;
}

async function getQualitySectionContext(db, storeId, input = {}) {
  const section = await findQualitySection(db, storeId, input);
  if (!section) return null;
  const doc = await documentation.getDocumentation(db, storeId, section.collection_id);
  const [
    sectionBlocks,
    sectionTables,
    sectionDiagrams,
    sectionVersions,
    qualityDocuments,
    qualityPhotos,
  ] = await Promise.all([
    blocks.listChapterBlocks(db, storeId, section.id).catch(() => []),
    tables.listTables(db, storeId, section.id).catch(() => []),
    diagrams.listDiagrams(db, storeId, section.id).catch(() => []),
    versions.listSectionVersions(db, storeId, section.id).catch(() => []),
    documents.listDocuments(db, storeId, { owner_type: 'documentation_section', owner_id: section.id }).catch(() => []),
    documents.listPhotos(db, storeId, { owner_type: 'documentation_section', owner_id: section.id }).catch(() => []),
  ]);
  return {
    section,
    collection: doc?.collection || null,
    outline: (doc?.sections || []).filter((row) => !row.archived_at).map((row) => ({
      id: row.id,
      parent_id: row.parent_id,
      code: row.code,
      title: row.title,
      section_type: row.section_type,
      status: row.status,
      version: row.version,
    })),
    sibling_sections: (doc?.sections || []).filter((row) => !row.archived_at && row.parent_id === section.parent_id && row.id !== section.id).slice(0, 20),
    related_sections: (doc?.sections || []).filter((row) => !row.archived_at && row.id !== section.id).slice(0, 30),
    blocks: sectionBlocks,
    tables: sectionTables,
    diagrams: sectionDiagrams,
    attachments: (doc?.attachments || []).filter((item) => item.section_id === section.id),
    documents: qualityDocuments,
    photos: qualityPhotos,
    missing_items: (doc?.missing_items || []).filter((item) => item.section_id === section.id),
    versions: sectionVersions,
    exports: doc?.exports || [],
  };
}

async function getQualityContext(db, storeId, input = {}) {
  const rowLimit = limit(input.limit, 50, 200);
  const [zones, equipments, temperatureRecords, temperatureSummary, cleaningRecords, cleaningSummary, qualityTasks, taskSummary, qualityDocuments, photos] = await Promise.all([
    digitalTwin.listZones(db, storeId, { limit: rowLimit }).catch(() => []),
    digitalTwin.listEquipments(db, storeId, { limit: rowLimit }).catch(() => []),
    temperatures.listTemperatureRecords(db, storeId, { limit: rowLimit }).catch(() => []),
    temperatures.getTemperatureSummary(db, storeId).catch(() => ({})),
    cleaning.listCleaningRecords(db, storeId, { limit: rowLimit }).catch(() => []),
    cleaning.getCleaningSummary(db, storeId).catch(() => ({})),
    tasks.listQualityTasks(db, storeId, { limit: rowLimit }).catch(() => []),
    tasks.getQualityTaskSummary(db, storeId).catch(() => ({})),
    documents.listDocuments(db, storeId, { limit: rowLimit }).catch(() => []),
    documents.listPhotos(db, storeId, { limit: rowLimit }).catch(() => []),
  ]);
  return {
    zones,
    equipments,
    temperature_records: temperatureRecords,
    temperature_summary: temperatureSummary,
    cleaning_records: cleaningRecords,
    cleaning_summary: cleaningSummary,
    tasks: qualityTasks,
    task_summary: taskSummary,
    documents: qualityDocuments,
    photos,
    source_freshness: {
      generated_at: new Date().toISOString(),
      last_alta_update_at: [
        ...temperatureRecords,
        ...cleaningRecords,
        ...qualityTasks,
        ...qualityDocuments,
        ...photos,
      ].map((item) => item.updated_at || item.created_at || item.recorded_at || item.performed_at).filter(Boolean).sort().pop() || null,
      last_pennylane_sync_at: null,
      last_bank_sync_at: null,
    },
  };
}

function bullet(label, values) {
  const cleaned = values.filter(Boolean);
  if (!cleaned.length) return '';
  return `<li><strong>${label}</strong> : ${cleaned.join(', ')}</li>`;
}

async function draftQualitySection(db, storeId, input = {}) {
  const sectionContext = await getQualitySectionContext(db, storeId, input);
  if (!sectionContext) {
    const error = new Error('Chapitre qualite introuvable');
    error.status = 404;
    error.expose = true;
    throw error;
  }
  const globalContext = await getQualityContext(db, storeId, { limit: 80 });
  const confirmed = [];
  const missing = [];
  const section = sectionContext.section;
  const title = section.title || input.topic || 'Chapitre qualite';
  const zones = globalContext.zones.map((zone) => zone.name || zone.label).filter(Boolean).slice(0, 12);
  const equipments = globalContext.equipments.map((item) => item.name || item.label).filter(Boolean).slice(0, 12);
  const tempCount = globalContext.temperature_records.length;
  const cleaningCount = globalContext.cleaning_records.length;
  const taskCount = globalContext.tasks.length;

  confirmed.push(`Chapitre lu: ${section.code || ''} ${title}`.trim());
  if (section.content_text || section.content_html) confirmed.push('Contenu existant du chapitre disponible.');
  if (sectionContext.blocks.length) confirmed.push(`${sectionContext.blocks.length} bloc(s) structure(s) rattache(s).`);
  if (sectionContext.tables.length) confirmed.push(`${sectionContext.tables.length} tableau(x) rattache(s).`);
  if (sectionContext.diagrams.length) confirmed.push(`${sectionContext.diagrams.length} diagramme(s) rattache(s).`);
  if (zones.length) confirmed.push(`${zones.length} zone(s) qualite disponibles.`);
  else missing.push('[INFORMATION A CONFIRMER] Zones qualite concernees.');
  if (equipments.length) confirmed.push(`${equipments.length} equipement(s) qualite disponibles.`);
  else missing.push('[INFORMATION A CONFIRMER] Equipements concernes.');
  if (!sectionContext.attachments.length && !sectionContext.documents.length) missing.push('[DOCUMENT A JOINDRE] Piece justificative specifique au chapitre.');

  const proposedHtml = [
    `<h2>${section.code ? `${section.code} - ` : ''}${title}</h2>`,
    '<h3>Objet et perimetre</h3>',
    `<p>Ce chapitre decrit l organisation appliquee par ALTA MAREE pour ${stripHtml(title).toLowerCase()}. Il est redige a partir des donnees deja presentes dans le module Qualite et du dossier documentaire existant.</p>`,
    '<h3>Donnees ALTA utilisees</h3>',
    '<ul>',
    bullet('Zones identifiees', zones),
    bullet('Equipements identifies', equipments),
    `<li><strong>Releves de temperature consultes</strong> : ${tempCount}</li>`,
    `<li><strong>Enregistrements de nettoyage consultes</strong> : ${cleaningCount}</li>`,
    `<li><strong>Taches qualite consultees</strong> : ${taskCount}</li>`,
    `<li><strong>Pieces jointes du chapitre</strong> : ${sectionContext.attachments.length + sectionContext.documents.length}</li>`,
    '</ul>',
    '<h3>Organisation operationnelle</h3>',
    '<p>Les controles sont suivis dans ALTA par zone, equipement et tache qualite. Les releves et enregistrements disponibles doivent etre conserves comme preuves d execution et rapproches du chapitre lors des revues qualite.</p>',
    '<h3>Preuves et suivis disponibles</h3>',
    '<ul>',
    `<li>Tableaux rattaches au chapitre : ${sectionContext.tables.map((item) => item.title || item.name).filter(Boolean).join(', ') || '[DOCUMENT A JOINDRE]'}</li>`,
    `<li>Diagrammes rattaches au chapitre : ${sectionContext.diagrams.map((item) => item.title || item.name).filter(Boolean).join(', ') || '[DOCUMENT A JOINDRE]'}</li>`,
    `<li>Versions historiques disponibles : ${sectionContext.versions.length}</li>`,
    '</ul>',
    '<h3>Informations a confirmer</h3>',
    `<ul>${missing.map((item) => `<li>${item}</li>`).join('') || '<li>Aucune information bloquante identifiee dans les donnees lues.</li>'}</ul>`,
  ].filter(Boolean).join('');

  return {
    section: sectionContext.section,
    proposed_html: proposedHtml,
    proposed_text: stripHtml(proposedHtml),
    confirmed_information: confirmed,
    missing_information: missing,
    context: {
      section: sectionContext,
      quality: globalContext,
    },
  };
}

async function previewQualitySectionUpdate(db, storeId, input = {}) {
  const draft = input.content_html
    ? { ...(await getQualitySectionContext(db, storeId, input)), proposed_html: input.content_html, missing_information: [] }
    : await draftQualitySection(db, storeId, input);
  const section = draft.section;
  return {
    section_id: section.id,
    code: section.code,
    title: section.title,
    before: {
      content_html: section.content_html || '',
      content_text: section.content_text || stripHtml(section.content_html || ''),
      version: section.version,
    },
    after: {
      content_html: draft.proposed_html,
      content_text: stripHtml(draft.proposed_html),
    },
    confirmed_information: draft.confirmed_information || [],
    missing_information: draft.missing_information || [],
  };
}

module.exports = {
  draftQualitySection,
  findQualitySection,
  getQualityContext,
  getQualitySectionContext,
  previewQualitySectionUpdate,
};
