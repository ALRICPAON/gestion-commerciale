const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const { renderHtmlToPdf } = require('../pdf/pdfRenderer');
const { escapeHtml, fileSafe, formatDate, htmlDocument } = require('../pdf/pdfLayout');
const { getCompanyIdentity } = require('./companyIdentityService');
const { getDocumentation } = require('./qualityDocumentationService');
const { renderDocumentBlock } = require('./qualityDocumentBlockService');
const { getMasterDocument, listDocumentReferences } = require('./masterDocuments');

const EXPORT_DIR = path.resolve(__dirname, '..', '..', 'uploads', 'quality-documentation-exports');

fs.mkdirSync(EXPORT_DIR, { recursive: true });

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function isDdppProfile(options = {}) {
  return options.profile === 'ddpp' || options.export_type === 'ddpp';
}

function fixMojibake(value) {
  const text = String(value ?? '');
  const mapped = text
    .replace(/Ã©/g, 'é')
    .replace(/Ã¨/g, 'è')
    .replace(/Ãª/g, 'ê')
    .replace(/Ã«/g, 'ë')
    .replace(/Ã /g, 'à')
    .replace(/Ã¢/g, 'â')
    .replace(/Ã´/g, 'ô')
    .replace(/Ã¶/g, 'ö')
    .replace(/Ã»/g, 'û')
    .replace(/Ã¹/g, 'ù')
    .replace(/Ã§/g, 'ç')
    .replace(/Ã‰/g, 'É')
    .replace(/ÃŠ/g, 'Ê')
    .replace(/Â°/g, '°')
    .replace(/Â«/g, '«')
    .replace(/Â»/g, '»')
    .replace(/â€™/g, "'")
    .replace(/â€”/g, '-');
  if (!/[ÃÂâ]/.test(mapped)) return mapped;
  try {
    const decoded = Buffer.from(mapped, 'latin1').toString('utf8');
    const score = (candidate) => (candidate.match(/[ÃÂ�]/g) || []).length;
    return score(decoded) < score(mapped) ? decoded : mapped;
  } catch (_err) {
    return mapped;
  }
}

function displayText(value) {
  return fixMojibake(value).replace(/\s+/g, ' ').trim();
}

function ddppEscape(value) {
  return escapeHtml(displayText(value));
}

function stripTechnicalText(value) {
  return displayText(value)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, '')
    .replace(/\b(?:store_id|section_id|block_id|collection_id|source_record_id|quality_event_id|created_by|updated_by|missing_block|is_attached|payload|hash|mcp|api route)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function sanitizeDdppHtml(html = '') {
  return String(html || '')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, '')
    .replace(/\b(?:store_id|section_id|block_id|collection_id|source_record_id|quality_event_id|created_by|updated_by|missing_block|is_attached|payload|hash|mcp)\b\s*:?\s*/gi, '')
    .replace(/\b(?:draft|to_complete|ready_for_review|validated)\b/gi, '')
    .replace(/Ã©/g, 'é')
    .replace(/Ã¨/g, 'è')
    .replace(/Ãª/g, 'ê')
    .replace(/Ã /g, 'à')
    .replace(/Ã´/g, 'ô')
    .replace(/Ã§/g, 'ç')
    .replace(/Â°/g, '°')
    .replace(/Â«/g, '«')
    .replace(/Â»/g, '»');
}

function humanAttachmentTitle(item = {}) {
  const raw = displayText(item.original_filename || item.filename || item.title || item.name || 'Pièce jointe');
  const withoutExtension = raw.replace(/\.(pdf|png|jpe?g|docx?|xlsx?)$/i, '');
  const dateMatch = withoutExtension.match(/(\d{4})[._-](\d{2})[._-](\d{2})\s*(.*)/);
  if (dateMatch) {
    const [, year, month, day, rest] = dateMatch;
    const label = displayText(rest || withoutExtension).replace(/[-_]+/g, ' ');
    return `${label.charAt(0).toUpperCase()}${label.slice(1)} - ${formatDate(`${year}-${month}-${day}`)}`;
  }
  return withoutExtension.replace(/[-_]+/g, ' ');
}

function ddppApprovalLabel(identity = {}, options = {}) {
  if (options.show_sanitary_approval_number === true && identity.sanitary_approval_number) {
    return `Agrément sanitaire : ${displayText(identity.sanitary_approval_number)}`;
  }
  return 'Agrément sanitaire : demande en cours';
}

function paginationPreparationScript() {
  return `
    (() => {
      const mmToPx = (mm) => (mm * 96) / 25.4;
      const pageContentHeight = mmToPx(297 - 18 - 18);
      const selectors = [
        '.quality-pdf-block--keep',
        '.quality-diagram-block',
        '.quality-image-block',
        '.quality-to-complete-block'
      ].join(',');
      const forceBreak = (element) => {
        element.classList.add('quality-pdf-force-break');
        element.style.breakBefore = 'page';
        element.style.pageBreakBefore = 'always';
      };
      Array.from(document.querySelectorAll(selectors)).forEach((element) => {
        element.classList.remove('quality-pdf-force-break');
        element.classList.remove('quality-pdf-block--oversize');
        element.style.breakBefore = '';
        element.style.pageBreakBefore = '';
      });
      Array.from(document.querySelectorAll(selectors)).forEach((element) => {
        const rect = element.getBoundingClientRect();
        if (!rect.height) return;
        if (rect.height >= pageContentHeight) {
          element.classList.add('quality-pdf-block--oversize');
          return;
        }
        const top = element.getBoundingClientRect().top + window.scrollY;
        const usedOnPage = ((top % pageContentHeight) + pageContentHeight) % pageContentHeight;
        const remaining = pageContentHeight - usedOnPage;
        if (rect.height > remaining) forceBreak(element);
      });
    })();
  `;
}

function filteredSections(sections, options = {}) {
  return sections
    .filter((section) => !section.archived_at)
    .filter((section) => section.include_in_export !== false)
    .filter((section) => (options.only_validated ? section.status === 'validated' || section.section_type === 'tome' : true))
    .filter((section) => (options.tome_id ? section.id === options.tome_id || section.parent_id === options.tome_id : true));
}

function renderSectionContent(section, includeMissing) {
  let html = section.content_html || '<p></p>';
  if (!includeMissing) {
    html = html.replace(/<span[^>]*class=["'][^"']*missing-info[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, '');
  }
  return html;
}

function renderSectionBlocks(section, documentation, options = {}) {
  const blocks = (documentation.blocks || [])
    .filter((block) => block.chapter_id === section.id && block.is_visible !== false)
    .sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
  const html = blocks.length
    ? blocks.map((block) => renderPdfBlock(block, options)).join('\n')
    : renderSectionContent(section, options.include_missing !== false);
  return isDdppProfile(options) ? sanitizeDdppHtml(html) : html;
}

function tableRowCount(block) {
  return Number(block?.table?.table_data?.rows?.length || 0);
}

function pdfBlockClasses(block) {
  const classes = ['quality-pdf-block', `quality-pdf-block--${block.block_type}`];
  if (block.block_type === 'document_table') {
    classes.push(tableRowCount(block) > 18 ? 'quality-pdf-block--split-table' : 'quality-pdf-block--keep');
  } else if (['mermaid_diagram', 'image', 'to_complete'].includes(block.block_type)) {
    classes.push('quality-pdf-block--keep');
  } else if (block.block_type === 'separator') {
    classes.push('quality-pdf-block--separator');
  } else {
    classes.push('quality-pdf-block--flow');
  }
  return classes.join(' ');
}

function renderPdfBlock(block, options = {}) {
  const html = renderDocumentBlock(block, options);
  if (!html) return '';
  return `<div class="${pdfBlockClasses(block)}" data-quality-block-type="${escapeHtml(block.block_type)}">${html}</div>`;
}

function imageMimeType(attachment = {}) {
  const mimeType = String(attachment.mime_type || '').toLowerCase();
  if (mimeType.startsWith('image/')) return mimeType;
  const extension = path.extname(attachment.file_path || attachment.storage_path || '').toLowerCase();
  return {
    '.apng': 'image/apng',
    '.avif': 'image/avif',
    '.gif': 'image/gif',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
  }[extension] || '';
}

function resolveLocalAttachmentPath(attachment = {}) {
  const filePath = attachment.file_path || attachment.storage_path || '';
  if (!filePath) return '';
  return path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
}

function inlineImageDataUri(attachment = {}) {
  const mimeType = imageMimeType(attachment);
  if (!mimeType) return '';
  const filePath = resolveLocalAttachmentPath(attachment);
  if (!filePath || !fs.existsSync(filePath)) return '';
  return `data:${mimeType};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

async function collectMasterAnnexes(db, storeId, sections = []) {
  const chapterIds = new Set(sections.filter((section) => section.section_type !== 'tome').map((section) => String(section.id)));
  if (!chapterIds.size) return [];
  const references = await listDocumentReferences(db, storeId, { target_type: 'documentation_section', include_archived: false });
  const byDocumentId = new Map();
  for (const reference of references) {
    if (!chapterIds.has(String(reference.target_id))) continue;
    if (!['procedure', 'record_form'].includes(reference.document_type)) continue;
    if (reference.document_status !== 'valid') continue;
    if (reference.valid_until && new Date(reference.valid_until) < new Date()) continue;
    if (!byDocumentId.has(reference.document_id)) {
      const document = await getMasterDocument(db, storeId, reference.document_id);
      if (document && !document.archived_at) byDocumentId.set(reference.document_id, { document, references: [] });
    }
    byDocumentId.get(reference.document_id)?.references.push(reference);
  }
  return [...byDocumentId.values()].sort((a, b) => String(a.document.reference_number || a.document.title).localeCompare(String(b.document.reference_number || b.document.title)));
}

async function collectExternalMasterAttachments(db, storeId, sections = []) {
  const chapterIds = new Set(sections.filter((section) => section.section_type !== 'tome').map((section) => String(section.id)));
  if (!chapterIds.size) return [];
  const references = await listDocumentReferences(db, storeId, { target_type: 'documentation_section', include_archived: false });
  const byDocumentId = new Map();
  for (const reference of references) {
    if (!chapterIds.has(String(reference.target_id))) continue;
    if (['procedure', 'record_form'].includes(reference.document_type)) continue;
    if (reference.document_status === 'archived') continue;
    if (reference.valid_until && new Date(reference.valid_until) < new Date()) continue;
    if (!byDocumentId.has(reference.document_id)) {
      const document = await getMasterDocument(db, storeId, reference.document_id);
      if (document && !document.archived_at && document.storage_path) byDocumentId.set(reference.document_id, { document, references: [] });
    }
    byDocumentId.get(reference.document_id)?.references.push(reference);
  }
  return [...byDocumentId.values()].sort((a, b) => String(a.document.reference_number || a.document.title).localeCompare(String(b.document.reference_number || b.document.title)));
}

function supplyRelationLabel(relationType) {
  return {
    technical_sheet: 'Fiche technique',
    safety_data_sheet: 'FDS',
    food_contact_declaration: 'Declaration contact alimentaire',
    certificate: 'Certificat',
    manufacturer_notice: 'Notice fabricant',
    attestation: 'Attestation',
    supplier_document: 'Document fournisseur',
    product_photo: 'Photo produit',
    other: 'Document',
  }[relationType] || 'Document';
}

async function collectSupplyMaterialExternalAttachments(db, storeId, sections = []) {
  const chapters = sections.filter((section) => section.section_type !== 'tome');
  const chapterIds = chapters.map((section) => section.id).filter(Boolean);
  const chapterCodes = chapters.map((section) => section.code).filter(Boolean);
  if (!chapterIds.length && !chapterCodes.length) return [];
  const result = await db.query(
    `WITH used_supplies AS (
       SELECT DISTINCT sm.id, sm.code, sm.name, CONCAT_WS(' - ', qs.code, qs.title) AS usage_label
       FROM supplies_materials sm
       INNER JOIN supply_material_links sml ON sml.supply_material_id = sm.id AND sml.store_id = sm.store_id
       LEFT JOIN quality_documentation_sections qs ON qs.id = sml.target_id AND qs.store_id = sml.store_id
       WHERE sm.store_id = $1::uuid
         AND sm.archived_at IS NULL
         AND sml.archived_at IS NULL
         AND (
           (sml.target_type = 'documentation_section' AND sml.target_id = ANY($2::uuid[]))
           OR (sml.target_type = 'pms_chapter' AND sml.target_code = ANY($3::text[]))
         )
     )
     SELECT DISTINCT d.*, qdr.relation_type, us.code AS supply_code, us.name AS supply_name, us.usage_label
     FROM used_supplies us
     INNER JOIN quality_document_references qdr ON qdr.store_id = $1::uuid
      AND qdr.target_type = 'supply_material'
      AND qdr.target_id = us.id
      AND qdr.archived_at IS NULL
     INNER JOIN quality_master_documents d ON d.id = qdr.document_id AND d.store_id = qdr.store_id
     WHERE d.archived_at IS NULL
       AND d.status <> 'archived'
       AND d.storage_path IS NOT NULL
     ORDER BY us.name ASC, qdr.relation_type ASC, d.title ASC`,
    [storeId, chapterIds, chapterCodes]
  );
  const byDocumentId = new Map();
  for (const row of result.rows) {
    if (!byDocumentId.has(row.id)) {
      byDocumentId.set(row.id, { document: row, references: [] });
    }
    byDocumentId.get(row.id).references.push({
      target_type_label: 'Fourniture utilisee',
      target_label: [row.supply_code, row.supply_name].filter(Boolean).join(' - '),
      relation_type: row.relation_type,
      relation_type_label: supplyRelationLabel(row.relation_type),
      usage_label: row.usage_label,
    });
  }
  return [...byDocumentId.values()];
}

async function diagnoseSupplyMaterialExportCoverage(db, storeId, sections = []) {
  const chapters = sections.filter((section) => section.section_type !== 'tome');
  const chapterIds = chapters.map((section) => section.id).filter(Boolean);
  const chapterCodes = chapters.map((section) => section.code).filter(Boolean);
  if (!chapterIds.length && !chapterCodes.length) return [];
  const result = await db.query(
    `WITH used_supplies AS (
       SELECT DISTINCT sm.*
       FROM supplies_materials sm
       INNER JOIN supply_material_links sml ON sml.supply_material_id = sm.id AND sml.store_id = sm.store_id
       WHERE sm.store_id = $1::uuid
         AND sm.archived_at IS NULL
         AND sml.archived_at IS NULL
         AND (
           (sml.target_type = 'documentation_section' AND sml.target_id = ANY($2::uuid[]))
           OR (sml.target_type = 'pms_chapter' AND sml.target_code = ANY($3::text[]))
         )
     )
     SELECT id, code, name, category,
            EXISTS (SELECT 1 FROM quality_document_references qdr WHERE qdr.store_id=$1::uuid AND qdr.target_type='supply_material' AND qdr.target_id=used_supplies.id AND qdr.relation_type='technical_sheet' AND qdr.archived_at IS NULL) AS has_technical_sheet,
            EXISTS (SELECT 1 FROM quality_document_references qdr WHERE qdr.store_id=$1::uuid AND qdr.target_type='supply_material' AND qdr.target_id=used_supplies.id AND qdr.relation_type='safety_data_sheet' AND qdr.archived_at IS NULL) AS has_sds,
            EXISTS (SELECT 1 FROM quality_document_references qdr WHERE qdr.store_id=$1::uuid AND qdr.target_type='supply_material' AND qdr.target_id=used_supplies.id AND qdr.relation_type IN ('food_contact_declaration','attestation') AND qdr.archived_at IS NULL) AS has_food_contact_proof
     FROM used_supplies
     ORDER BY name`,
    [storeId, chapterIds, chapterCodes]
  );
  return result.rows.flatMap((row) => {
    const anomalies = [];
    if (row.category === 'cleaning_product' && !row.has_technical_sheet) anomalies.push(`${row.name} utilise sans fiche technique`);
    if (row.category === 'cleaning_product' && !row.has_sds) anomalies.push(`${row.name} utilise sans FDS`);
    if (row.category === 'food_packaging' && !row.has_food_contact_proof) anomalies.push(`${row.name} utilise sans declaration contact alimentaire`);
    return anomalies;
  });
}

function renderStructuredMasterContent(document) {
  const sections = [
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
  ];
  const structured = document.structured_content || {};
  const rows = sections.map(([key, label]) => {
    const value = structured[key] || '';
    if (!String(value).trim()) return '';
    return `<section class="procedure-section"><h3>${escapeHtml(label)}</h3><p>${escapeHtml(value).replace(/\n/g, '<br>')}</p></section>`;
  }).filter(Boolean).join('');
  return rows || `<section class="procedure-section"><h3>Contenu</h3><p>${escapeHtml(document.description || 'Aucun contenu renseigne.')}</p></section>`;
}

function renderMasterReferenceRows(references = []) {
  return references
    .filter((reference) => !reference.archived_at)
    .map((reference) => `<tr><td>${escapeHtml(reference.target_type_label || reference.target_type || '-')}</td><td>${escapeHtml(reference.target_label || reference.label || '-')}</td><td>${escapeHtml(reference.relation_type || '-')}</td></tr>`)
    .join('');
}

function renderMasterAnnexes(masterAnnexes = [], options = {}) {
  const ddpp = isDdppProfile(options);
  const rows = masterAnnexes.map(({ document, references }) => {
    const chapters = [...new Set(references.map((reference) => reference.target_label).filter(Boolean).map(stripTechnicalText))].join(', ');
    return `<tr><td>${ddppEscape(document.reference_number || '-')}</td><td>${ddppEscape(document.title)}</td><td>${ddppEscape(document.version || '-')}</td><td>${ddppEscape(chapters || '-')}</td></tr>`;
  }).join('');
  const contents = masterAnnexes.map(({ document }) => {
    const referenceRows = renderMasterReferenceRows(document.references || []);
    return `
      <section class="pdf-section">
        <h2>${ddppEscape(document.reference_number || '')} - ${ddppEscape(document.title)}</h2>
        <div class="section-meta">Version ${ddppEscape(document.version || '-')} - Application ${ddppEscape(formatDate(document.valid_from))}</div>
        <table>
          <tbody>
            <tr><th>Code / reference</th><td>${ddppEscape(document.reference_number || '-')}</td></tr>
            <tr><th>Categorie</th><td>${ddppEscape(document.category || '-')}</td></tr>
            <tr><th>Emetteur</th><td>${ddppEscape(document.issuer_name || '-')}</td></tr>
            <tr><th>Date emission</th><td>${ddppEscape(formatDate(document.issue_date))}</td></tr>
            <tr><th>Date application</th><td>${ddppEscape(formatDate(document.valid_from))}</td></tr>
          </tbody>
        </table>
        ${sanitizeDdppHtml(renderStructuredMasterContent(document))}
        ${ddpp ? '' : `<section class="procedure-section">
          <h3>Documents et objets associes</h3>
          <table><thead><tr><th>Type</th><th>Element</th><th>Relation</th></tr></thead><tbody>${referenceRows || '<tr><td colspan="3">Aucun rattachement.</td></tr>'}</tbody></table>
        </section>`}
      </section>
    `;
  }).join('');
  return `
    <section class="pdf-page">
      <h1>Table des annexes PMS</h1>
      <table><thead><tr><th>Code</th><th>Document</th><th>Version</th><th>Chapitres rattaches</th></tr></thead><tbody>${rows || '<tr><td colspan="4">Aucune procedure ou formulaire valide rattache.</td></tr>'}</tbody></table>
    </section>
    ${contents}
  `;
}

const MISSING_ITEM_TIMELINE_LABELS = Object.freeze({
  before_submission: 'Avant depot',
  before_opening: 'Avant ouverture',
  to_confirm: 'A confirmer',
  external_pending: 'En attente externe',
  future: 'Futur',
  after_instruction: 'Apres instruction',
  blocking: 'Blocage',
  normal: 'A traiter',
});

function missingTimelineLabel(severity) {
  return MISSING_ITEM_TIMELINE_LABELS[severity] || severity || 'A traiter';
}

function ddppMissingCategory(item = {}) {
  const text = `${item.severity || ''} ${item.description || ''}`.toLowerCase();
  if (/instruction|agr[ée]ment/.test(text)) return 'Après instruction';
  if (/terrain|d[ée]marrage|post|ouverture/.test(text)) return 'Post-ouverture';
  if (/contrat|cci|froid|extincteur|maintenance|externe|attente/.test(text)) return 'Attente externe';
  return 'Avant ouverture';
}

function renderDdppEnrExamples() {
  const examples = [
    ['ENR-005', 'Réception', 'Date, fournisseur, lot, conformité, décision et signature/responsable.'],
    ['ENR-017', 'Traçabilité lot', 'Identification du lot, origine, destinations, quantités et liens documentaires.'],
    ['ENR-006', 'Températures', 'Équipement contrôlé, date, mesure, conformité et action corrective si écart.'],
    ['ENR-010', 'Nettoyage', 'Zone/équipement, méthode, produit, contrôle visuel et validation.'],
    ['ENR-014', 'Nuisibles', 'Point contrôlé, observation, action et suivi prestataire si nécessaire.'],
  ];
  const rows = examples.map(([code, title, content]) => `
    <tr>
      <td>${escapeHtml(code)}</td>
      <td>${escapeHtml(title)}</td>
      <td>${escapeHtml(content)}</td>
    </tr>
  `).join('');
  return `
    <section class="pdf-page ddpp-enr-examples">
      <h1>Exemples de supports d'enregistrements ALTA</h1>
      <p class="ddpp-notice">Exemple de support ALTA - pré-ouverture - ne constitue pas un enregistrement d'exploitation.</p>
      <table><thead><tr><th>Support</th><th>Objet</th><th>Informations visibles pour la DDPP</th></tr></thead><tbody>${rows}</tbody></table>
    </section>
  `;
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function isPdf(item) {
  return String(item.mime_type || '').toLowerCase().includes('pdf') || /\.pdf$/i.test(item.filename || item.original_filename || '');
}

function isImage(item) {
  const mime = String(item.mime_type || '').toLowerCase();
  return mime.startsWith('image/png') || mime.startsWith('image/jpeg') || /\.(png|jpe?g)$/i.test(item.filename || item.original_filename || '');
}

function attachmentLabel(item) {
  return displayText(item.original_filename || item.filename || item.title || 'Pièce jointe');
}

function collectAttachmentAppendixItems(documentation, options = {}) {
  if (options.include_attachments === false) return [];
  return (documentation.attachments || [])
    .filter((item) => !item.archived_at && item.include_in_export !== false)
    .map((item) => ({
      source: 'chapter_attachment',
      id: item.id,
      title: isDdppProfile(options) ? humanAttachmentTitle(item) : attachmentLabel(item),
      section_title: stripTechnicalText(item.section_title),
      file_path: item.file_path,
      mime_type: item.mime_type,
      size: item.file_size,
      checksum_sha256: item.checksum_sha256,
    }));
}

function collectExternalAppendixItems(externalMasterAttachments = [], options = {}) {
  const ddpp = isDdppProfile(options);
  return externalMasterAttachments.map(({ document, references }) => {
    const firstReference = references?.[0] || {};
    const relationLabel = firstReference.relation_type_label || null;
    const title = ddpp ? humanAttachmentTitle(document) : attachmentLabel(document);
    return {
      source: 'external_master_document',
      id: document.id,
      title: relationLabel ? `${displayText(relationLabel)} - ${title}` : title,
      section_title: [...new Set(references.map((reference) => stripTechnicalText(reference.usage_label || reference.target_label)).filter(Boolean))].join(', '),
      relation_type_label: relationLabel || document.mime_type || '-',
      file_path: document.storage_path,
      mime_type: document.mime_type,
      size: document.file_size,
      checksum_sha256: document.checksum_sha256,
    };
  });
}

function dedupeAppendixItems(items = []) {
  const seen = new Set();
  const deduped = [];
  const duplicates = [];
  for (const item of items) {
    const key = item.checksum_sha256
      || (item.file_path ? `path:${path.resolve(item.file_path)}` : '')
      || (item.id ? `${item.source}:${item.id}` : `${item.source}:${item.title}:${item.size || ''}`);
    if (seen.has(key)) {
      duplicates.push(item);
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }
  return { deduped, duplicates };
}

function drawWrappedText(page, text, x, y, maxWidth, font, size, options = {}) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  let line = '';
  let currentY = y;
  const lineHeight = options.lineHeight || size * 1.4;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
      page.drawText(line, { x, y: currentY, size, font, color: options.color || rgb(0.16, 0.22, 0.28) });
      currentY -= lineHeight;
      line = word;
    } else {
      line = test;
    }
  }
  if (line) page.drawText(line, { x, y: currentY, size, font, color: options.color || rgb(0.16, 0.22, 0.28) });
  return currentY - lineHeight;
}

async function appendNoticePage(pdfDoc, item, reason) {
  const page = pdfDoc.addPage([595.28, 841.89]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  page.drawText('Annexe non embarquee', { x: 54, y: 760, size: 18, font: bold, color: rgb(0.15, 0.22, 0.29) });
  let y = drawWrappedText(page, attachmentLabel(item), 54, 720, 480, bold, 12);
  y = drawWrappedText(page, item.section_title ? `Chapitre rattache : ${item.section_title}` : 'Chapitre rattache : non precise', 54, y - 8, 480, font, 10);
  drawWrappedText(page, `Motif : ${reason || 'format non embarquable dans le PDF final'}`, 54, y - 8, 480, font, 10, { color: rgb(0.45, 0.22, 0.08) });
}

async function appendImagePage(pdfDoc, item, buffer) {
  const page = pdfDoc.addPage([595.28, 841.89]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const mime = String(item.mime_type || '').toLowerCase();
  const image = mime.includes('png') || /\.png$/i.test(item.title || '') ? await pdfDoc.embedPng(buffer) : await pdfDoc.embedJpg(buffer);
  const maxWidth = 487;
  const maxHeight = 610;
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  const width = image.width * scale;
  const height = image.height * scale;
  page.drawText('Annexe image', { x: 54, y: 760, size: 18, font: bold, color: rgb(0.15, 0.22, 0.29) });
  drawWrappedText(page, attachmentLabel(item), 54, 730, 480, font, 11);
  page.drawImage(image, { x: (595.28 - width) / 2, y: 95 + (maxHeight - height) / 2, width, height });
}

async function appendPdfAttachment(pdfDoc, buffer) {
  const sourcePdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const pages = await pdfDoc.copyPages(sourcePdf, sourcePdf.getPageIndices());
  pages.forEach((page) => pdfDoc.addPage(page));
  return pages.length;
}

async function mergeAppendices(mainPdf, appendixItems = [], logger = console) {
  const pdfDoc = await PDFDocument.load(mainPdf);
  const summary = {
    embedded_attachments: 0,
    embedded_pages: 0,
    non_embeddable: 0,
    duplicates: 0,
    anomalies: [],
  };
  const { deduped, duplicates } = dedupeAppendixItems(appendixItems);
  summary.duplicates = duplicates.length;
  for (const item of deduped) {
    try {
      if (!item.file_path || !fs.existsSync(item.file_path)) throw new Error('fichier absent');
      const buffer = fs.readFileSync(item.file_path);
      item.checksum_sha256 = item.checksum_sha256 || sha256Buffer(buffer);
      if (isPdf(item)) {
        const pages = await appendPdfAttachment(pdfDoc, buffer);
        summary.embedded_attachments += 1;
        summary.embedded_pages += pages;
      } else if (isImage(item)) {
        await appendImagePage(pdfDoc, item, buffer);
        summary.embedded_attachments += 1;
        summary.embedded_pages += 1;
      } else {
        summary.non_embeddable += 1;
        await appendNoticePage(pdfDoc, item, 'format non embarquable');
      }
    } catch (err) {
      summary.non_embeddable += 1;
      summary.anomalies.push({ source: item.source, title: attachmentLabel(item), reason: err.message });
      logger.warn?.('Annexe qualite non embarquee', { source: item.source, title: attachmentLabel(item), reason: err.message });
      await appendNoticePage(pdfDoc, item, err.message);
    }
  }
  return { pdf: Buffer.from(await pdfDoc.save()), summary };
}

function buildHtml(documentation, identity, options = {}) {
  const ddpp = isDdppProfile(options);
  const { collection, missing_items: missingItems, attachments } = documentation;
  const renderOptions = {
    ...options,
    resolveImageSrc: options.resolveImageSrc || inlineImageDataUri,
  };
  const masterAnnexes = documentation.master_annexes || [];
  const externalMasterAttachments = documentation.external_master_attachments || [];
  const sections = filteredSections(documentation.sections, options);
  const chapters = sections.filter((section) => section.section_type !== 'tome');
  const attachmentAppendixItems = collectAttachmentAppendixItems(documentation, options);
  const externalAppendixItems = options.include_external_master_documents ? collectExternalAppendixItems(externalMasterAttachments, options) : [];
  const revisionRows = chapters.slice(0, ddpp ? 12 : 20).map((section) => `
    <tr>
      <td>${ddppEscape(section.version)}</td>
      <td>${ddppEscape(formatDate(section.updated_at))}</td>
      ${ddpp ? '' : `<td>${escapeHtml(section.updated_by || '-')}</td><td>${escapeHtml(section.validated_by || '-')}</td>`}
      <td>${ddppEscape(section.title)}</td>
    </tr>
  `).join('');
  const tocRows = sections.map((section) => `
    <tr>
      <td>${ddppEscape(section.code)}</td>
      <td>${section.section_type === 'tome' ? '<strong>' : ''}${ddppEscape(section.title)}${section.section_type === 'tome' ? '</strong>' : ''}</td>
      ${ddpp ? `<td class="toc-page"><a href="#section-${escapeHtml(section.id)}">Page</a></td>` : `<td>${escapeHtml(section.status)}</td>`}
    </tr>
  `).join('');
  const body = sections.map((section) => `
    <section id="section-${escapeHtml(section.id)}" class="${section.section_type === 'tome' ? 'pdf-tome' : 'pdf-section'}">
      <h${section.section_type === 'tome' ? '1' : '2'}>${ddppEscape(section.code)} - ${ddppEscape(section.title)}</h${section.section_type === 'tome' ? '1' : '2'}>
      <div class="section-meta">Version ${ddppEscape(section.version)}${ddpp ? '' : ` - Statut ${escapeHtml(section.status)} - Code ${escapeHtml(section.code)}`}</div>
      <div class="rich-content">${section.section_type === 'tome' ? (ddpp ? sanitizeDdppHtml(renderSectionContent(section, options.include_missing !== false)) : renderSectionContent(section, options.include_missing !== false)) : renderSectionBlocks(section, documentation, renderOptions)}</div>
    </section>
  `).join('');
  const missingRows = missingItems
    .filter((item) => item.status !== 'resolved')
    .map((item) => ddpp
      ? `<tr><td>${ddppEscape(ddppMissingCategory(item))}</td><td>${ddppEscape(item.section_code)}</td><td>${ddppEscape(item.section_title)}</td><td>${ddppEscape(item.description)}</td></tr>`
      : `<tr><td>${escapeHtml(item.section_code)}</td><td>${escapeHtml(item.section_title)}</td><td class="missing">${escapeHtml(item.description)}</td><td>${escapeHtml(missingTimelineLabel(item.severity))}</td><td>${escapeHtml(formatDate(item.due_at))}</td></tr>`)
    .join('');
  const attachmentRows = attachments
    .filter((item) => !item.archived_at && item.include_in_export !== false)
    .map((item) => ddpp
      ? `<tr><td>${ddppEscape(item.section_title)}</td><td>${ddppEscape(humanAttachmentTitle(item))}</td><td>Pièce jointe en annexe</td></tr>`
      : `<tr><td>${escapeHtml(item.section_title)}</td><td>${escapeHtml(item.filename)}</td><td>${escapeHtml(item.mime_type || '-')}</td></tr>`)
    .join('');
  const externalAttachmentRows = externalAppendixItems
    .map((item) => `<tr><td>${ddppEscape(item.section_title || '-')}</td><td>${ddppEscape(item.title)}</td><td>${ddppEscape(item.relation_type_label || (ddpp ? 'Document externe en annexe' : item.mime_type) || '-')}</td></tr>`)
    .join('');
  const annexCount = attachmentAppendixItems.length + externalAppendixItems.length;

  const coverAddress = [identity.address_line1, identity.address_line2, [identity.postal_code, identity.city].filter(Boolean).join(' '), identity.country].filter(Boolean).join('<br>');
  const logo = identity.logo_url ? `<img class="cover-logo" src="${escapeHtml(identity.logo_url)}" alt="Logo">` : '';
  const coverTitle = ddpp ? "Manuel qualité et dossier d'agrément sanitaire" : collection.title;
  const establishment = ddpp
    ? "Case n°13 - Centre de Marée - 85100 Les Sables-d'Olonne"
    : coverAddress;
  const content = `
    <main class="quality-pdf ${ddpp ? 'quality-pdf--ddpp' : ''}">
      <section class="cover">
        ${logo}
        <h1>${ddppEscape(identity.company_name)}</h1>
        <h2>${ddppEscape(coverTitle)}</h2>
        <p><strong>Établissement :</strong> ${ddppEscape(establishment)}</p>
        <p>${ddppEscape(ddpp ? ddppApprovalLabel(identity, options) : (identity.sanitary_approval_number ? `Agrement sanitaire : ${identity.sanitary_approval_number}` : ''))}</p>
        <p>Version documentaire ${ddppEscape(collection.version)} - Date d'édition ${ddppEscape(formatDate(new Date()))}</p>
        ${ddpp ? '' : '<strong>Document maitrise</strong>'}
      </section>
      <section class="pdf-page">
        <h1>${ddpp ? 'Synthèse documentaire' : 'Historique des revisions'}</h1>
        <table><thead><tr><th>Version</th><th>Date</th>${ddpp ? '' : '<th>Auteur</th><th>Validateur</th>'}<th>Chapitre / motif</th></tr></thead><tbody>${revisionRows || `<tr><td colspan="${ddpp ? '3' : '5'}">Aucune revision.</td></tr>`}</tbody></table>
      </section>
      <section class="pdf-page">
        <h1>Sommaire</h1>
        <table class="toc-table"><thead><tr><th>Code</th><th>Titre</th><th>${ddpp ? 'Page' : 'Statut'}</th></tr></thead><tbody>${tocRows}</tbody></table>
      </section>
      <section class="pdf-page">
        <h1>Table des annexes</h1>
        <table>
          <thead><tr><th>Famille</th><th>Nombre</th><th>Integration</th></tr></thead>
          <tbody>
            <tr><td>Procedures et formulaires rattaches</td><td>${masterAnnexes.length}</td><td>${options.include_master_annexes ? 'Rendu dans le dossier' : 'Non demande'}</td></tr>
            <tr><td>Pieces jointes des chapitres</td><td>${attachmentAppendixItems.length}</td><td>${options.include_attachments === false ? 'Non demande' : 'Fusion en annexe si possible'}</td></tr>
            <tr><td>Documents externes associes</td><td>${externalAppendixItems.length}</td><td>${options.include_external_master_documents ? 'Fusion en annexe si possible' : 'Non demande'}</td></tr>
          </tbody>
        </table>
      </section>
      ${options.include_missing === false ? '' : (ddpp
        ? `<section class="pdf-page ddpp-open-items"><h1>Éléments restant à compléter selon l'avancement du projet</h1><table><thead><tr><th>Temporalité</th><th>Code</th><th>Chapitre</th><th>Élément</th></tr></thead><tbody>${missingRows || '<tr><td colspan="4">Aucun élément ouvert.</td></tr>'}</tbody></table></section>`
        : `<section class="pdf-page"><h1>Informations a completer</h1><table><thead><tr><th>Code</th><th>Chapitre</th><th>Point</th><th>Temporalite</th><th>Echeance</th></tr></thead><tbody>${missingRows || '<tr><td colspan="5">Aucune information manquante ouverte.</td></tr>'}</tbody></table></section>`)}
      ${body}
      ${options.include_attachments === false ? '' : `<section class="pdf-page"><h1>Annexes</h1><table><thead><tr><th>Chapitre</th><th>Fichier</th><th>Type</th></tr></thead><tbody>${attachmentRows || '<tr><td colspan="3">Aucune annexe incluse.</td></tr>'}</tbody></table></section>`}
      ${options.include_external_master_documents ? `<section class="pdf-page"><h1>Documents externes associes</h1><table><thead><tr><th>Chapitres rattaches</th><th>Document</th><th>Type</th></tr></thead><tbody>${externalAttachmentRows || '<tr><td colspan="3">Aucun document externe a embarquer.</td></tr>'}</tbody></table></section>` : ''}
      ${ddpp && options.include_enr_examples !== false ? renderDdppEnrExamples() : ''}
      ${options.include_master_annexes ? renderMasterAnnexes(masterAnnexes, options) : ''}
      ${annexCount ? `<section class="pdf-page"><h1>Annexes fichiers</h1><p>Les fichiers PDF et images inclus sont ajoutes apres cette page. Les autres formats font l'objet d'une page de signalement.</p></section>` : ''}
    </main>
  `;

  const styles = `
    @page {
      size: A4;
      margin: 18mm 12mm 18mm 12mm;
      @top-left { content: "${escapeHtml(identity.company_name)}"; }
      @top-center { content: "${ddpp ? 'Manuel qualite / PMS' : 'Manuel qualite'}"; }
      @top-right { content: "Version ${escapeHtml(collection.version)}"; }
      @bottom-left { content: "${ddpp ? 'ALTA MAREE - DDPP' : 'Document maitrise'}"; }
      @bottom-center { content: "${todayIso()}"; }
      @bottom-right { content: "${ddpp ? 'Manuel - page ' : 'Page '} " counter(page) " / " counter(pages); }
    }
    body { font-size: 12px; }
    .cover { align-items: center; display: flex; flex-direction: column; justify-content: center; min-height: 250mm; text-align: center; page-break-after: always; }
    .cover-logo { max-height: 34mm; max-width: 58mm; object-fit: contain; margin-bottom: 18mm; }
    .cover h1 { font-size: 30px; margin: 0 0 8mm; }
    .cover h2 { font-size: 20px; margin: 0 0 8mm; }
    .quality-pdf--ddpp .cover { min-height: 235mm; }
    .quality-pdf--ddpp .cover h1 { letter-spacing: 0; text-transform: uppercase; }
    .quality-pdf--ddpp .section-meta { color: #4b5563; }
    .toc-table a { color: inherit; text-decoration: none; }
    .toc-page a::after { content: target-counter(attr(href), page); }
    .ddpp-notice { border: 1px solid #94a3b8; background: #f8fafc; color: #263746; font-weight: 700; padding: 8px 10px; }
    .pdf-page, .pdf-tome { page-break-before: always; }
    h1, h2, h3 { break-after: avoid-page; page-break-after: avoid; color: #263746; orphans: 3; widows: 3; }
    h1 { font-size: 22px; }
    h2 { font-size: 17px; }
    .section-meta { color: #52616f; font-size: 10px; margin-bottom: 8px; }
    .rich-content p { orphans: 3; widows: 3; }
    .rich-content ul,
    .rich-content ol { break-inside: avoid-page; page-break-inside: avoid; }
    .rich-content li { break-inside: avoid; page-break-inside: avoid; }
    .quality-pdf-block { margin: 0 0 10px; }
    .quality-pdf-block--keep { break-inside: avoid-page; page-break-inside: avoid; }
    .quality-pdf-block--flow { break-inside: auto; page-break-inside: auto; }
    .quality-pdf-block--separator { break-inside: avoid; page-break-inside: avoid; }
    .quality-pdf-block--split-table { break-inside: auto; page-break-inside: auto; }
    .quality-pdf-force-break { break-before: page; page-break-before: always; }
    .quality-pdf-block--oversize,
    .quality-pdf-block--oversize .quality-diagram-block,
    .quality-pdf-block--oversize .quality-image-block { break-inside: auto !important; page-break-inside: auto !important; }
    .quality-pdf-block--split-table .quality-table-block { break-inside: auto; page-break-inside: auto; }
    .rich-content table { break-inside: auto; page-break-inside: auto; }
    .missing, .missing-info { color: #b42318; font-weight: 700; }
    .quality-diagram-block { break-inside: avoid-page; page-break-inside: avoid; margin: 14px 0; max-width: 100%; overflow: visible; width: 100%; }
    .quality-diagram-block figcaption { color: #263746; font-weight: 700; margin: 0 0 6px; }
    .quality-diagram-svg { box-sizing: border-box; display: block; max-height: 235mm; max-width: 100%; height: auto; width: 100%; break-inside: avoid-page; page-break-inside: avoid; overflow: visible; }
    .quality-table-block { break-inside: avoid-page; page-break-inside: avoid; margin: 14px 0; }
    .quality-table-block figcaption { color: #263746; font-weight: 700; margin: 0 0 6px; }
    .procedure-section { break-inside: avoid-page; page-break-inside: avoid; margin: 12px 0; }
    .procedure-section h3 { color: #0f5f73; font-size: 14px; margin: 0 0 6px; }
    .quality-to-complete-block { border: 1px solid #fca5a5; border-left: 4px solid #b42318; background: #fef2f2; color: #7f1d1d; font-weight: 600; margin: 12px 0; padding: 8px 10px; break-inside: avoid-page; page-break-inside: avoid; }
    .quality-document-separator { border: 0; border-top: 1px solid #94a3b8; margin: 16px 0; }
    .quality-image-block { break-inside: avoid-page; page-break-inside: avoid; margin: 14px 0; max-width: 100%; width: 100%; }
    .quality-image-block img { display: block; height: auto; max-height: 225mm; max-width: 100%; object-fit: contain; width: auto; }
    .quality-image-block figcaption { color: #52616f; font-size: 10px; margin-top: 4px; }
    .quality-attachment-block { border: 1px solid #cbd5e1; margin: 10px 0; padding: 8px 10px; }
    .quality-attachment-block span { color: #52616f; display: block; font-size: 10px; margin-top: 2px; }
    .quality-table-scroll { overflow: visible; width: 100%; }
    .quality-data-table { border-collapse: collapse; table-layout: fixed; width: 100%; }
    .quality-data-table thead { display: table-header-group; break-inside: avoid; page-break-inside: avoid; }
    .quality-data-table tbody { break-inside: auto; page-break-inside: auto; }
    .quality-data-table tr { break-inside: avoid; page-break-inside: avoid; }
    .quality-data-table th,
    .quality-data-table td { border: 1px solid #94a3b8; font-size: 10.5px; line-height: 1.35; padding: 5px 6px; vertical-align: top; word-break: break-word; }
    .quality-pdf--ddpp .quality-data-table th,
    .quality-pdf--ddpp .quality-data-table td { font-size: 9.5px; overflow-wrap: anywhere; }
    .quality-pdf--ddpp table { max-width: 100%; }
    .quality-pdf--ddpp .missing,
    .quality-pdf--ddpp .missing-info { color: inherit; font-weight: inherit; }
    .quality-data-table th { background: #eef2f7; color: #263746; font-weight: 700; }
    .quality-data-table .align-center { text-align: center; }
    .quality-data-table .align-right { text-align: right; }
    blockquote { border-left: 3px solid #0f5f73; margin-left: 0; padding-left: 10px; }
    img { max-width: 100%; }
    tr { break-inside: avoid; }
  `;
  return htmlDocument(collection.title, content, styles);
}

async function renderDocumentationPdf(db, storeId, collectionId, options = {}) {
  if (isDdppProfile(options)) {
    options = {
      ...options,
      export_type: 'ddpp',
      profile: 'ddpp',
      include_missing: options.include_missing !== false,
      include_attachments: options.include_attachments !== false,
      include_master_annexes: options.include_master_annexes !== false,
      include_external_master_documents: options.include_external_master_documents !== false,
      include_enr_examples: options.include_enr_examples !== false,
    };
  }
  const documentation = await getDocumentation(db, storeId, collectionId);
  if (!documentation) return null;
  const sections = filteredSections(documentation.sections, options);
  if (options.include_master_annexes) {
    documentation.master_annexes = await collectMasterAnnexes(db, storeId, sections);
  }
  if (options.include_external_master_documents) {
    const directExternalAttachments = await collectExternalMasterAttachments(db, storeId, sections);
    const supplyExternalAttachments = await collectSupplyMaterialExternalAttachments(db, storeId, sections);
    documentation.external_master_attachments = [...directExternalAttachments, ...supplyExternalAttachments];
    documentation.supply_material_export_anomalies = await diagnoseSupplyMaterialExportCoverage(db, storeId, sections);
  }
  const identity = await getCompanyIdentity(db, storeId);
  const html = buildHtml(documentation, identity, options);
  let pdf = await renderHtmlToPdf(html, {
    margin: { top: '18mm', right: '12mm', bottom: '18mm', left: '12mm' },
    beforePdfScript: paginationPreparationScript(),
  });
  const appendixItems = [
    ...collectAttachmentAppendixItems(documentation, options),
    ...(options.include_external_master_documents ? collectExternalAppendixItems(documentation.external_master_attachments || [], options) : []),
  ];
  const exportSummary = {
    chapters: sections.filter((section) => section.section_type !== 'tome').length,
    procedures: (documentation.master_annexes || []).filter(({ document }) => document.document_type === 'procedure').length,
    forms: (documentation.master_annexes || []).filter(({ document }) => document.document_type === 'record_form').length,
    requested_attachments: appendixItems.length,
    embedded_attachments: 0,
    non_embeddable: 0,
    duplicates: 0,
    anomalies: [],
  };
  exportSummary.anomalies.push(...(documentation.supply_material_export_anomalies || []));
  if (appendixItems.length) {
    const merged = await mergeAppendices(pdf, appendixItems);
    pdf = merged.pdf;
    Object.assign(exportSummary, {
      embedded_attachments: merged.summary.embedded_attachments,
      embedded_pages: merged.summary.embedded_pages,
      non_embeddable: merged.summary.non_embeddable,
      duplicates: merged.summary.duplicates,
      anomalies: [...exportSummary.anomalies, ...merged.summary.anomalies],
    });
  }
  return { pdf, html, documentation, identity, export_summary: exportSummary };
}

async function exportDocumentationPdf(db, storeId, collectionId, userId, options = {}) {
  const rendered = await renderDocumentationPdf(db, storeId, collectionId, options);
  if (!rendered) return null;
  const date = todayIso();
  const ddpp = isDdppProfile(options);
  const filename = `${fileSafe(`${ddpp ? 'Dossier_DDPP' : 'Manuel_Qualite'}_${rendered.identity.company_name}_V${rendered.documentation.collection.version}_${date}`, ddpp ? 'Dossier_DDPP' : 'Manuel_Qualite')}.pdf`;
  const filePath = path.join(EXPORT_DIR, `${collectionId}-${Date.now()}-${filename}`);
  fs.writeFileSync(filePath, rendered.pdf);
  const inserted = await db.query(
    `INSERT INTO quality_documentation_exports
     (collection_id, store_id, export_type, version, options_json, filename, file_path, generated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, generated_at`,
    [collectionId, storeId, options.export_type || 'full', rendered.documentation.collection.version, JSON.stringify({ ...options, export_summary: rendered.export_summary }), filename, filePath, userId]
  );
  return { ...rendered, id: inserted.rows[0]?.id || null, generated_at: inserted.rows[0]?.generated_at || null, filename, filePath };
}

module.exports = {
  buildHtml,
  collectMasterAnnexes,
  collectExternalMasterAttachments,
  collectSupplyMaterialExternalAttachments,
  diagnoseSupplyMaterialExportCoverage,
  inlineImageDataUri,
  collectAttachmentAppendixItems,
  collectExternalAppendixItems,
  dedupeAppendixItems,
  exportDocumentationPdf,
  mergeAppendices,
  paginationPreparationScript,
  renderDocumentationPdf,
};
