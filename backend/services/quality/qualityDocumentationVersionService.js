const { stripHtml } = require('./qualityDocumentationTemplateService');

async function recordSectionVersion(db, storeId, section, userId, changeSummary = 'Modification', changeType = 'update', before = null) {
  const result = await db.query(
    `INSERT INTO quality_documentation_versions
     (section_id, store_id, previous_version, version, content_html, content_text, change_summary, change_type, previous_content_html, previous_content_text, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      section.id,
      storeId,
      before?.version || null,
      section.version || '1.0',
      section.content_html || '',
      section.content_text || stripHtml(section.content_html || ''),
      changeSummary,
      changeType,
      before?.content_html || null,
      before?.content_text || null,
      userId,
    ]
  );
  return result.rows[0];
}

async function listSectionVersions(db, storeId, sectionId) {
  const result = await db.query(
    `SELECT *
     FROM quality_documentation_versions
     WHERE store_id = $1 AND section_id = $2
     ORDER BY created_at DESC`,
    [storeId, sectionId]
  );
  return result.rows;
}

async function restoreSectionVersion(db, storeId, sectionId, versionId, userId) {
  const beforeResult = await db.query(
    'SELECT * FROM quality_documentation_sections WHERE id = $1 AND store_id = $2 LIMIT 1',
    [sectionId, storeId]
  );
  const before = beforeResult.rows[0];
  if (!before) return null;

  const versionResult = await db.query(
    'SELECT * FROM quality_documentation_versions WHERE id = $1 AND section_id = $2 AND store_id = $3 LIMIT 1',
    [versionId, sectionId, storeId]
  );
  const version = versionResult.rows[0];
  if (!version) return null;

  const restored = await db.query(
    `UPDATE quality_documentation_sections
     SET content_html = $3,
         content_text = $4,
         version = $5,
         updated_by = $6,
         updated_at = now()
     WHERE id = $1 AND store_id = $2
     RETURNING *`,
    [sectionId, storeId, version.content_html, version.content_text, version.version, userId]
  );
  await recordSectionVersion(db, storeId, restored.rows[0], userId, `Restauration de la version ${version.version}`, 'restore', before);
  return restored.rows[0];
}

module.exports = {
  listSectionVersions,
  recordSectionVersion,
  restoreSectionVersion,
};
