const fs = require('fs');
const { addDocumentReference, archiveDocumentReference, getDocumentsForTarget, getMasterDocument, linkExistingAttachmentToMasterDocument } = require('./masterDocuments');
const { createDocument } = require('./documents');
const { logQualityEvent } = require('./eventLogger');

const SUPPLY_MATERIAL_CATEGORIES = Object.freeze([
  'cleaning_product',
  'food_packaging',
  'hygiene_ppe',
  'cleaning_equipment',
  'food_small_equipment',
  'technical_consumable',
  'maintenance_consumable',
  'other',
]);

const SUPPLY_MATERIAL_DOCUMENT_TYPES = Object.freeze([
  'technical_sheet',
  'safety_data_sheet',
  'food_contact_declaration',
  'certificate',
  'manufacturer_notice',
  'attestation',
  'supplier_document',
  'product_photo',
  'other',
]);

const DOCUMENT_TYPE_TO_QUALITY_DOCUMENT_TYPE = Object.freeze({
  technical_sheet: 'NOTICE',
  safety_data_sheet: 'FDS',
  food_contact_declaration: 'CERTIFICAT',
  certificate: 'CERTIFICAT',
  manufacturer_notice: 'NOTICE',
  attestation: 'CERTIFICAT',
  supplier_document: 'AUTRE',
  product_photo: 'PHOTO',
  other: 'AUTRE',
});

const DOCUMENT_TYPE_TO_MASTER_TYPE = Object.freeze({
  technical_sheet: 'external_evidence',
  safety_data_sheet: 'external_evidence',
  food_contact_declaration: 'external_evidence',
  certificate: 'external_evidence',
  manufacturer_notice: 'external_evidence',
  attestation: 'external_evidence',
  supplier_document: 'external_evidence',
  product_photo: 'external_evidence',
  other: 'external_evidence',
});

const SUPPLY_MATERIAL_LINK_TYPES = Object.freeze([
  'zone',
  'equipment',
  'cleaning_plan',
  'quality_task',
  'documentation_section',
  'pms_chapter',
]);

function text(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function bool(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  return !(value === false || value === 'false' || value === '0' || value === 0);
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function jsonObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return { ...value };
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (err) {
      return {};
    }
  }
  return {};
}

function limit(value, fallback = 50, max = 100) {
  const parsed = Number(value);
  return Math.min(Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback, max);
}

function normalizeDocumentRelation(value) {
  const relationType = text(value) || 'other';
  if (SUPPLY_MATERIAL_DOCUMENT_TYPES.includes(relationType)) return relationType;
  if (relationType === 'reference') return relationType;
  const err = new Error('Type de document fourniture invalide');
  err.status = 400;
  throw err;
}

function ensureCategory(category) {
  const value = text(category);
  if (!value) {
    const err = new Error('Categorie fourniture obligatoire');
    err.status = 400;
    throw err;
  }
  return value;
}

function mapSupplyMaterialPayload(input = {}) {
  return {
    code: text(input.code),
    name: text(input.name),
    category: ensureCategory(input.category),
    subcategory: text(input.subcategory),
    description: text(input.description),
    brand: text(input.brand || input.manufacturer),
    supplier_id: text(input.supplier_id),
    supplier_reference: text(input.supplier_reference),
    order_url: text(input.order_url),
    image_document_id: text(input.image_document_id || input.photo_document_id),
    unit: text(input.unit),
    packaging: text(input.packaging),
    purchase_price: numberOrNull(input.purchase_price),
    minimum_stock: numberOrNull(input.minimum_stock),
    current_stock: numberOrNull(input.current_stock),
    metadata: jsonObject(input.metadata),
    active: bool(input.active, true),
    notes: text(input.notes),
  };
}

function publicMaterial(row = {}) {
  if (!row) return null;
  const documentCounts = jsonObject(row.document_counts);
  return {
    ...row,
    metadata: jsonObject(row.metadata),
    supplier: row.supplier_id ? {
      id: row.supplier_id,
      code: row.supplier_code || null,
      name: row.supplier_name || null,
    } : null,
    document_status: {
      total: Number(row.document_count || 0),
      technical_sheet_count: Number(documentCounts.technical_sheet || 0),
      safety_data_sheet_count: Number(documentCounts.safety_data_sheet || 0),
      food_contact_declaration_count: Number(documentCounts.food_contact_declaration || 0),
      has_technical_sheet: Number(documentCounts.technical_sheet || 0) > 0,
      has_safety_data_sheet: Number(documentCounts.safety_data_sheet || 0) > 0,
      has_food_contact_declaration: Number(documentCounts.food_contact_declaration || 0) > 0,
    },
    low_stock: row.minimum_stock !== null && row.current_stock !== null
      ? Number(row.current_stock) <= Number(row.minimum_stock)
      : false,
  };
}

function materialSelectSql(whereSql) {
  return `SELECT sm.*,
                 s.code AS supplier_code,
                 s.name AS supplier_name,
                 COALESCE(doc_counts.total, 0) AS document_count,
                 COALESCE(doc_counts.by_type, '{}'::jsonb) AS document_counts
          FROM supplies_materials sm
          LEFT JOIN suppliers s ON s.id = sm.supplier_id AND s.store_id = sm.store_id
          LEFT JOIN LATERAL (
            SELECT COUNT(*)::integer AS total,
                   jsonb_object_agg(relation_type, count_by_type) AS by_type
            FROM (
              SELECT relation_type, COUNT(*)::integer AS count_by_type
              FROM quality_document_references qdr
              WHERE qdr.store_id = sm.store_id
                AND qdr.target_type = 'supply_material'
                AND qdr.target_id = sm.id
                AND qdr.archived_at IS NULL
              GROUP BY relation_type
            ) grouped
          ) doc_counts ON true
          WHERE ${whereSql}`;
}

async function assertSupplier(db, storeId, supplierId) {
  if (!supplierId) return null;
  const result = await db.query(
    `SELECT id FROM suppliers WHERE id = $1::uuid AND store_id = $2::uuid LIMIT 1`,
    [supplierId, storeId]
  );
  if (result.rows[0]) return supplierId;
  const err = new Error('Fournisseur introuvable pour ce magasin');
  err.status = 400;
  throw err;
}

async function assertMaterial(db, storeId, materialId) {
  const result = await db.query(
    `SELECT id FROM supplies_materials WHERE id = $1::uuid AND store_id = $2::uuid AND archived_at IS NULL LIMIT 1`,
    [materialId, storeId]
  );
  if (result.rows[0]) return materialId;
  const err = new Error('Fourniture ou materiel introuvable');
  err.status = 404;
  throw err;
}

async function assertTarget(db, storeId, targetType, targetId) {
  if (targetType === 'pms_chapter') return true;
  if (!targetId) {
    const err = new Error('Identifiant cible obligatoire');
    err.status = 400;
    throw err;
  }
  const queries = {
    zone: `SELECT id FROM quality_zones WHERE id = $1::uuid AND store_id = $2::uuid LIMIT 1`,
    equipment: `SELECT id FROM quality_equipments WHERE id = $1::uuid AND store_id = $2::uuid LIMIT 1`,
    cleaning_plan: `SELECT id FROM quality_cleaning_plans WHERE id = $1::uuid AND store_id = $2::uuid LIMIT 1`,
    quality_task: `SELECT id FROM quality_tasks WHERE id = $1::uuid AND store_id = $2::uuid LIMIT 1`,
    documentation_section: `SELECT id FROM quality_documentation_sections WHERE id = $1::uuid AND store_id = $2::uuid LIMIT 1`,
  };
  const sql = queries[targetType];
  if (!sql) {
    const err = new Error('Type de liaison fourniture invalide');
    err.status = 400;
    throw err;
  }
  const result = await db.query(sql, [targetId, storeId]);
  if (result.rows[0]) return true;
  const err = new Error('Objet cible introuvable pour ce magasin');
  err.status = 400;
  throw err;
}

async function listSuppliesMaterials(db, storeId, query = {}) {
  const params = [storeId];
  const where = ['sm.store_id = $1::uuid', 'sm.archived_at IS NULL'];
  if (query.include_archived === true || query.include_archived === 'true') where.pop();
  if (query.category) {
    params.push(text(query.category));
    where.push(`sm.category = $${params.length}::text`);
  }
  if (query.supplier_id) {
    params.push(text(query.supplier_id));
    where.push(`sm.supplier_id = $${params.length}::uuid`);
  }
  if (query.active !== undefined && query.active !== '') {
    params.push(bool(query.active));
    where.push(`sm.active = $${params.length}::boolean`);
  }
  if (query.food_contact !== undefined && query.food_contact !== '') {
    params.push(bool(query.food_contact));
    where.push(`COALESCE((sm.metadata->>'food_contact')::boolean, (sm.metadata->>'direct_food_contact')::boolean, false) = $${params.length}::boolean`);
  }
  if (query.search || query.query) {
    params.push(`%${text(query.search || query.query)}%`);
    where.push(`(sm.code ILIKE $${params.length} OR sm.name ILIKE $${params.length} OR sm.brand ILIKE $${params.length} OR sm.description ILIKE $${params.length} OR sm.supplier_reference ILIKE $${params.length})`);
  }
  params.push(limit(query.limit));
  const result = await db.query(
    `${materialSelectSql(where.join(' AND '))}
     ORDER BY sm.active DESC, sm.category ASC, sm.name ASC
     LIMIT $${params.length}::integer`,
    params
  );
  return result.rows.map(publicMaterial);
}

async function searchSuppliesMaterials(db, storeId, query = {}) {
  return listSuppliesMaterials(db, storeId, { ...query, search: query.query || query.search });
}

async function getSupplyMaterial(db, storeId, materialId) {
  const result = await db.query(
    `${materialSelectSql('sm.id = $1::uuid AND sm.store_id = $2::uuid AND sm.archived_at IS NULL')} LIMIT 1`,
    [materialId, storeId]
  );
  const material = publicMaterial(result.rows[0] || null);
  if (!material) return null;
  material.documents = await listSupplyMaterialDocuments(db, storeId, material.id);
  material.links = await listSupplyMaterialLinks(db, storeId, material.id);
  return material;
}

async function createSupplyMaterial(db, storeId, userId, input = {}) {
  const payload = mapSupplyMaterialPayload(input);
  if (!payload.name) {
    const err = new Error('Nom fourniture obligatoire');
    err.status = 400;
    throw err;
  }
  await assertSupplier(db, storeId, payload.supplier_id);
  const result = await db.query(
    `INSERT INTO supplies_materials (
       store_id, code, name, category, subcategory, description, brand, supplier_id,
       supplier_reference, order_url, image_document_id, unit, packaging, purchase_price,
       minimum_stock, current_stock, metadata, active, notes, created_by, updated_by
     ) VALUES (
       $1::uuid,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::uuid,
       $9::text,$10::text,$11::uuid,$12::text,$13::text,$14::numeric,$15::numeric,
       $16::numeric,$17::jsonb,$18::boolean,$19::text,$20::uuid,$20::uuid
     )
     RETURNING *`,
    [
      storeId, payload.code, payload.name, payload.category, payload.subcategory, payload.description,
      payload.brand, payload.supplier_id, payload.supplier_reference, payload.order_url,
      payload.image_document_id, payload.unit, payload.packaging, payload.purchase_price,
      payload.minimum_stock, payload.current_stock, JSON.stringify(payload.metadata), payload.active,
      payload.notes, userId,
    ]
  );
  await logQualityEvent({
    dbPool: db,
    storeId,
    actorId: userId,
    eventType: 'quality.supplies_materials.created',
    targetType: 'supply_material',
    targetId: result.rows[0].id,
    after: result.rows[0],
  });
  return getSupplyMaterial(db, storeId, result.rows[0].id);
}

async function updateSupplyMaterial(db, storeId, userId, materialId, input = {}) {
  const before = await getSupplyMaterial(db, storeId, materialId);
  if (!before) return null;
  const merged = mapSupplyMaterialPayload({ ...before, ...input });
  await assertSupplier(db, storeId, merged.supplier_id);
  const result = await db.query(
    `UPDATE supplies_materials
     SET code=$3::text, name=$4::text, category=$5::text, subcategory=$6::text,
         description=$7::text, brand=$8::text, supplier_id=$9::uuid,
         supplier_reference=$10::text, order_url=$11::text, image_document_id=$12::uuid,
         unit=$13::text, packaging=$14::text, purchase_price=$15::numeric,
         minimum_stock=$16::numeric, current_stock=$17::numeric, metadata=$18::jsonb,
         active=$19::boolean, notes=$20::text, updated_by=$21::uuid
     WHERE id=$1::uuid AND store_id=$2::uuid AND archived_at IS NULL
     RETURNING *`,
    [
      materialId, storeId, merged.code, merged.name, merged.category, merged.subcategory,
      merged.description, merged.brand, merged.supplier_id, merged.supplier_reference,
      merged.order_url, merged.image_document_id, merged.unit, merged.packaging, merged.purchase_price,
      merged.minimum_stock, merged.current_stock, JSON.stringify(merged.metadata), merged.active,
      merged.notes, userId,
    ]
  );
  if (!result.rows[0]) return null;
  const after = await getSupplyMaterial(db, storeId, materialId);
  await logQualityEvent({
    dbPool: db,
    storeId,
    actorId: userId,
    eventType: 'quality.supplies_materials.updated',
    targetType: 'supply_material',
    targetId: materialId,
    before,
    after,
  });
  return after;
}

async function archiveSupplyMaterial(db, storeId, userId, materialId) {
  const before = await getSupplyMaterial(db, storeId, materialId);
  if (!before) return null;
  const result = await db.query(
    `UPDATE supplies_materials
     SET active = false, archived_at = now(), archived_by = $3::uuid, updated_by = $3::uuid
     WHERE id = $1::uuid AND store_id = $2::uuid AND archived_at IS NULL
     RETURNING *`,
    [materialId, storeId, userId]
  );
  if (!result.rows[0]) return null;
  await logQualityEvent({
    dbPool: db,
    storeId,
    actorId: userId,
    eventType: 'quality.supplies_materials.archived',
    targetType: 'supply_material',
    targetId: materialId,
    before,
    after: result.rows[0],
  });
  return publicMaterial(result.rows[0]);
}

async function listSupplyMaterialDocuments(db, storeId, materialId) {
  await assertMaterial(db, storeId, materialId);
  return getDocumentsForTarget(db, storeId, 'supply_material', materialId);
}

async function addSupplyMaterialDocumentReference(db, storeId, userId, input = {}) {
  const materialId = text(input.supply_material_id || input.material_id);
  await assertMaterial(db, storeId, materialId);
  const relationType = normalizeDocumentRelation(input.relation_type || input.document_relation_type);
  return addDocumentReference(db, storeId, userId, {
    document_id: input.document_id,
    target_type: 'supply_material',
    target_id: materialId,
    relation_type: relationType,
    label: input.label,
  });
}

async function createSupplyMaterialDocumentFromUpload(db, storeId, userId, materialId, input = {}, file = null) {
  await assertMaterial(db, storeId, materialId);
  if (!file) {
    const err = new Error('Fichier document obligatoire');
    err.status = 400;
    throw err;
  }
  const relationType = normalizeDocumentRelation(input.relation_type || input.document_relation_type || input.document_type);
  const title = text(input.title || input.name, file.originalname);
  const description = [text(input.comment), text(input.description)].filter(Boolean).join('\n') || null;
  const nativeDocument = await createDocument(db, storeId, userId, {
    owner_type: 'supply_material',
    owner_id: materialId,
    type_code: DOCUMENT_TYPE_TO_QUALITY_DOCUMENT_TYPE[relationType] || 'AUTRE',
    name: title,
    description,
    version: text(input.version),
    document_date: text(input.document_date || input.issue_date),
    author: text(input.manufacturer || input.issuer_name),
  }, file);
  const linked = await linkExistingAttachmentToMasterDocument(db, storeId, userId, {
    source_type: 'quality_document',
    source_id: nativeDocument.id,
    target_type: 'supply_material',
    target_id: materialId,
    relation_type: relationType,
    title,
    document_type: DOCUMENT_TYPE_TO_MASTER_TYPE[relationType] || 'external_evidence',
    category: 'supplies_materials',
    source_type_master: 'fournisseur',
    issuer_name: text(input.manufacturer || input.issuer_name),
    reference_number: text(input.reference_number || input.reference),
    issue_date: text(input.document_date || input.issue_date),
    valid_until: text(input.valid_until),
    version: text(input.version, '1.0'),
    status: 'valid',
    description,
    label: text(input.label),
  });
  const reference = await addDocumentReference(db, storeId, userId, {
    document_id: linked.document.id,
    target_type: 'supply_material',
    target_id: materialId,
    relation_type: relationType,
    label: text(input.label || title),
  });
  if (linked.reused_existing && linked.document.storage_path && linked.document.storage_path !== file.path) {
    await db.query(
      `UPDATE quality_documents
       SET storage_path = $3::text,
           original_filename = COALESCE($4::text, original_filename),
           mime_type = COALESCE($5::text, mime_type),
           file_size = COALESCE($6::bigint, file_size),
           updated_by = $7::uuid,
           updated_at = now()
       WHERE id = $1::uuid AND store_id = $2::uuid`,
      [
        nativeDocument.id,
        storeId,
        linked.document.storage_path,
        linked.document.original_filename,
        linked.document.mime_type,
        linked.document.file_size,
        userId,
      ]
    );
    fs.unlink(file.path, () => {});
  }
  return {
    document: await getMasterDocument(db, storeId, linked.document.id),
    native_document: nativeDocument,
    reference,
    reused_existing: linked.reused_existing,
  };
}

async function archiveSupplyMaterialDocumentReference(db, storeId, userId, referenceId, materialId = null) {
  if (materialId) {
    await assertMaterial(db, storeId, materialId);
    const result = await db.query(
      `SELECT id FROM quality_document_references
       WHERE id = $1::uuid
         AND store_id = $2::uuid
         AND target_type = 'supply_material'
         AND target_id = $3::uuid
         AND archived_at IS NULL
       LIMIT 1`,
      [referenceId, storeId, materialId]
    );
    if (!result.rows[0]) return null;
  }
  return archiveDocumentReference(db, storeId, userId, referenceId);
}

async function getSupplyMaterialDocumentFile(db, storeId, documentId) {
  const document = await getMasterDocument(db, storeId, documentId);
  if (!document || document.archived_at || !document.storage_path) return null;
  return document;
}

async function listSupplyMaterialLinks(db, storeId, materialId) {
  await assertMaterial(db, storeId, materialId);
  const result = await db.query(
    `SELECT sml.*,
            COALESCE(z.name, e.name, cp.title, qt.title, CONCAT_WS(' - ', qs.code, qs.title), sml.target_code, sml.relation_type) AS target_label,
            COALESCE(z.code, e.code, qs.code, sml.target_code) AS target_code_resolved
     FROM supply_material_links sml
     LEFT JOIN quality_zones z ON z.id = sml.target_id AND z.store_id = sml.store_id AND sml.target_type = 'zone'
     LEFT JOIN quality_equipments e ON e.id = sml.target_id AND e.store_id = sml.store_id AND sml.target_type = 'equipment'
     LEFT JOIN quality_cleaning_plans cp ON cp.id = sml.target_id AND cp.store_id = sml.store_id AND sml.target_type = 'cleaning_plan'
     LEFT JOIN quality_tasks qt ON qt.id = sml.target_id AND qt.store_id = sml.store_id AND sml.target_type = 'quality_task'
     LEFT JOIN quality_documentation_sections qs ON qs.id = sml.target_id AND qs.store_id = sml.store_id AND sml.target_type = 'documentation_section'
     WHERE sml.store_id = $1::uuid
       AND sml.supply_material_id = $2::uuid
       AND sml.archived_at IS NULL
     ORDER BY sml.target_type ASC, sml.created_at DESC`,
    [storeId, materialId]
  );
  return result.rows;
}

async function addSupplyMaterialLink(db, storeId, userId, input = {}) {
  const materialId = text(input.supply_material_id || input.material_id);
  const targetType = text(input.target_type);
  const targetId = text(input.target_id);
  const targetCode = text(input.target_code || input.pms_chapter_code);
  const relationType = text(input.relation_type) || 'used_for';
  if (!SUPPLY_MATERIAL_LINK_TYPES.includes(targetType)) {
    const err = new Error('Type de liaison fourniture invalide');
    err.status = 400;
    throw err;
  }
  await assertMaterial(db, storeId, materialId);
  await assertTarget(db, storeId, targetType, targetId);
  const result = await db.query(
    `INSERT INTO supply_material_links (
       store_id, supply_material_id, target_type, target_id, target_code,
       relation_type, notes, created_by, archived_at, archived_by
     ) VALUES (
       $1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::text,$7::text,$8::uuid,NULL,NULL
     )
     ON CONFLICT (
       store_id, supply_material_id, target_type,
       (COALESCE(target_id, '00000000-0000-0000-0000-000000000000'::uuid)),
       (COALESCE(target_code, '')), relation_type
     ) WHERE archived_at IS NULL
     DO UPDATE SET notes = EXCLUDED.notes
     RETURNING *`,
    [storeId, materialId, targetType, targetId, targetCode, relationType, text(input.notes), userId]
  );
  return result.rows[0];
}

async function archiveSupplyMaterialLink(db, storeId, userId, linkId) {
  const result = await db.query(
    `UPDATE supply_material_links
     SET archived_at = now(), archived_by = $3::uuid
     WHERE id = $1::uuid AND store_id = $2::uuid AND archived_at IS NULL
     RETURNING *`,
    [linkId, storeId, userId]
  );
  return result.rows[0] || null;
}

async function diagnoseSuppliesMaterials(db, storeId) {
  const queries = {
    active_without_supplier: `SELECT id, code, name, category FROM supplies_materials WHERE store_id=$1::uuid AND archived_at IS NULL AND active = true AND supplier_id IS NULL ORDER BY name`,
    cleaning_products_without_technical_sheet: `SELECT sm.id, sm.code, sm.name, sm.category FROM supplies_materials sm WHERE sm.store_id=$1::uuid AND sm.archived_at IS NULL AND sm.category = 'cleaning_product' AND NOT EXISTS (SELECT 1 FROM quality_document_references qdr WHERE qdr.store_id=sm.store_id AND qdr.target_type='supply_material' AND qdr.target_id=sm.id AND qdr.relation_type='technical_sheet' AND qdr.archived_at IS NULL) ORDER BY sm.name`,
    cleaning_products_without_sds: `SELECT sm.id, sm.code, sm.name, sm.category FROM supplies_materials sm WHERE sm.store_id=$1::uuid AND sm.archived_at IS NULL AND sm.category = 'cleaning_product' AND NOT EXISTS (SELECT 1 FROM quality_document_references qdr WHERE qdr.store_id=sm.store_id AND qdr.target_type='supply_material' AND qdr.target_id=sm.id AND qdr.relation_type='safety_data_sheet' AND qdr.archived_at IS NULL) ORDER BY sm.name`,
    food_packaging_without_declaration: `SELECT sm.id, sm.code, sm.name, sm.category FROM supplies_materials sm WHERE sm.store_id=$1::uuid AND sm.archived_at IS NULL AND sm.category = 'food_packaging' AND COALESCE((sm.metadata->>'direct_food_contact')::boolean, (sm.metadata->>'food_contact')::boolean, false) = true AND NOT EXISTS (SELECT 1 FROM quality_document_references qdr WHERE qdr.store_id=sm.store_id AND qdr.target_type='supply_material' AND qdr.target_id=sm.id AND qdr.relation_type='food_contact_declaration' AND qdr.archived_at IS NULL) ORDER BY sm.name`,
    cleaning_food_contact_products_without_attestation: `SELECT sm.id, sm.code, sm.name, sm.category FROM supplies_materials sm WHERE sm.store_id=$1::uuid AND sm.archived_at IS NULL AND sm.category = 'cleaning_product' AND COALESCE((sm.metadata->>'direct_food_contact')::boolean, (sm.metadata->>'food_contact')::boolean, false) = true AND NOT EXISTS (SELECT 1 FROM quality_document_references qdr WHERE qdr.store_id=sm.store_id AND qdr.target_type='supply_material' AND qdr.target_id=sm.id AND qdr.relation_type IN ('attestation','food_contact_declaration') AND qdr.archived_at IS NULL) ORDER BY sm.name`,
    without_category: `SELECT id, code, name, category FROM supplies_materials WHERE store_id=$1::uuid AND archived_at IS NULL AND COALESCE(category, '') = '' ORDER BY name`,
    broken_document_references: `SELECT qdr.* FROM quality_document_references qdr LEFT JOIN supplies_materials sm ON sm.id=qdr.target_id AND sm.store_id=qdr.store_id WHERE qdr.store_id=$1::uuid AND qdr.target_type='supply_material' AND qdr.archived_at IS NULL AND sm.id IS NULL`,
    probable_duplicates: `SELECT lower(name) AS name_key, category, COUNT(*)::integer AS count, json_agg(json_build_object('id', id, 'code', code, 'name', name)) AS items FROM supplies_materials WHERE store_id=$1::uuid AND archived_at IS NULL GROUP BY lower(name), category HAVING COUNT(*) > 1 ORDER BY count DESC`,
    cleaning_plans_with_legacy_product_text: `SELECT id, title, product_name FROM quality_cleaning_plans WHERE store_id=$1::uuid AND archived_at IS NULL AND supply_material_id IS NULL AND COALESCE(product_name, '') <> '' ORDER BY title`,
    archived_documents_still_referenced: `SELECT qdr.id, qdr.document_id, qdr.target_id, d.title AS document_title FROM quality_document_references qdr INNER JOIN quality_master_documents d ON d.id=qdr.document_id AND d.store_id=qdr.store_id WHERE qdr.store_id=$1::uuid AND qdr.target_type='supply_material' AND qdr.archived_at IS NULL AND (d.archived_at IS NOT NULL OR d.status='archived') ORDER BY d.title`,
    used_in_procedure_without_regulatory_documents: `SELECT sm.id, sm.code, sm.name, sm.category FROM supplies_materials sm INNER JOIN supply_material_links sml ON sml.supply_material_id=sm.id AND sml.store_id=sm.store_id AND sml.archived_at IS NULL AND sml.target_type='documentation_section' WHERE sm.store_id=$1::uuid AND sm.archived_at IS NULL AND NOT EXISTS (SELECT 1 FROM quality_document_references qdr WHERE qdr.store_id=sm.store_id AND qdr.target_type='supply_material' AND qdr.target_id=sm.id AND qdr.relation_type IN ('technical_sheet','safety_data_sheet','food_contact_declaration','attestation','certificate') AND qdr.archived_at IS NULL) ORDER BY sm.name`,
    used_in_pms_but_inactive: `SELECT sm.id, sm.code, sm.name, sm.category FROM supplies_materials sm INNER JOIN supply_material_links sml ON sml.supply_material_id=sm.id AND sml.store_id=sm.store_id AND sml.archived_at IS NULL AND sml.target_type IN ('documentation_section','pms_chapter') WHERE sm.store_id=$1::uuid AND sm.archived_at IS NULL AND sm.active=false ORDER BY sm.name`,
  };
  const result = {};
  for (const [key, sql] of Object.entries(queries)) {
    const queryResult = await db.query(sql, [storeId]);
    result[key] = queryResult.rows;
  }
  return {
    ok: true,
    generated_at: new Date().toISOString(),
    diagnostics: result,
  };
}

module.exports = {
  SUPPLY_MATERIAL_CATEGORIES,
  SUPPLY_MATERIAL_DOCUMENT_TYPES,
  SUPPLY_MATERIAL_LINK_TYPES,
  addSupplyMaterialDocumentReference,
  addSupplyMaterialLink,
  archiveSupplyMaterial,
  archiveSupplyMaterialDocumentReference,
  archiveSupplyMaterialLink,
  createSupplyMaterialDocumentFromUpload,
  createSupplyMaterial,
  diagnoseSuppliesMaterials,
  getSupplyMaterialDocumentFile,
  getSupplyMaterial,
  listSuppliesMaterials,
  listSupplyMaterialDocuments,
  listSupplyMaterialLinks,
  mapSupplyMaterialPayload,
  searchSuppliesMaterials,
  updateSupplyMaterial,
};
