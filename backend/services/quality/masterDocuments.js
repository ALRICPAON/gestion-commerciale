const fs = require('fs');
const crypto = require('crypto');

const { renderHtmlToPdf } = require('../pdf/pdfRenderer');
const { escapeHtml, fileSafe, formatDate, htmlDocument } = require('../pdf/pdfLayout');
const { getCompanyIdentity } = require('./companyIdentityService');
const { logQualityEvent } = require('./eventLogger');

const STATUSES = new Set(['draft', 'valid', 'expired', 'replaced', 'archived']);
const SOURCE_TYPES = new Set(['CCI', 'laboratoire', 'prestataire', 'administration', 'fournisseur', 'interne']);
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const STRUCTURED_SECTIONS = Object.freeze([
  ['object', 'Objet'],
  ['scope', "Champ d'application"],
  ['responsibilities', 'Responsabilites'],
  ['method', 'Methode'],
  ['frequency', 'Frequence'],
  ['limits_objectives', 'Limites et objectifs'],
  ['deviation_handling', 'Gestion des ecarts'],
  ['associated_records', 'Enregistrements associes'],
  ['associated_documents', 'Documents associes'],
  ['associated_chapters', 'Chapitres associes'],
  ['quality_links', 'Objets qualite associes'],
]);
const ATTACHMENT_SOURCES = Object.freeze({
  quality_documentation_attachment: {
    table: 'quality_documentation_attachments',
    idColumn: 'id',
    titleColumn: 'filename',
    originalFilenameColumn: 'original_filename',
    pathColumn: 'file_path',
    mimeColumn: 'mime_type',
    sizeColumn: 'file_size',
    extraSelect: 'section_id',
  },
  quality_document: {
    table: 'quality_documents',
    idColumn: 'id',
    titleColumn: 'name',
    originalFilenameColumn: 'original_filename',
    pathColumn: 'storage_path',
    mimeColumn: 'mime_type',
    sizeColumn: 'file_size',
    extraSelect: 'owner_type, owner_id',
  },
  quality_photo: {
    table: 'quality_photos',
    idColumn: 'id',
    titleColumn: 'caption',
    originalFilenameColumn: 'original_filename',
    pathColumn: 'storage_path',
    mimeColumn: 'mime_type',
    sizeColumn: 'file_size',
    extraSelect: 'owner_type, owner_id',
  },
});

function cleanText(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function parseMaybeJson(value) {
  if (!value || typeof value !== 'string') return null;
  const text = value.trim();
  if (!text.startsWith('{') && !text.startsWith('[')) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
}

function normalizeStructuredContent(description) {
  const parsed = parseMaybeJson(description);
  const content = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  const sections = {};
  STRUCTURED_SECTIONS.forEach(([key]) => { sections[key] = cleanText(content[key], ''); });
  if (!Object.values(sections).some(Boolean) && description) {
    sections.object = cleanText(description, '');
  }
  return {
    ...sections,
    raw_description: cleanText(content.raw_description, parsed ? '' : cleanText(description, '')),
  };
}

function uniqueUuidList(value) {
  return [...new Set(String(value || '').match(UUID_PATTERN) || [])];
}

function hasUuid(value) {
  return UUID_PATTERN.test(String(value || ''));
}

function resetUuidPattern() {
  UUID_PATTERN.lastIndex = 0;
}

function businessUrl(targetType, row) {
  if (!row?.id) return null;
  return {
    documentation_section: `documentation.html?sectionId=${encodeURIComponent(row.id)}`,
    temperature_parameter: `temperature-settings.html?parameter_id=${encodeURIComponent(row.id)}`,
    cleaning_plan: `cleaning-plans.html?plan_id=${encodeURIComponent(row.id)}`,
    quality_task: `quality-tasks.html?task_id=${encodeURIComponent(row.id)}`,
    non_conformity: `non-conformities.html?id=${encodeURIComponent(row.id)}`,
    corrective_action: `corrective-actions.html?id=${encodeURIComponent(row.id)}`,
  }[targetType] || null;
}

const UUID_LABEL_QUERIES = Object.freeze({
  cleaning_plan: {
    sql: `SELECT id, title AS label, configuration_status AS status FROM quality_cleaning_plans WHERE store_id=$1::uuid AND id = ANY($2::uuid[])`,
    type_label: 'Plan de nettoyage',
  },
  temperature_parameter: {
    sql: `SELECT l.id,
                 CONCAT_WS(' - ', l.type_code, z.code, e.code) AS label,
                 CASE WHEN l.is_active THEN 'actif' ELSE 'inactif' END AS status
          FROM quality_temperature_limits l
          LEFT JOIN quality_zones z ON z.id = l.zone_id AND z.store_id = l.store_id
          LEFT JOIN quality_equipments e ON e.id = l.equipment_id AND e.store_id = l.store_id
          WHERE l.store_id=$1::uuid AND l.id = ANY($2::uuid[])`,
    type_label: 'Parametre temperature',
  },
  quality_task: {
    sql: `SELECT id, title AS label, status FROM quality_tasks WHERE store_id=$1::uuid AND id = ANY($2::uuid[])`,
    type_label: 'Tache qualite',
  },
  documentation_section: {
    sql: `SELECT id, CONCAT_WS(' - ', code, title) AS label, status FROM quality_documentation_sections WHERE store_id=$1::uuid AND id = ANY($2::uuid[])`,
    type_label: 'Chapitre documentaire',
  },
  equipment: {
    sql: `SELECT id, CONCAT_WS(' - ', code, name) AS label, status FROM quality_equipments WHERE store_id=$1::uuid AND id = ANY($2::uuid[])`,
    type_label: 'Equipement',
  },
  zone: {
    sql: `SELECT id, CONCAT_WS(' - ', code, name) AS label, status FROM quality_zones WHERE store_id=$1::uuid AND id = ANY($2::uuid[])`,
    type_label: 'Zone',
  },
});

async function resolveUuidDictionary(db, storeId, ids = []) {
  const uniqueIds = [...new Set(ids)].filter(Boolean);
  const labels = new Map();
  if (!uniqueIds.length) return labels;
  for (const [targetType, config] of Object.entries(UUID_LABEL_QUERIES)) {
    try {
      const result = await db.query(config.sql, [storeId, uniqueIds]);
      result.rows.forEach((row) => {
        if (!row.id || labels.has(String(row.id))) return;
        labels.set(String(row.id), {
          id: row.id,
          target_type: targetType,
          type_label: config.type_label,
          label: row.label || config.type_label,
          status: row.status || null,
          url: businessUrl(targetType, row),
        });
      });
    } catch (err) {
      // Some installations may not have every optional table yet; unresolved ids are hidden later.
    }
  }
  return labels;
}

function resolveTextWithLabels(value, labels) {
  resetUuidPattern();
  const text = String(value || '');
  const ids = uniqueUuidList(text);
  if (!ids.length) return text;
  const resolved = ids.map((id) => labels.get(id)).filter(Boolean);
  if (resolved.length === ids.length && text.replace(UUID_PATTERN, '').replace(/[,\s;:\-–—|/()[\]]/g, '').length < 18) {
    return resolved.map((item) => `- ${item.label}`).join('\n');
  }
  return text.replace(UUID_PATTERN, (id) => labels.get(id)?.label || '[identifiant masque]');
}

async function resolveStructuredContent(db, storeId, structuredContent = {}) {
  const ids = [];
  Object.values(structuredContent).forEach((value) => ids.push(...uniqueUuidList(value)));
  const labels = await resolveUuidDictionary(db, storeId, ids);
  const resolved = {};
  Object.entries(structuredContent).forEach(([key, value]) => {
    resolved[key] = typeof value === 'string' ? resolveTextWithLabels(value, labels) : value;
  });
  return resolved;
}

function enrichDocument(document) {
  if (!document) return document;
  return {
    ...document,
    structured_content: normalizeStructuredContent(document.description),
    validity_status: document.archived_at
      ? 'archived'
      : (document.status === 'valid' && document.valid_until && new Date(document.valid_until) < new Date() ? 'expired' : document.status),
  };
}

function groupReferences(references = [], derived = {}) {
  const groups = [
    ['documentation_section', "Chapitres du dossier d'agrement"],
    ['temperature_parameter', 'Parametres de temperature'],
    ['cleaning_plan', 'Plans de nettoyage'],
    ['quality_task', 'Taches et occurrences associees'],
    ['records', 'Enregistrements realises'],
    ['quality_issues', 'Non-conformites et actions correctives'],
    ['document', 'Documents et formulaires associes'],
  ];
  const byKey = new Map(groups.map(([key, title]) => [key, { key, title, items: [] }]));
  references.filter((reference) => !reference.archived_at).forEach((reference) => {
    const key = ['non_conformity', 'corrective_action'].includes(reference.target_type)
      ? 'quality_issues'
      : byKey.has(reference.target_type) ? reference.target_type : 'document';
    byKey.get(key).items.push(reference);
  });
  (derived.tasks || []).forEach((item) => byKey.get('quality_task').items.push(item));
  (derived.records || []).forEach((item) => byKey.get('records').items.push(item));
  return [...byKey.values()].filter((group) => group.items.length);
}

async function enrichDocumentForPresentation(db, storeId, document) {
  const enriched = enrichDocument(document);
  if (!enriched) return enriched;
  enriched.structured_content = await resolveStructuredContent(db, storeId, enriched.structured_content || {});
  enriched.derived_relations = await deriveDocumentRelations(db, storeId, enriched.references || []);
  enriched.reference_groups = groupReferences(enriched.references || [], enriched.derived_relations);
  return enriched;
}

function typedLabel(targetType) {
  return {
    documentation_section: 'Chapitre documentaire',
    document_block: 'Bloc documentaire',
    quality_object: 'Objet qualite',
    temperature: 'Releve temperature',
    cleaning: 'Nettoyage realise',
    cleaning_plan: 'Plan de nettoyage',
    temperature_parameter: 'Parametre temperature',
    non_conformity: 'Non-conformite',
    corrective_action: 'Action corrective',
    ddpp_view: 'Vue DDPP',
    procedure: 'Procedure',
  }[targetType] || targetType || 'Reference';
}

const TARGET_LABEL_QUERIES = Object.freeze({
  documentation_section: {
    sql: `SELECT id, code, title FROM quality_documentation_sections WHERE id = $1::uuid AND store_id = $2::uuid LIMIT 1`,
    label: (row) => [row.code, row.title].filter(Boolean).join(' - '),
    url: (row) => `documentation.html?sectionId=${encodeURIComponent(row.id)}`,
  },
  temperature_parameter: {
    sql: `SELECT l.id, l.type_code, z.code AS zone_code, e.code AS equipment_code
          FROM quality_temperature_limits l
          LEFT JOIN quality_zones z ON z.id = l.zone_id AND z.store_id = l.store_id
          LEFT JOIN quality_equipments e ON e.id = l.equipment_id AND e.store_id = l.store_id
          WHERE l.id = $1::uuid AND l.store_id = $2::uuid LIMIT 1`,
    label: (row) => [row.type_code, row.zone_code, row.equipment_code].filter(Boolean).join(' - '),
    url: (row) => `temperature-settings.html?parameter_id=${encodeURIComponent(row.id)}`,
  },
  cleaning_plan: {
    sql: `SELECT id, title FROM quality_cleaning_plans WHERE id = $1::uuid AND store_id = $2::uuid LIMIT 1`,
    label: (row) => row.title,
    url: (row) => `cleaning-plans.html?id=${encodeURIComponent(row.id)}`,
  },
  non_conformity: {
    sql: `SELECT id, title, description FROM quality_non_conformities WHERE id = $1::uuid AND store_id = $2::uuid LIMIT 1`,
    label: (row) => row.title || row.description,
    url: (row) => `non-conformities.html?id=${encodeURIComponent(row.id)}`,
  },
  corrective_action: {
    sql: `SELECT id, action FROM quality_corrective_actions WHERE id = $1::uuid AND store_id = $2::uuid LIMIT 1`,
    label: (row) => row.action,
    url: (row) => `corrective-actions.html?id=${encodeURIComponent(row.id)}`,
  },
});

function cleanDate(value) {
  const text = cleanText(value);
  return text && /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function cleanInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function normalizeStatus(value, fallback = 'draft') {
  const status = cleanText(value, fallback);
  return STATUSES.has(status) ? status : fallback;
}

function normalizeSourceType(value, fallback = 'interne') {
  const sourceType = cleanText(value, fallback);
  return SOURCE_TYPES.has(sourceType) ? sourceType : fallback;
}

function masterPayload(body = {}) {
  return {
    title: cleanText(body.title, 'Document maitre qualite'),
    document_type: cleanText(body.document_type || body.type, 'external_evidence'),
    category: cleanText(body.category),
    source_type: normalizeSourceType(body.source_type),
    issuer_name: cleanText(body.issuer_name),
    reference_number: cleanText(body.reference_number),
    issue_date: cleanDate(body.issue_date),
    valid_from: cleanDate(body.valid_from),
    valid_until: cleanDate(body.valid_until),
    version: cleanText(body.version, '1.0'),
    status: normalizeStatus(body.status),
    original_filename: cleanText(body.original_filename),
    storage_path: cleanText(body.storage_path || body.file_path),
    mime_type: cleanText(body.mime_type),
    file_size: body.file_size === undefined || body.file_size === null || body.file_size === '' ? null : Number(body.file_size),
    checksum_sha256: cleanText(body.checksum_sha256)?.toLowerCase() || null,
    description: cleanText(body.description),
    source_attachment_table: cleanText(body.source_attachment_table),
    source_attachment_id: cleanText(body.source_attachment_id),
  };
}

function referencePayload(body = {}) {
  return {
    document_id: cleanText(body.document_id || body.master_document_id),
    target_type: cleanText(body.target_type),
    target_id: cleanText(body.target_id),
    relation_type: cleanText(body.relation_type, 'reference'),
    label: cleanText(body.label),
    sort_order: cleanInteger(body.sort_order, 0),
  };
}

async function checksumFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function getExistingAttachment(db, storeId, sourceType, sourceId) {
  const source = ATTACHMENT_SOURCES[sourceType];
  if (!source || !sourceId) {
    const err = new Error('Source de piece jointe invalide');
    err.status = 400;
    throw err;
  }
  const result = await db.query(
    `SELECT ${source.idColumn} AS id,
            ${source.titleColumn} AS title,
            ${source.originalFilenameColumn} AS original_filename,
            ${source.pathColumn} AS storage_path,
            ${source.mimeColumn} AS mime_type,
            ${source.sizeColumn} AS file_size,
            ${source.extraSelect}
     FROM ${source.table}
     WHERE ${source.idColumn} = $1::uuid AND store_id = $2::uuid
     LIMIT 1`,
    [sourceId, storeId]
  );
  if (!result.rows[0]) {
    const err = new Error('Piece jointe existante introuvable pour ce magasin');
    err.status = 404;
    throw err;
  }
  return { ...result.rows[0], source_attachment_table: source.table, source_attachment_id: sourceId };
}

async function listMasterDocuments(db, storeId, query = {}) {
  const params = [storeId];
  const where = ['d.store_id = $1::uuid'];
  if (!['true', '1', 'yes'].includes(String(query.include_archived || '').toLowerCase())) {
    where.push('d.archived_at IS NULL');
  }
  if (query.status) {
    params.push(query.status);
    where.push(`d.status = $${params.length}::text`);
  }
  if (query.document_type) {
    params.push(query.document_type);
    where.push(`d.document_type = $${params.length}::text`);
  }
  if (query.category) {
    params.push(query.category);
    where.push(`d.category = $${params.length}::text`);
  }
  if (query.source_type) {
    params.push(query.source_type);
    where.push(`d.source_type = $${params.length}::text`);
  }
  if (query.validity === 'current') {
    where.push("(d.valid_until IS NULL OR d.valid_until >= CURRENT_DATE)");
    where.push("d.status = 'valid'");
  } else if (query.validity === 'expired') {
    where.push("(d.status = 'expired' OR d.valid_until < CURRENT_DATE)");
  }
  if (query.query) {
    params.push(`%${String(query.query).trim()}%`);
    where.push(`(d.title ILIKE $${params.length} OR d.reference_number ILIKE $${params.length} OR d.issuer_name ILIKE $${params.length})`);
  }
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
  params.push(limit);
  const result = await db.query(
    `SELECT d.*,
            COUNT(r.id) FILTER (WHERE r.archived_at IS NULL)::int AS active_reference_count
     FROM quality_master_documents d
     LEFT JOIN quality_document_references r ON r.document_id = d.id AND r.store_id = d.store_id
     WHERE ${where.join(' AND ')}
     GROUP BY d.id
     ORDER BY d.archived_at NULLS FIRST, d.updated_at DESC
     LIMIT $${params.length}::int`,
    params
  );
  return result.rows.map(enrichDocument);
}

async function deriveTemperatureRelations(db, storeId, parameterId) {
  try {
    const result = await db.query(
      `WITH task_ids AS (
         SELECT quality_task_id AS id
         FROM quality_temperature_limits
         WHERE id=$2::uuid AND store_id=$1::uuid AND quality_task_id IS NOT NULL
         UNION
         SELECT task_id AS id
         FROM quality_temperature_limit_tasks
         WHERE limit_id=$2::uuid AND deleted_at IS NULL AND task_id IS NOT NULL
       ),
       occurrence_stats AS (
         SELECT COUNT(*)::int AS count
         FROM quality_task_occurrences o
         WHERE o.store_id=$1::uuid
           AND (o.source_entity_type='temperature_parameter' AND o.source_entity_id=$2::uuid
             OR o.task_id IN (SELECT id FROM task_ids))
       ),
       record_stats AS (
         SELECT COUNT(*)::int AS count
         FROM quality_temperature_records r
         WHERE r.store_id=$1::uuid AND r.temperature_limit_id=$2::uuid
       )
       SELECT t.id, t.title, t.status, t.active, os.count AS occurrence_count, rs.count AS record_count
       FROM task_ids ti
       INNER JOIN quality_tasks t ON t.id = ti.id AND t.store_id=$1::uuid
       CROSS JOIN occurrence_stats os
       CROSS JOIN record_stats rs
       ORDER BY t.title`,
      [storeId, parameterId]
    );
    return result.rows.map((row) => ({
      target_type: 'quality_task',
      target_type_label: 'Tache qualite',
      target_label: row.title,
      status: row.status,
      active: row.active,
      target_url: businessUrl('quality_task', row),
      relation_type: 'derivee_parametre_temperature',
      occurrence_count: row.occurrence_count || 0,
      record_count: row.record_count || 0,
    }));
  } catch (err) {
    return [];
  }
}

async function deriveCleaningRelations(db, storeId, planId) {
  try {
    const result = await db.query(
      `WITH plan AS (
         SELECT id, quality_task_id FROM quality_cleaning_plans WHERE id=$2::uuid AND store_id=$1::uuid
       ),
       occurrence_stats AS (
         SELECT COUNT(*)::int AS count
         FROM quality_task_occurrences o
         WHERE o.store_id=$1::uuid
           AND (o.source_entity_type='cleaning_plan' AND o.source_entity_id=$2::uuid
             OR o.task_id IN (SELECT quality_task_id FROM plan WHERE quality_task_id IS NOT NULL))
       ),
       record_stats AS (
         SELECT COUNT(*)::int AS count
         FROM quality_cleaning_records r
         WHERE r.store_id=$1::uuid AND r.cleaning_plan_id=$2::uuid
       )
       SELECT t.id, t.title, t.status, t.active, os.count AS occurrence_count, rs.count AS record_count
       FROM plan p
       INNER JOIN quality_tasks t ON t.id = p.quality_task_id AND t.store_id=$1::uuid
       CROSS JOIN occurrence_stats os
       CROSS JOIN record_stats rs`,
      [storeId, planId]
    );
    return result.rows.map((row) => ({
      target_type: 'quality_task',
      target_type_label: 'Tache qualite',
      target_label: row.title,
      status: row.status,
      active: row.active,
      target_url: businessUrl('quality_task', row),
      relation_type: 'derivee_plan_nettoyage',
      occurrence_count: row.occurrence_count || 0,
      record_count: row.record_count || 0,
    }));
  } catch (err) {
    return [];
  }
}

async function deriveDocumentRelations(db, storeId, references = []) {
  const tasks = [];
  const records = [];
  const activeRefs = references.filter((reference) => !reference.archived_at);
  for (const reference of activeRefs) {
    if (reference.target_type === 'temperature_parameter' && reference.target_id) {
      const derivedTasks = await deriveTemperatureRelations(db, storeId, reference.target_id);
      tasks.push(...derivedTasks);
      derivedTasks.forEach((task) => records.push({
        target_type: 'records',
        target_type_label: 'Enregistrements temperature',
        target_label: `${task.record_count || 0} releve(s) lie(s)`,
        relation_type: task.relation_type,
        occurrence_count: task.occurrence_count || 0,
        record_count: task.record_count || 0,
      }));
    }
    if (reference.target_type === 'cleaning_plan' && reference.target_id) {
      const derivedTasks = await deriveCleaningRelations(db, storeId, reference.target_id);
      tasks.push(...derivedTasks);
      derivedTasks.forEach((task) => records.push({
        target_type: 'records',
        target_type_label: 'Enregistrements nettoyage',
        target_label: `${task.record_count || 0} nettoyage(s) realise(s)`,
        relation_type: task.relation_type,
        occurrence_count: task.occurrence_count || 0,
        record_count: task.record_count || 0,
      }));
    }
  }
  return { tasks, records };
}

async function getMasterDocument(db, storeId, id) {
  const result = await db.query(
    'SELECT * FROM quality_master_documents WHERE id = $1::uuid AND store_id = $2::uuid LIMIT 1',
    [id, storeId]
  );
  const document = result.rows[0] || null;
  if (!document) return null;
  const references = await listDocumentReferences(db, storeId, { document_id: id, include_archived: true });
  return enrichDocumentForPresentation(db, storeId, { ...document, references });
}

async function createMasterDocument(db, storeId, userId, body = {}) {
  const payload = masterPayload(body);
  if (!payload.title) throw Object.assign(new Error('Titre du document maitre obligatoire'), { status: 400 });
  if (payload.storage_path && !payload.checksum_sha256) payload.checksum_sha256 = await checksumFile(payload.storage_path);
  const result = await db.query(
    `INSERT INTO quality_master_documents (
      store_id, title, document_type, category, source_type, issuer_name, reference_number,
      issue_date, valid_from, valid_until, version, status, original_filename, storage_path,
      mime_type, file_size, checksum_sha256, description, source_attachment_table,
      source_attachment_id, created_by, updated_by
    ) VALUES (
      $1::uuid,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,
      $8::date,$9::date,$10::date,$11::text,$12::text,$13::text,$14::text,
      $15::text,$16::bigint,$17::text,$18::text,$19::text,$20::uuid,$21::uuid,$21::uuid
    )
    RETURNING *`,
    [
      storeId, payload.title, payload.document_type, payload.category, payload.source_type,
      payload.issuer_name, payload.reference_number, payload.issue_date, payload.valid_from,
      payload.valid_until, payload.version, payload.status, payload.original_filename,
      payload.storage_path, payload.mime_type, payload.file_size, payload.checksum_sha256,
      payload.description, payload.source_attachment_table, payload.source_attachment_id, userId,
    ]
  );
  await logQualityEvent({ dbPool: db, storeId, actorId: userId, eventType: 'quality.master_document.created', targetType: 'quality_master_document', targetId: result.rows[0].id, after: result.rows[0] });
  return result.rows[0];
}

async function updateMasterDocument(db, storeId, id, userId, body = {}) {
  const before = await getMasterDocument(db, storeId, id);
  if (!before) return null;
  const payload = masterPayload({ ...before, ...body });
  if (payload.storage_path && !payload.checksum_sha256) payload.checksum_sha256 = await checksumFile(payload.storage_path);
  const result = await db.query(
    `UPDATE quality_master_documents
     SET title=$3::text, document_type=$4::text, category=$5::text, source_type=$6::text,
         issuer_name=$7::text, reference_number=$8::text, issue_date=$9::date,
         valid_from=$10::date, valid_until=$11::date, version=$12::text, status=$13::text,
         original_filename=$14::text, storage_path=$15::text, mime_type=$16::text,
         file_size=$17::bigint, checksum_sha256=$18::text, description=$19::text,
         source_attachment_table=$20::text, source_attachment_id=$21::uuid,
         updated_by=$22::uuid, updated_at=now(),
         archived_at=CASE WHEN $13::text = 'archived' THEN COALESCE(archived_at, now()) ELSE archived_at END,
         archived_by=CASE WHEN $13::text = 'archived' THEN COALESCE(archived_by, $22::uuid) ELSE archived_by END
     WHERE id=$1::uuid AND store_id=$2::uuid
     RETURNING *`,
    [
      id, storeId, payload.title, payload.document_type, payload.category, payload.source_type,
      payload.issuer_name, payload.reference_number, payload.issue_date, payload.valid_from,
      payload.valid_until, payload.version, payload.status, payload.original_filename,
      payload.storage_path, payload.mime_type, payload.file_size, payload.checksum_sha256,
      payload.description, payload.source_attachment_table, payload.source_attachment_id, userId,
    ]
  );
  await logQualityEvent({ dbPool: db, storeId, actorId: userId, eventType: 'quality.master_document.updated', targetType: 'quality_master_document', targetId: id, before, after: result.rows[0] });
  return result.rows[0];
}

async function archiveMasterDocument(db, storeId, id, userId) {
  return updateMasterDocument(db, storeId, id, userId, { status: 'archived' });
}

async function linkExistingAttachmentToMasterDocument(db, storeId, userId, body = {}) {
  const sourceType = cleanText(body.source_type || body.attachment_source_type || body.attachment_type);
  const sourceId = cleanText(body.source_id || body.attachment_id);
  const attachment = await getExistingAttachment(db, storeId, sourceType, sourceId);
  const checksum = body.checksum_sha256 || await checksumFile(attachment.storage_path);
  const existing = checksum
    ? await db.query('SELECT * FROM quality_master_documents WHERE store_id=$1::uuid AND checksum_sha256=$2::text AND archived_at IS NULL LIMIT 1', [storeId, checksum])
    : { rows: [] };
  const document = existing.rows[0] || await createMasterDocument(db, storeId, userId, {
    title: body.title || attachment.title || attachment.original_filename || 'Document maitre qualite',
    document_type: body.document_type || 'external_evidence',
    category: body.category,
    source_type: body.source_type_master || body.document_source_type || 'interne',
    issuer_name: body.issuer_name,
    reference_number: body.reference_number,
    issue_date: body.issue_date,
    valid_from: body.valid_from,
    valid_until: body.valid_until,
    version: body.version || '1.0',
    status: body.status || 'draft',
    original_filename: attachment.original_filename,
    storage_path: attachment.storage_path,
    mime_type: attachment.mime_type,
    file_size: attachment.file_size,
    checksum_sha256: checksum,
    description: body.description,
    source_attachment_table: attachment.source_attachment_table,
    source_attachment_id: attachment.source_attachment_id,
  });
  return { document, reused_existing: Boolean(existing.rows[0]), attachment };
}

async function addDocumentReference(db, storeId, userId, body = {}) {
  const payload = referencePayload(body);
  if (!payload.document_id || !payload.target_type) {
    throw Object.assign(new Error('Document maitre et cible obligatoires'), { status: 400 });
  }
  const document = await getMasterDocument(db, storeId, payload.document_id);
  if (!document || document.archived_at) {
    throw Object.assign(new Error('Document maitre introuvable ou archive'), { status: 404 });
  }
  const existing = await db.query(
    `SELECT *
     FROM quality_document_references
     WHERE store_id = $1::uuid
       AND document_id = $2::uuid
       AND target_type = $3::text
       AND COALESCE(target_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE($4::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
       AND relation_type = $5::text
       AND archived_at IS NULL
     LIMIT 1`,
    [storeId, payload.document_id, payload.target_type, payload.target_id, payload.relation_type]
  );
  if (existing.rows[0]) {
    const updated = await db.query(
      `UPDATE quality_document_references
       SET label = $3::text, sort_order = $4::int
       WHERE id = $1::uuid AND store_id = $2::uuid
       RETURNING *`,
      [existing.rows[0].id, storeId, payload.label, payload.sort_order]
    );
    return updated.rows[0];
  }
  const result = await db.query(
    `INSERT INTO quality_document_references (
      store_id, document_id, target_type, target_id, relation_type, label, sort_order, created_by
    ) VALUES ($1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::text,$7::int,$8::uuid)
    RETURNING *`,
    [storeId, payload.document_id, payload.target_type, payload.target_id, payload.relation_type, payload.label, payload.sort_order, userId]
  );
  await logQualityEvent({ dbPool: db, storeId, actorId: userId, eventType: 'quality.master_document.reference.linked', targetType: payload.target_type, targetId: payload.target_id, after: result.rows[0] });
  return result.rows[0];
}

async function archiveDocumentReference(db, storeId, userId, referenceId) {
  const result = await db.query(
    `UPDATE quality_document_references
     SET archived_at = COALESCE(archived_at, now()), archived_by = COALESCE(archived_by, $3::uuid)
     WHERE id = $1::uuid AND store_id = $2::uuid
     RETURNING *`,
    [referenceId, storeId, userId]
  );
  if (result.rows[0]) {
    await logQualityEvent({ dbPool: db, storeId, actorId: userId, eventType: 'quality.master_document.reference.archived', targetType: 'quality_document_reference', targetId: referenceId, after: result.rows[0] });
  }
  return result.rows[0] || null;
}

async function listDocumentReferences(db, storeId, query = {}) {
  const params = [storeId];
  const where = ['r.store_id = $1::uuid'];
  if (query.document_id) {
    params.push(query.document_id);
    where.push(`r.document_id = $${params.length}::uuid`);
  }
  if (query.target_type) {
    params.push(query.target_type);
    where.push(`r.target_type = $${params.length}::text`);
  }
  if (query.target_id) {
    params.push(query.target_id);
    where.push(`r.target_id = $${params.length}::uuid`);
  }
  if (!['true', '1', 'yes'].includes(String(query.include_archived || '').toLowerCase())) {
    where.push('r.archived_at IS NULL');
  }
  const result = await db.query(
    `SELECT r.*, d.title AS document_title, d.status AS document_status, d.valid_until,
            d.document_type, d.category, d.source_type, d.original_filename
     FROM quality_document_references r
     JOIN quality_master_documents d ON d.id = r.document_id AND d.store_id = r.store_id
     WHERE ${where.join(' AND ')}
     ORDER BY r.archived_at NULLS FIRST, r.sort_order ASC, r.created_at DESC`,
    params
  );
  return hydrateReferences(db, storeId, result.rows);
}

async function hydrateReferences(db, storeId, references = []) {
  const hydrated = [];
  for (const reference of references) {
    const resolver = TARGET_LABEL_QUERIES[reference.target_type];
    let target = null;
    if (resolver && reference.target_id) {
      try {
        const result = await db.query(resolver.sql, [reference.target_id, storeId]);
        if (result.rows[0]) {
          target = {
            ...result.rows[0],
            label: resolver.label(result.rows[0]) || typedLabel(reference.target_type),
            url: resolver.url(result.rows[0]),
          };
        }
      } catch (err) {
        target = null;
      }
    }
    hydrated.push({
      ...reference,
      target_type_label: typedLabel(reference.target_type),
      target_label: target?.label || reference.label || typedLabel(reference.target_type),
      target_url: target?.url || null,
    });
  }
  return hydrated;
}

async function listIncomingReferences(db, storeId, documentId) {
  return listDocumentReferences(db, storeId, { document_id: documentId, include_archived: true });
}

async function getDocumentsForTarget(db, storeId, targetType, targetId = null) {
  return listDocumentReferences(db, storeId, { target_type: targetType, target_id: targetId });
}

async function resolveNativeDocumentTarget(db, storeId, targetType, targetId) {
  if (!targetId) return null;
  if (['temperature_parameter', 'cleaning_plan', 'documentation_section'].includes(targetType)) {
    return { target_type: targetType, target_id: targetId };
  }
  try {
    if (targetType === 'quality_task' || targetType === 'task') {
      const result = await db.query(
        `SELECT source_entity_type, source_entity_id FROM quality_tasks WHERE id=$1::uuid AND store_id=$2::uuid LIMIT 1`,
        [targetId, storeId]
      );
      const row = result.rows[0];
      return row?.source_entity_type && row?.source_entity_id ? { target_type: row.source_entity_type, target_id: row.source_entity_id } : { target_type: 'quality_task', target_id: targetId };
    }
    if (targetType === 'quality_task_occurrence' || targetType === 'occurrence') {
      const result = await db.query(
        `SELECT o.source_entity_type, o.source_entity_id, t.source_entity_type AS task_source_entity_type, t.source_entity_id AS task_source_entity_id
         FROM quality_task_occurrences o
         LEFT JOIN quality_tasks t ON t.id=o.task_id AND t.store_id=o.store_id
         WHERE o.id=$1::uuid AND o.store_id=$2::uuid LIMIT 1`,
        [targetId, storeId]
      );
      const row = result.rows[0];
      const type = row?.source_entity_type || row?.task_source_entity_type;
      const id = row?.source_entity_id || row?.task_source_entity_id;
      return type && id ? { target_type: type, target_id: id } : null;
    }
    if (targetType === 'temperature_record' || targetType === 'quality_temperature_record') {
      const result = await db.query(
        `SELECT r.temperature_limit_id, t.source_entity_type, t.source_entity_id
         FROM quality_temperature_records r
         LEFT JOIN quality_tasks t ON t.id=r.quality_task_id AND t.store_id=r.store_id
         WHERE r.id=$1::uuid AND r.store_id=$2::uuid LIMIT 1`,
        [targetId, storeId]
      );
      const row = result.rows[0];
      if (row?.temperature_limit_id) return { target_type: 'temperature_parameter', target_id: row.temperature_limit_id };
      return row?.source_entity_type && row?.source_entity_id ? { target_type: row.source_entity_type, target_id: row.source_entity_id } : null;
    }
    if (targetType === 'cleaning_record' || targetType === 'quality_cleaning_record') {
      const result = await db.query(
        `SELECT cleaning_plan_id FROM quality_cleaning_records WHERE id=$1::uuid AND store_id=$2::uuid LIMIT 1`,
        [targetId, storeId]
      );
      const row = result.rows[0];
      return row?.cleaning_plan_id ? { target_type: 'cleaning_plan', target_id: row.cleaning_plan_id } : null;
    }
  } catch (err) {
    return null;
  }
  return { target_type: targetType, target_id: targetId };
}

async function getApplicableDocumentsForTarget(db, storeId, targetType, targetId = null) {
  const native = await resolveNativeDocumentTarget(db, storeId, targetType, targetId);
  if (!native) return [];
  const references = await listDocumentReferences(db, storeId, { target_type: native.target_type, target_id: native.target_id });
  const byDocument = new Map();
  references.forEach((reference) => {
    if (!byDocument.has(reference.document_id)) {
      byDocument.set(reference.document_id, {
        ...reference,
        resolved_from: native,
        pdf_url: `master-documents/${reference.document_id}/export-pdf`,
      });
    }
  });
  return [...byDocument.values()];
}

async function compareDocuments(db, storeId, firstId, secondId) {
  const [first, second] = await Promise.all([
    getMasterDocument(db, storeId, firstId),
    getMasterDocument(db, storeId, secondId),
  ]);
  if (!first || !second) throw Object.assign(new Error('Documents a comparer introuvables'), { status: 404 });
  return {
    first,
    second,
    same_checksum: Boolean(first.checksum_sha256 && second.checksum_sha256 && first.checksum_sha256 === second.checksum_sha256),
    same_filename: Boolean(first.original_filename && second.original_filename && first.original_filename === second.original_filename),
    same_size: first.file_size !== null && first.file_size !== undefined && Number(first.file_size) === Number(second.file_size),
    merge_allowed_automatically: false,
    warning: 'Aucune fusion automatique: seul un checksum identique prouve un doublon exact.',
  };
}

async function diagnoseDuplicates(db, storeId) {
  const docs = await listMasterDocuments(db, storeId, { include_archived: true, limit: 500 });
  const byChecksum = new Map();
  const byNameSize = new Map();
  docs.forEach((doc) => {
    if (doc.checksum_sha256) {
      const list = byChecksum.get(doc.checksum_sha256) || [];
      list.push(doc);
      byChecksum.set(doc.checksum_sha256, list);
    }
    const nameKey = `${doc.original_filename || ''}::${doc.file_size || ''}`;
    if (doc.original_filename || doc.file_size) {
      const list = byNameSize.get(nameKey) || [];
      list.push(doc);
      byNameSize.set(nameKey, list);
    }
  });
  return {
    documents: docs,
    exact_duplicates: [...byChecksum.values()].filter((items) => items.length > 1),
    potential_duplicates: [...byNameSize.values()].filter((items) => items.length > 1),
    rule: 'Les noms identiques ne suffisent jamais pour fusionner deux fichiers.',
  };
}

function renderStructuredRows(document) {
  const content = document.structured_content || normalizeStructuredContent(document.description);
  return STRUCTURED_SECTIONS
    .map(([key, label]) => {
      const value = cleanText(content[key]);
      if (!value) return '';
      return `<section class="procedure-section"><h2>${escapeHtml(label)}</h2><p>${escapeHtml(value).replace(/\n/g, '<br>')}</p></section>`;
    })
    .filter(Boolean)
    .join('');
}

function renderReferenceRows(references = []) {
  return references
    .filter((reference) => !reference.archived_at)
    .map((reference) => `
      <tr>
        <td>${escapeHtml(reference.target_type_label || typedLabel(reference.target_type))}</td>
        <td>${escapeHtml(reference.target_label || reference.label || '-')}</td>
        <td>${escapeHtml(reference.relation_type || '-')}</td>
      </tr>
    `)
    .join('');
}

function buildMasterDocumentHtml(document, identity) {
  const referenceRows = renderReferenceRows(document.references || []);
  const title = `${document.reference_number || document.title} - ${document.title}`;
  const logo = identity.logo_url ? `<img class="doc-logo" src="${escapeHtml(identity.logo_url)}" alt="Logo">` : '';
  const content = `
    <main class="master-document-pdf">
      <header class="doc-header">
        <div>${logo}<strong>${escapeHtml(identity.company_name)}</strong></div>
        <div class="doc-meta">
          <span>${escapeHtml(document.document_type || 'Document qualite')}</span>
          <span>Version ${escapeHtml(document.version || '-')}</span>
          <span>${escapeHtml(document.status || '-')}</span>
        </div>
      </header>
      <section class="cover">
        <p class="kicker">Document maitrise PMS</p>
        <h1>${escapeHtml(document.title)}</h1>
        <table>
          <tbody>
            <tr><th>Code / reference</th><td>${escapeHtml(document.reference_number || '-')}</td></tr>
            <tr><th>Categorie</th><td>${escapeHtml(document.category || '-')}</td></tr>
            <tr><th>Emetteur</th><td>${escapeHtml(document.issuer_name || identity.company_name || '-')}</td></tr>
            <tr><th>Date emission</th><td>${escapeHtml(formatDate(document.issue_date))}</td></tr>
            <tr><th>Date application</th><td>${escapeHtml(formatDate(document.valid_from))}</td></tr>
          </tbody>
        </table>
      </section>
      ${renderStructuredRows(document) || `<section class="procedure-section"><h2>Contenu</h2><p>${escapeHtml(document.description || 'Aucun contenu renseigne.')}</p></section>`}
      <section class="procedure-section">
        <h2>Documents et objets associes</h2>
        <table><thead><tr><th>Type</th><th>Element</th><th>Relation</th></tr></thead><tbody>${referenceRows || '<tr><td colspan="3">Aucun rattachement.</td></tr>'}</tbody></table>
      </section>
    </main>
  `;
  const styles = `
    @page {
      size: A4;
      margin: 18mm 12mm 18mm 12mm;
      @top-left { content: "${escapeHtml(identity.company_name)}"; }
      @top-center { content: "${escapeHtml(document.reference_number || 'Document PMS')}"; }
      @top-right { content: "V${escapeHtml(document.version || '-')}"; }
      @bottom-left { content: "Document maitrise"; }
      @bottom-center { content: "${escapeHtml(formatDate(new Date()))}"; }
      @bottom-right { content: "Page " counter(page) " / " counter(pages); }
    }
    body { color: #263746; font-size: 12px; }
    .doc-header { align-items: center; border-bottom: 1px solid #94a3b8; display: flex; justify-content: space-between; margin-bottom: 12mm; padding-bottom: 5mm; }
    .doc-logo { max-height: 18mm; max-width: 42mm; object-fit: contain; vertical-align: middle; margin-right: 8mm; }
    .doc-meta { color: #52616f; display: flex; gap: 8mm; font-size: 10px; }
    .cover { page-break-after: always; }
    .kicker { color: #0f5f73; font-weight: 700; text-transform: uppercase; }
    h1 { font-size: 24px; margin: 0 0 10mm; }
    h2 { color: #0f5f73; font-size: 16px; margin-top: 10mm; page-break-after: avoid; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #94a3b8; padding: 6px 8px; text-align: left; vertical-align: top; }
    th { background: #eef2f7; width: 34%; }
    .procedure-section { break-inside: avoid-page; margin-bottom: 8mm; }
  `;
  return htmlDocument(title, content, styles);
}

async function renderMasterDocumentPdf(db, storeId, documentId) {
  const document = await getMasterDocument(db, storeId, documentId);
  if (!document) return null;
  const identity = await getCompanyIdentity(db, storeId);
  const html = buildMasterDocumentHtml(document, identity);
  const pdf = await renderHtmlToPdf(html, {
    margin: { top: '18mm', right: '12mm', bottom: '18mm', left: '12mm' },
  });
  const filename = `${fileSafe(`${document.reference_number || document.title}_V${document.version || '1'}`, 'document-maitre')}.pdf`;
  return { document, identity, html, pdf, filename };
}

async function inventoryExistingAttachments(db, storeId) {
  const queries = [
    db.query(
      `SELECT 'quality_documentation_attachment' AS source_type, a.id, a.section_id AS target_id,
              'documentation_section' AS target_type, a.filename AS name, a.original_filename,
              a.file_path AS storage_path, a.mime_type, a.file_size, a.created_at, s.code AS target_code, s.title AS target_title
       FROM quality_documentation_attachments a
       LEFT JOIN quality_documentation_sections s ON s.id = a.section_id AND s.store_id = a.store_id
       WHERE a.store_id=$1::uuid`,
      [storeId]
    ).catch(() => ({ rows: [] })),
    db.query(
      `SELECT 'quality_document' AS source_type, id, owner_id AS target_id, owner_type AS target_type,
              name, original_filename, storage_path, mime_type, file_size, created_at, owner_type AS target_code, owner_id::text AS target_title
       FROM quality_documents WHERE store_id=$1::uuid`,
      [storeId]
    ).catch(() => ({ rows: [] })),
    db.query(
      `SELECT 'quality_photo' AS source_type, id, owner_id AS target_id, owner_type AS target_type,
              caption AS name, original_filename, storage_path, mime_type, file_size, created_at, owner_type AS target_code, owner_id::text AS target_title
       FROM quality_photos WHERE store_id=$1::uuid`,
      [storeId]
    ).catch(() => ({ rows: [] })),
  ];
  const results = await Promise.all(queries);
  const attachments = results.flatMap((result) => result.rows);
  const enriched = [];
  for (const attachment of attachments) {
    enriched.push({ ...attachment, checksum_sha256: await checksumFile(attachment.storage_path) });
  }
  return enriched;
}

module.exports = {
  ATTACHMENT_SOURCES,
  checksumFile,
  inventoryExistingAttachments,
  listMasterDocuments,
  getMasterDocument,
  createMasterDocument,
  updateMasterDocument,
  archiveMasterDocument,
  linkExistingAttachmentToMasterDocument,
  addDocumentReference,
  archiveDocumentReference,
  listDocumentReferences,
  listIncomingReferences,
  getDocumentsForTarget,
  getApplicableDocumentsForTarget,
  compareDocuments,
  diagnoseDuplicates,
  normalizeStructuredContent,
  buildMasterDocumentHtml,
  renderMasterDocumentPdf,
};
