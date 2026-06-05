const {
  companyHeader,
  escapeHtml,
  fileSafe,
  formatDate,
  htmlDocument,
  number,
  qty,
} = require('../pdfLayout');
const { displaySalesDocumentReference } = require('../../salesReferenceService');

function addressBlock(parts) {
  return parts.filter(Boolean).map((part) => `<p>${escapeHtml(part)}</p>`).join('');
}

function renderSaleOrderPdf({ sale, lines, storeSettings }) {
  const doc = sale || {};
  const settings = storeSettings || {};
  const documentReference = displaySalesDocumentReference(doc, 'CMD') || 'Commande';
  const deliveredStoreId = doc.client_store_identifier || doc.delivered_client_store_identifier || '';
  const rows = (lines || []).map((line) => `<tr>
    <td class="check-cell"><span class="prep-check"></span></td>
    <td>${escapeHtml(line.article_plu || '')}</td>
    <td><strong>${escapeHtml(line.article_label || '-')}</strong></td>
    <td class="num">${number(line.package_count)}</td>
    <td class="num">${qty(line.weight_per_package)} ${escapeHtml(line.sale_unit || 'kg')}</td>
    <td class="num">${qty(line.total_weight || line.sold_quantity)} ${escapeHtml(line.sale_unit || 'kg')}</td>
    <td class="comment-cell"></td>
  </tr>`).join('');

  const body = `<article class="pdf-document order-document">
    ${companyHeader(settings, documentReference, `Commande preparation - ${formatDate(doc.document_date)}`)}
    <section class="parties">
      <div class="party-card">
        <h3>Client livre</h3>
        <p class="party-name">${escapeHtml(doc.client_name || doc.delivered_client_name_snapshot || '-')}</p>
        ${doc.client_code ? `<p>Code client : <strong>${escapeHtml(doc.client_code)}</strong></p>` : ''}
        ${deliveredStoreId ? `<p>Identifiant magasin : <strong>${escapeHtml(deliveredStoreId)}</strong></p>` : ''}
        ${addressBlock([doc.address_line1, doc.address_line2, [doc.postal_code, doc.city].filter(Boolean).join(' ')])}
      </div>
      <div class="party-card">
        <h3>Preparation</h3>
        <p>Date : <strong>${formatDate(doc.document_date)}</strong></p>
        <p>Commande : <strong>${escapeHtml(documentReference)}</strong></p>
        <p>Origine : <strong>${escapeHtml(doc.origin === 'negoce' ? 'Negoce' : 'Classique')}</strong></p>
      </div>
    </section>
    <table class="prep-lines-table">
      <colgroup>
        <col class="col-check">
        <col class="col-plu">
        <col class="col-designation">
        <col class="col-packages">
        <col class="col-weight-pack">
        <col class="col-weight-total">
        <col class="col-comment">
      </colgroup>
      <thead><tr><th>Prep.</th><th>PLU</th><th>Designation</th><th>Colis</th><th>Poids/colis</th><th>Poids total</th><th>Commentaire</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7">Aucune ligne.</td></tr>'}</tbody>
    </table>
    <section class="prep-footer">
      <div>
        ${doc.notes ? `<h3>Notes preparation</h3><p>${escapeHtml(doc.notes)}</p>` : ''}
      </div>
      <div class="prep-signature">Prepare par</div>
      <div class="prep-signature">Controle par</div>
    </section>
  </article>`;

  const styles = `
    .order-document { min-height: 277mm; }
    .prep-lines-table { font-size: 10px; table-layout: fixed; }
    .prep-lines-table th, .prep-lines-table td { padding: 6px 5px; }
    .prep-lines-table th { background: #e8eef4; border-color: #aebdcc; color: #17212b; font-size: 8.5px; letter-spacing: 0; }
    .prep-lines-table tbody tr { min-height: 12mm; }
    .prep-lines-table tbody tr:nth-child(even) { background: #f8fafc; }
    .check-cell { text-align: center; }
    .prep-check { border: 1px solid #17212b; display: inline-block; height: 4.5mm; width: 4.5mm; }
    .comment-cell { height: 10mm; }
    .col-check { width: 8%; }
    .col-plu { width: 12%; }
    .col-designation { width: 32%; }
    .col-packages { width: 9%; }
    .col-weight-pack { width: 13%; }
    .col-weight-total { width: 13%; }
    .col-comment { width: 13%; }
    .prep-footer { display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr) 38mm 38mm; margin-top: 14px; }
    .prep-footer h3 { color: #52616f; font-size: 10px; margin: 0 0 6px; text-transform: uppercase; }
    .prep-footer p { margin: 0; }
    .prep-signature { border: 1px solid #8b98a5; color: #52616f; font-weight: 700; height: 20mm; padding: 7px; }
  `;

  return htmlDocument('Commande preparation', body, styles);
}

function saleOrderFilename(sale = {}) {
  return `${fileSafe(displaySalesDocumentReference(sale, 'CMD') || 'commande-preparation')}.pdf`;
}

module.exports = {
  renderSaleOrderPdf,
  saleOrderFilename,
};
