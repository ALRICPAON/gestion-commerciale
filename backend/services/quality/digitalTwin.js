const { logQualityEvent } = require('./eventLogger');

function uniqueError(err, message) {
  if (err && err.code === '23505') {
    err.status = 409;
    err.publicMessage = message;
  }
  return err;
}

function listWhere(query, alias, params) {
  const where = [`${alias}.store_id = $1`];
  const includeArchived = ['true', '1', 'yes'].includes(String(query.include_archived || '').toLowerCase());
  if (!includeArchived) where.push(`${alias}.status <> 'archived'`, `${alias}.deleted_at IS NULL`);
  if (query.status) {
    params.push(String(query.status));
    where.push(`${alias}.status = $${params.length}`);
  }
  if (query.type) {
    params.push(String(query.type));
    where.push(`${alias}.type = $${params.length}`);
  }
  if (query.search && String(query.search).trim()) {
    params.push(`%${String(query.search).trim()}%`);
    where.push(`(${alias}.code ILIKE $${params.length} OR ${alias}.name ILIKE $${params.length} OR COALESCE(${alias}.description, '') ILIKE $${params.length})`);
  }
  return where;
}

async function logEvent(db, storeId, actorId, eventType, targetType, targetId, before, after) {
  await logQualityEvent({ dbPool: db, storeId, actorId, eventType, targetType, targetId, before, after });
}

async function listZones(db, storeId, query = {}) {
  const params = [storeId];
  const where = listWhere(query, 'z', params);
  const result = await db.query(`SELECT z.* FROM quality_zones z WHERE ${where.join(' AND ')} ORDER BY z.status ASC, z.name ASC`, params);
  return result.rows;
}

async function getZone(db, storeId, zoneId) {
  const result = await db.query('SELECT * FROM quality_zones WHERE id = $1 AND store_id = $2 LIMIT 1', [zoneId, storeId]);
  return result.rows[0] || null;
}

async function createZone(db, storeId, userId, payload) {
  try {
    const result = await db.query(
      `INSERT INTO quality_zones (store_id, code, name, type, description, surface_area, capacity, status, responsible_user_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING *`,
      [storeId, payload.code, payload.name, payload.type, payload.description, payload.surface_area, payload.capacity, payload.status, payload.responsible_user_id, userId]
    );
    await logEvent(db, storeId, userId, 'quality.zone.created', 'quality_zone', result.rows[0].id, null, result.rows[0]);
    return result.rows[0];
  } catch (err) {
    throw uniqueError(err, 'Une zone avec ce code existe déjà pour ce magasin');
  }
}

async function updateZone(db, storeId, userId, zoneId, payload) {
  const before = await getZone(db, storeId, zoneId);
  if (!before) return null;
  try {
    const result = await db.query(
      `UPDATE quality_zones
       SET code=$3, name=$4, type=$5, description=$6, surface_area=$7, capacity=$8, status=$9,
           responsible_user_id=$10, updated_by=$11, updated_at=now()
       WHERE id=$1 AND store_id=$2 RETURNING *`,
      [zoneId, storeId, payload.code, payload.name, payload.type, payload.description, payload.surface_area, payload.capacity, payload.status, payload.responsible_user_id, userId]
    );
    await logEvent(db, storeId, userId, 'quality.zone.updated', 'quality_zone', zoneId, before, result.rows[0]);
    return result.rows[0];
  } catch (err) {
    throw uniqueError(err, 'Une zone avec ce code existe déjà pour ce magasin');
  }
}

async function changeZoneStatus(db, storeId, userId, zoneId, status) {
  const before = await getZone(db, storeId, zoneId);
  if (!before) return null;
  const result = await db.query(
    `UPDATE quality_zones
     SET status=$3, deleted_at=CASE WHEN $3='archived' THEN COALESCE(deleted_at, now()) ELSE deleted_at END,
         updated_by=$4, updated_at=now()
     WHERE id=$1 AND store_id=$2 RETURNING *`,
    [zoneId, storeId, status, userId]
  );
  await logEvent(db, storeId, userId, 'quality.zone.status_changed', 'quality_zone', zoneId, before, result.rows[0]);
  return result.rows[0];
}

async function deleteOrArchiveZone(db, storeId, userId, zoneId) {
  const before = await getZone(db, storeId, zoneId);
  if (!before) return null;
  const linked = await db.query('SELECT id FROM quality_equipments WHERE zone_id = $1 AND store_id = $2 LIMIT 1', [zoneId, storeId]);
  if (linked.rows.length > 0) {
    const zone = await changeZoneStatus(db, storeId, userId, zoneId, 'archived');
    return { mode: 'archived', message: 'Zone liée à au moins un équipement : archivage effectué', zone };
  }
  await db.query('DELETE FROM quality_zones WHERE id = $1 AND store_id = $2', [zoneId, storeId]);
  await logEvent(db, storeId, userId, 'quality.zone.deleted', 'quality_zone', zoneId, before, null);
  return { mode: 'deleted', message: 'Zone supprimée', zone: before };
}

async function listEquipments(db, storeId, query = {}) {
  const params = [storeId];
  const where = listWhere(query, 'e', params);
  if (query.zone_id) {
    params.push(String(query.zone_id));
    where.push(`e.zone_id = $${params.length}`);
  }
  const result = await db.query(
    `SELECT e.*, z.code AS zone_code, z.name AS zone_name, z.status AS zone_status
     FROM quality_equipments e
     INNER JOIN quality_zones z ON z.id = e.zone_id AND z.store_id = e.store_id
     WHERE ${where.join(' AND ')}
     ORDER BY e.status ASC, e.name ASC`,
    params
  );
  return result.rows;
}

async function getEquipment(db, storeId, equipmentId) {
  const result = await db.query(
    `SELECT e.*, z.code AS zone_code, z.name AS zone_name, z.status AS zone_status
     FROM quality_equipments e
     INNER JOIN quality_zones z ON z.id = e.zone_id AND z.store_id = e.store_id
     WHERE e.id = $1 AND e.store_id = $2 LIMIT 1`,
    [equipmentId, storeId]
  );
  return result.rows[0] || null;
}

async function assertWritableZone(db, storeId, zoneId) {
  const zone = await getZone(db, storeId, zoneId);
  if (!zone || zone.deleted_at || zone.status === 'archived') {
    const err = new Error('Zone qualité introuvable ou archivée');
    err.status = 400;
    throw err;
  }
  return zone;
}

function inactiveZoneWarning(zone) {
  return zone.status === 'inactive' ? 'La zone rattachée est inactive' : null;
}

async function createEquipment(db, storeId, userId, payload) {
  const zone = await assertWritableZone(db, storeId, payload.zone_id);
  try {
    const result = await db.query(
      `INSERT INTO quality_equipments (
        store_id, zone_id, code, name, type, description, manufacturer, model, serial_number, supplier_name,
        purchase_date, warranty_end_date, status, is_food_contact, is_temperature_controlled, requires_cleaning,
        requires_maintenance, requires_calibration, criticality, created_by, updated_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$20) RETURNING *`,
      [storeId, payload.zone_id, payload.code, payload.name, payload.type, payload.description, payload.manufacturer, payload.model, payload.serial_number, payload.supplier_name, payload.purchase_date, payload.warranty_end_date, payload.status, payload.is_food_contact, payload.is_temperature_controlled, payload.requires_cleaning, payload.requires_maintenance, payload.requires_calibration, payload.criticality, userId]
    );
    await logEvent(db, storeId, userId, 'quality.equipment.created', 'quality_equipment', result.rows[0].id, null, result.rows[0]);
    return { equipment: result.rows[0], warning: inactiveZoneWarning(zone) };
  } catch (err) {
    throw uniqueError(err, 'Un équipement avec ce code existe déjà pour ce magasin');
  }
}

async function updateEquipment(db, storeId, userId, equipmentId, payload) {
  const before = await getEquipment(db, storeId, equipmentId);
  if (!before) return null;
  const zone = await assertWritableZone(db, storeId, payload.zone_id);
  try {
    const result = await db.query(
      `UPDATE quality_equipments
       SET zone_id=$3, code=$4, name=$5, type=$6, description=$7, manufacturer=$8, model=$9,
           serial_number=$10, supplier_name=$11, purchase_date=$12, warranty_end_date=$13, status=$14,
           is_food_contact=$15, is_temperature_controlled=$16, requires_cleaning=$17,
           requires_maintenance=$18, requires_calibration=$19, criticality=$20, updated_by=$21, updated_at=now()
       WHERE id=$1 AND store_id=$2 RETURNING *`,
      [equipmentId, storeId, payload.zone_id, payload.code, payload.name, payload.type, payload.description, payload.manufacturer, payload.model, payload.serial_number, payload.supplier_name, payload.purchase_date, payload.warranty_end_date, payload.status, payload.is_food_contact, payload.is_temperature_controlled, payload.requires_cleaning, payload.requires_maintenance, payload.requires_calibration, payload.criticality, userId]
    );
    await logEvent(db, storeId, userId, 'quality.equipment.updated', 'quality_equipment', equipmentId, before, result.rows[0]);
    return { equipment: result.rows[0], warning: inactiveZoneWarning(zone) };
  } catch (err) {
    throw uniqueError(err, 'Un équipement avec ce code existe déjà pour ce magasin');
  }
}

async function changeEquipmentStatus(db, storeId, userId, equipmentId, status) {
  const before = await getEquipment(db, storeId, equipmentId);
  if (!before) return null;
  const result = await db.query(
    `UPDATE quality_equipments
     SET status=$3, deleted_at=CASE WHEN $3='archived' THEN COALESCE(deleted_at, now()) ELSE deleted_at END,
         updated_by=$4, updated_at=now()
     WHERE id=$1 AND store_id=$2 RETURNING *`,
    [equipmentId, storeId, status, userId]
  );
  await logEvent(db, storeId, userId, 'quality.equipment.status_changed', 'quality_equipment', equipmentId, before, result.rows[0]);
  return result.rows[0];
}

async function deleteEquipment(db, storeId, userId, equipmentId) {
  const before = await getEquipment(db, storeId, equipmentId);
  if (!before) return null;
  await db.query('DELETE FROM quality_equipments WHERE id = $1 AND store_id = $2', [equipmentId, storeId]);
  await logEvent(db, storeId, userId, 'quality.equipment.deleted', 'quality_equipment', equipmentId, before, null);
  return { mode: 'deleted', message: 'Équipement supprimé', equipment: before };
}

module.exports = {
  listZones,
  getZone,
  createZone,
  updateZone,
  changeZoneStatus,
  deleteOrArchiveZone,
  listEquipments,
  getEquipment,
  createEquipment,
  updateEquipment,
  changeEquipmentStatus,
  deleteEquipment,
};
