const fs = require('fs');
const path = require('path');

const { renderHtmlToPdf } = require('../pdf/pdfRenderer');
const { escapeHtml, fileSafe, formatDate, htmlDocument } = require('../pdf/pdfLayout');
const { getCompanyIdentity } = require('./companyIdentityService');
const { getDocumentation } = require('./qualityDocumentationService');
const { renderDocumentBlock } = require('./qualityDocumentBlockService');

const EXPORT_DIR = path.resolve(__dirname, '..', '..', 'uploads', 'quality-documentation-exports');

fs.mkdirSync(EXPORT_DIR, { recursive: true });

function todayIso() {
  return new Date().toISOString().slice(0, 10);
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
        element.style.breakBefore = '';
        element.style.pageBreakBefore = '';
      });
      Array.from(document.querySelectorAll(selectors)).forEach((element) => {
        const rect = element.getBoundingClientRect();
        if (!rect.height || rect.height >= pageContentHeight) return;
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
  if (!blocks.length) return renderSectionContent(section, options.include_missing !== false);
  return blocks.map((block) => renderPdfBlock(block, options)).join('\n');
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

function buildHtml(documentation, identity, options = {}) {
  const { collection, missing_items: missingItems, attachments } = documentation;
  const sections = filteredSections(documentation.sections, options);
  const chapters = sections.filter((section) => section.section_type !== 'tome');
  const revisionRows = chapters.slice(0, 20).map((section) => `
    <tr>
      <td>${escapeHtml(section.version)}</td>
      <td>${escapeHtml(formatDate(section.updated_at))}</td>
      <td>${escapeHtml(section.updated_by || '-')}</td>
      <td>${escapeHtml(section.validated_by || '-')}</td>
      <td>${escapeHtml(section.title)}</td>
    </tr>
  `).join('');
  const tocRows = sections.map((section) => `
    <tr>
      <td>${escapeHtml(section.code)}</td>
      <td>${section.section_type === 'tome' ? '<strong>' : ''}${escapeHtml(section.title)}${section.section_type === 'tome' ? '</strong>' : ''}</td>
      <td>${escapeHtml(section.status)}</td>
    </tr>
  `).join('');
  const body = sections.map((section) => `
    <section class="${section.section_type === 'tome' ? 'pdf-tome' : 'pdf-section'}">
      <h${section.section_type === 'tome' ? '1' : '2'}>${escapeHtml(section.code)} - ${escapeHtml(section.title)}</h${section.section_type === 'tome' ? '1' : '2'}>
      <div class="section-meta">Version ${escapeHtml(section.version)} - Statut ${escapeHtml(section.status)} - Code ${escapeHtml(section.code)}</div>
      <div class="rich-content">${section.section_type === 'tome' ? renderSectionContent(section, options.include_missing !== false) : renderSectionBlocks(section, documentation, options)}</div>
    </section>
  `).join('');
  const missingRows = missingItems
    .filter((item) => item.status !== 'resolved')
    .map((item) => `<tr><td>${escapeHtml(item.section_code)}</td><td>${escapeHtml(item.section_title)}</td><td class="missing">${escapeHtml(item.description)}</td><td>${escapeHtml(item.severity)}</td><td>${escapeHtml(formatDate(item.due_at))}</td></tr>`)
    .join('');
  const attachmentRows = attachments
    .filter((item) => !item.archived_at && item.include_in_export !== false)
    .map((item) => `<tr><td>${escapeHtml(item.section_title)}</td><td>${escapeHtml(item.filename)}</td><td>${escapeHtml(item.mime_type || '-')}</td></tr>`)
    .join('');

  const coverAddress = [identity.address_line1, identity.address_line2, [identity.postal_code, identity.city].filter(Boolean).join(' '), identity.country].filter(Boolean).join('<br>');
  const logo = identity.logo_url ? `<img class="cover-logo" src="${escapeHtml(identity.logo_url)}" alt="Logo">` : '';
  const content = `
    <main class="quality-pdf">
      <section class="cover">
        ${logo}
        <h1>${escapeHtml(identity.company_name)}</h1>
        <h2>${escapeHtml(collection.title)}</h2>
        <p>${coverAddress}</p>
        <p>${identity.sanitary_approval_number ? `Agrement sanitaire : ${escapeHtml(identity.sanitary_approval_number)}` : ''}</p>
        <p>Version ${escapeHtml(collection.version)} - Edition du ${escapeHtml(formatDate(new Date()))}</p>
        <strong>Document maitrise</strong>
      </section>
      <section class="pdf-page">
        <h1>Historique des revisions</h1>
        <table><thead><tr><th>Version</th><th>Date</th><th>Auteur</th><th>Validateur</th><th>Motif</th></tr></thead><tbody>${revisionRows || '<tr><td colspan="5">Aucune revision.</td></tr>'}</tbody></table>
      </section>
      <section class="pdf-page">
        <h1>Sommaire</h1>
        <table><thead><tr><th>Code</th><th>Titre</th><th>Statut</th></tr></thead><tbody>${tocRows}</tbody></table>
      </section>
      ${options.include_missing === false ? '' : `<section class="pdf-page"><h1>Informations a completer</h1><table><thead><tr><th>Code</th><th>Chapitre</th><th>Point</th><th>Priorite</th><th>Echeance</th></tr></thead><tbody>${missingRows || '<tr><td colspan="5">Aucune information manquante ouverte.</td></tr>'}</tbody></table></section>`}
      ${body}
      ${options.include_attachments === false ? '' : `<section class="pdf-page"><h1>Annexes</h1><table><thead><tr><th>Chapitre</th><th>Fichier</th><th>Type</th></tr></thead><tbody>${attachmentRows || '<tr><td colspan="3">Aucune annexe incluse.</td></tr>'}</tbody></table></section>`}
    </main>
  `;

  const styles = `
    @page {
      size: A4;
      margin: 18mm 12mm 18mm 12mm;
      @top-left { content: "${escapeHtml(identity.company_name)}"; }
      @top-center { content: "Manuel qualite"; }
      @top-right { content: "Version ${escapeHtml(collection.version)}"; }
      @bottom-left { content: "Document maitrise"; }
      @bottom-center { content: "${todayIso()}"; }
      @bottom-right { content: "Page " counter(page) " / " counter(pages); }
    }
    body { font-size: 12px; }
    .cover { align-items: center; display: flex; flex-direction: column; justify-content: center; min-height: 250mm; text-align: center; page-break-after: always; }
    .cover-logo { max-height: 34mm; max-width: 58mm; object-fit: contain; margin-bottom: 18mm; }
    .cover h1 { font-size: 30px; margin: 0 0 8mm; }
    .cover h2 { font-size: 20px; margin: 0 0 8mm; }
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
    .quality-pdf-block--split-table .quality-table-block { break-inside: auto; page-break-inside: auto; }
    .rich-content table { break-inside: auto; page-break-inside: auto; }
    .missing, .missing-info { color: #b42318; font-weight: 700; }
    .quality-diagram-block { break-inside: avoid-page; page-break-inside: avoid; margin: 14px 0; }
    .quality-diagram-block figcaption { color: #263746; font-weight: 700; margin: 0 0 6px; }
    .quality-diagram-svg { max-height: 230mm; max-width: 100%; height: auto; break-inside: avoid-page; page-break-inside: avoid; }
    .quality-table-block { break-inside: avoid-page; page-break-inside: avoid; margin: 14px 0; }
    .quality-table-block figcaption { color: #263746; font-weight: 700; margin: 0 0 6px; }
    .quality-to-complete-block { border: 1px solid #fca5a5; border-left: 4px solid #b42318; background: #fef2f2; color: #7f1d1d; font-weight: 600; margin: 12px 0; padding: 8px 10px; break-inside: avoid-page; page-break-inside: avoid; }
    .quality-document-separator { border: 0; border-top: 1px solid #94a3b8; margin: 16px 0; }
    .quality-image-block { break-inside: avoid-page; page-break-inside: avoid; margin: 14px 0; }
    .quality-image-block img { display: block; max-height: 225mm; object-fit: contain; width: auto; }
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
  const documentation = await getDocumentation(db, storeId, collectionId);
  if (!documentation) return null;
  const identity = await getCompanyIdentity(db, storeId);
  const html = buildHtml(documentation, identity, options);
  const pdf = await renderHtmlToPdf(html, {
    margin: { top: '18mm', right: '12mm', bottom: '18mm', left: '12mm' },
    beforePdfScript: paginationPreparationScript(),
  });
  return { pdf, html, documentation, identity };
}

async function exportDocumentationPdf(db, storeId, collectionId, userId, options = {}) {
  const rendered = await renderDocumentationPdf(db, storeId, collectionId, options);
  if (!rendered) return null;
  const date = todayIso();
  const filename = `${fileSafe(`Manuel_Qualite_${rendered.identity.company_name}_V${rendered.documentation.collection.version}_${date}`, 'Manuel_Qualite')}.pdf`;
  const filePath = path.join(EXPORT_DIR, `${collectionId}-${Date.now()}-${filename}`);
  fs.writeFileSync(filePath, rendered.pdf);
  await db.query(
    `INSERT INTO quality_documentation_exports
     (collection_id, store_id, export_type, version, options_json, filename, file_path, generated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [collectionId, storeId, options.export_type || 'full', rendered.documentation.collection.version, JSON.stringify(options), filename, filePath, userId]
  );
  return { ...rendered, filename, filePath };
}

module.exports = {
  buildHtml,
  exportDocumentationPdf,
  paginationPreparationScript,
  renderDocumentationPdf,
};
