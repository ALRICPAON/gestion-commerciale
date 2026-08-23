const { logQualityEvent } = require('./eventLogger');
const { replaceTableCellText, updateTable } = require('./qualityDocumentationTableService');

const T2_C20_ATTACHMENT_ID = '69282466-c0fc-4050-9313-351eaf909d97';
const T2_C20_CODE = 'T2-C20';
const T4_C17_CODE = 'T4-C17';
const T4_C17_OLD_TEXT = 'Vérifier qualification et écarts pertinents';
const T4_C17_NEW_TEXT = 'Vérifier le statut actif du fournisseur et les écarts pertinents';

function bool(value) {
  return value === true || value === 'true' || value === '1';
}

async function findSectionByCode(db, storeId, code) {
  const result = await db.query(
    `SELECT *
     FROM quality_documentation_sections
     WHERE store_id = $1
       AND code = $2
       AND archived_at IS NULL
     LIMIT 1`,
    [storeId, code]
  );
  return result.rows[0] || null;
}

async function detachAttachmentFromChapter(db, storeId, userId, options = {}) {
  const dryRun = !bool(options.apply);
  const sectionCode = options.sectionCode || T2_C20_CODE;
  const attachmentId = options.attachmentId || T2_C20_ATTACHMENT_ID;
  const section = await findSectionByCode(db, storeId, sectionCode);
  if (!section) return { ok: false, action: 'detach_attachment', reason: 'section_not_found', section_code: sectionCode };

  const attachmentResult = await db.query(
    `SELECT *
     FROM quality_documentation_attachments
     WHERE id = $1
       AND store_id = $2
       AND section_id = $3
     LIMIT 1`,
    [attachmentId, storeId, section.id]
  );
  const attachment = attachmentResult.rows[0] || null;
  if (!attachment) return { ok: true, action: 'detach_attachment', mode: 'noop', reason: 'attachment_not_linked_to_section', section_code: sectionCode, attachment_id: attachmentId };
  if (attachment.archived_at) return { ok: true, action: 'detach_attachment', mode: 'noop', reason: 'attachment_already_archived', section_code: sectionCode, attachment_id: attachmentId };

  const otherBlockRefs = await db.query(
    `SELECT b.id, s.code
     FROM quality_document_blocks b
     JOIN quality_documentation_sections s ON s.id = b.chapter_id AND s.store_id = b.store_id
     WHERE b.store_id = $1
       AND b.content->>'attachment_id' = $2
       AND b.chapter_id <> $3
     ORDER BY s.code ASC`,
    [storeId, attachmentId, section.id]
  );
  if (otherBlockRefs.rows.length) {
    const err = new Error(`Piece ${attachmentId} encore referencee par un autre chapitre: ${otherBlockRefs.rows.map((row) => row.code).join(', ')}`);
    err.status = 409;
    throw err;
  }

  const residualBlocks = await db.query(
    `SELECT id
     FROM quality_document_blocks
     WHERE store_id = $1
       AND chapter_id = $2
       AND content->>'attachment_id' = $3`,
    [storeId, section.id, attachmentId]
  );
  const siblingAttachments = attachment.document_id ? await db.query(
    `SELECT COUNT(*)::int AS count
     FROM quality_documentation_attachments
     WHERE store_id = $1
       AND document_id = $2
       AND id <> $3
       AND archived_at IS NULL`,
    [storeId, attachment.document_id, attachmentId]
  ) : { rows: [{ count: 0 }] };

  if (dryRun) {
    return {
      ok: true,
      action: 'detach_attachment',
      mode: 'dry_run',
      section_code: sectionCode,
      attachment_id: attachmentId,
      residual_block_count: residualBlocks.rows.length,
      preserved_same_document_references: Number(siblingAttachments.rows[0]?.count || 0),
    };
  }

  await db.query(
    `DELETE FROM quality_document_blocks
     WHERE store_id = $1
       AND chapter_id = $2
       AND content->>'attachment_id' = $3`,
    [storeId, section.id, attachmentId]
  );
  const updated = await db.query(
    `UPDATE quality_documentation_attachments
     SET archived_at = COALESCE(archived_at, now())
     WHERE id = $1
       AND store_id = $2
       AND section_id = $3
     RETURNING *`,
    [attachmentId, storeId, section.id]
  );
  await logQualityEvent({
    dbPool: db,
    storeId,
    actorId: userId,
    eventType: 'quality.documentation.lot3a.attachment_detached',
    targetType: 'quality_documentation_attachment',
    targetId: attachmentId,
    before: attachment,
    after: updated.rows[0],
    metadata: { section_code: sectionCode, residual_block_count: residualBlocks.rows.length },
  });

  return {
    ok: true,
    action: 'detach_attachment',
    mode: 'applied',
    section_code: sectionCode,
    attachment_id: attachmentId,
    residual_block_count: residualBlocks.rows.length,
    preserved_same_document_references: Number(siblingAttachments.rows[0]?.count || 0),
  };
}

async function updateSupplierStatusCell(db, storeId, userId, options = {}) {
  const dryRun = !bool(options.apply);
  const sectionCode = options.sectionCode || T4_C17_CODE;
  const oldText = options.oldText || T4_C17_OLD_TEXT;
  const newText = options.newText || T4_C17_NEW_TEXT;
  const section = await findSectionByCode(db, storeId, sectionCode);
  if (!section) return { ok: false, action: 'update_table_cell', reason: 'section_not_found', section_code: sectionCode };

  const result = await db.query(
    `SELECT *
     FROM quality_document_tables
     WHERE store_id = $1
       AND section_id = $2
       AND archived_at IS NULL
     ORDER BY created_at ASC, id ASC`,
    [storeId, section.id]
  );

  const candidates = result.rows
    .map((table) => ({ table, replacement: replaceTableCellText(table.table_data, oldText, newText) }))
    .filter((item) => item.replacement.replacements > 0);
  const replacementCount = candidates.reduce((sum, item) => sum + item.replacement.replacements, 0);

  if (!replacementCount) return { ok: true, action: 'update_table_cell', mode: 'noop', reason: 'cell_text_not_found', section_code: sectionCode };
  if (replacementCount > 1 || candidates.length > 1) {
    const err = new Error(`Correction T4-C17 refusee: ${replacementCount} cellules candidates trouvees`);
    err.status = 409;
    throw err;
  }

  const candidate = candidates[0];
  if (dryRun) {
    return {
      ok: true,
      action: 'update_table_cell',
      mode: 'dry_run',
      section_code: sectionCode,
      table_id: candidate.table.id,
      replacements: replacementCount,
    };
  }

  const updated = await updateTable(db, storeId, candidate.table.id, userId, {
    table_data: candidate.replacement.table_data,
    table_type: candidate.table.table_type,
  });

  return {
    ok: true,
    action: 'update_table_cell',
    mode: 'applied',
    section_code: sectionCode,
    table_id: updated.id,
    replacements: replacementCount,
  };
}

async function cleanupLot3aTechnicalDebt(db, storeId, userId, options = {}) {
  return {
    dry_run: !bool(options.apply),
    attachment: await detachAttachmentFromChapter(db, storeId, userId, options),
    table_cell: await updateSupplierStatusCell(db, storeId, userId, options),
  };
}

module.exports = {
  T2_C20_ATTACHMENT_ID,
  T2_C20_CODE,
  T4_C17_CODE,
  T4_C17_NEW_TEXT,
  T4_C17_OLD_TEXT,
  cleanupLot3aTechnicalDebt,
  detachAttachmentFromChapter,
  updateSupplierStatusCell,
};
