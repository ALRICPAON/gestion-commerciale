const { addDocumentReference, archiveDocumentReference, getDocumentsForTarget } = require('./masterDocuments');
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
  'other',
]);

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
  const relationType = text(input.relation_type || input.document_relation_type) || 'reference';
  if (!SUPPLY_MATERIAL_DOCUMENT_TYPES.includes(relationType) && relationType !== 'reference') {
    const err = new Error('Type de document fourniture invalide');
    err.status = 400;
    throw err;
  }
  return addDocumentReference(db, storeId, userId, {
    document_id: input.document_id,
    target_type: 'supply_material',
    target_id: materialId,
    relation_type: relationType,
    label: input.label,
  });
}

async function archiveSupplyMaterialDocumentReference(db, storeId, userId, referenceId) {
  return archiveDocumentReference(db, storeId, userId, referenceId);
}

async function listSupplyMaterialLinks(db, storeId, materialId) {
  await assertMaterial(db, storeId, materialId);
  const result = await db.query(
    `SELECT sml.*
     FROM supply_material_links sml
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
    without_category: `SELECT id, code, name, category FROM supplies_materials WHERE store_id=$1::uuid AND archived_at IS NULL AND COALESCE(category, '') = '' ORDER BY name`,
    broken_document_references: `SELECT qdr.* FROM quality_document_references qdr LEFT JOIN supplies_materials sm ON sm.id=qdr.target_id AND sm.store_id=qdr.store_id WHERE qdr.store_id=$1::uuid AND qdr.target_type='supply_material' AND qdr.archived_at IS NULL AND sm.id IS NULL`,
    probable_duplicates: `SELECT lower(name) AS name_key, category, COUNT(*)::integer AS count, json_agg(json_build_object('id', id, 'code', code, 'name', name)) AS items FROM supplies_materials WHERE store_id=$1::uuid AND archived_at IS NULL GROUP BY lower(name), category HAVING COUNT(*) > 1 ORDER BY count DESC`,
    cleaning_plans_with_legacy_product_text: `SELECT id, title, product_name FROM quality_cleaning_plans WHERE store_id=$1::uuid AND archived_at IS NULL AND supply_material_id IS NULL AND COALESCE(product_name, '') <> '' ORDER BY title`,
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
  createSupplyMaterial,
  diagnoseSuppliesMaterials,
  getSupplyMaterial,
  listSuppliesMaterials,
  listSupplyMaterialDocuments,
  listSupplyMaterialLinks,
  mapSupplyMaterialPayload,
  searchSuppliesMaterials,
  updateSupplyMaterial,
};
