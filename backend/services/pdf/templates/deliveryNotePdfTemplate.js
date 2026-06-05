const {
  companyHeader,
  escapeHtml,
  fileSafe,
  formatDate,
  htmlDocument,
  money,
  number,
  qty,
} = require('../pdfLayout');
const { displaySalesDocumentReference } = require('../../salesReferenceService');

function addressBlock(parts) {
  return parts.filter(Boolean).map((part) => `<p>${escapeHtml(part)}</p>`).join('');
}

function lotTraceDetails(lot) {
  return [
    lot.lot_code || lot.supplier_lot_number ? `Lot ${lot.lot_code || lot.supplier_lot_number}` : null,
    lot.dlc ? `DLC ${formatDate(lot.dlc)}` : null,
    lot.latin_name,
    lot.fao_zone ? `FAO ${lot.fao_zone}` : null,
    lot.sous_zone,
    lot.fishing_gear,
    lot.production_method,
  ].filter(Boolean).map(escapeHtml).join(' - ');
}

function lineTrace(line) {
  const allocationDetails = (line.allocations || [])
    .map(lotTraceDetails)
    .filter(Boolean);
  if (allocationDetails.length) return allocationDetails.join('<br>');

  const trace = line.traceability_snapshot || {};
  return [
    trace.lot_code || trace.supplier_lot_number ? `Lot ${trace.lot_code || trace.supplier_lot_number}` : null,
    trace.dlc ? `DLC ${formatDate(trace.dlc)}` : null,
    trace.latin_name,
    trace.fao_zone ? `FAO ${trace.fao_zone}` : null,
    trace.sous_zone,
    trace.fishing_gear || trace.engin,
    trace.production_method || trace.category,
  ].filter(Boolean).map(escapeHtml).join(' - ');
}

function renderDeliveryNotePdf({ document, lines, storeSettings }) {
  const doc = document || {};
  const settings = storeSettings || {};
  const deliveredStoreId = doc.client_store_identifier || doc.delivered_client_store_identifier || '';
  const sourceOrder = doc.source_order_reference || displaySalesDocumentReference({ id: doc.source_order_id, document_date: doc.document_date }, 'CMD');
  const documentReference = displaySalesDocumentReference(doc, 'BL') || 'Bon de livraison';
  const rows = (lines || []).map((line) => `<tr>
    <td class="line-cell">${escapeHtml(line.line_number || '')}</td>
    <td>${escapeHtml(line.article_plu || '')}</td>
    <td class="designation-cell"><strong>${escapeHtml(line.article_label || '-')}</strong><small>${lineTrace(line) || '-'}</small></td>
    <td class="num">${number(line.package_count)}</td>
    <td class="num weight-cell">${qty(line.weight_per_package)} ${escapeHtml(line.sale_unit || 'kg')}</td>
    <td class="num weight-cell">${qty(line.total_weight || line.sold_quantity)} ${escapeHtml(line.sale_unit || 'kg')}</td>
    <td class="num">${money(line.unit_sale_price_ht)}</td>
    <td class="num">${money(line.line_amount_ht)}</td>
    <td class="num vat-cell">${number(line.vat_rate).toFixed(2)} %</td>
    <td class="num">${money(line.line_amount_ttc)}</td>
  </tr>`).join('');

  const body = `<article class="pdf-document bl-document">
    ${companyHeader(settings, documentReference, `Bon de livraison - ${formatDate(doc.document_date)}`)}
    ${sourceOrder ? `<p class="source-order">Commande source : <strong>${escapeHtml(sourceOrder)}</strong></p>` : ''}
    <section class="parties">
      <div class="party-card">
        <h3>Client livre</h3>
        <p class="party-name">${escapeHtml(doc.client_name || doc.delivered_client_name_snapshot || '-')}</p>
        ${deliveredStoreId ? `<p>Identifiant magasin : <strong>${escapeHtml(deliveredStoreId)}</strong></p>` : ''}
        ${addressBlock([doc.address_line1, doc.address_line2, [doc.postal_code, doc.city].filter(Boolean).join(' ')])}
      </div>
      <div class="party-card">
        <h3>Client facture</h3>
        <p class="party-name">${escapeHtml(doc.billed_client_name || doc.billed_client_name_snapshot || '-')}</p>
        ${doc.billed_client_code ? `<p>Code client : <strong>${escapeHtml(doc.billed_client_code)}</strong></p>` : ''}
      </div>
    </section>
    <table class="delivery-lines-table">
      <colgroup>
        <col class="col-line">
        <col class="col-plu">
        <col class="col-designation">
        <col class="col-packages">
        <col class="col-weight-pack">
        <col class="col-weight-total">
        <col class="col-price">
        <col class="col-total">
        <col class="col-vat">
        <col class="col-ttc">
      </colgroup>
      <thead><tr><th>Ligne</th><th>PLU</th><th>Designation</th><th>Colis</th><th>Poids/colis</th><th>Poids total</th><th>Prix HT</th><th>Total HT</th><th>TVA</th><th>TTC</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="10">Aucune ligne.</td></tr>'}</tbody>
    </table>
    <section class="bottom">
      <div class="footer-note">
        ${doc.notes ? `<h3>Notes</h3><p>${escapeHtml(doc.notes)}</p>` : ''}
        ${settings.delivery_note_footer ? `<h3>Pied de bon de livraison</h3><p>${escapeHtml(settings.delivery_note_footer)}</p>` : ''}
      </div>
      <div class="totals">
        <p><span>Total HT</span><strong>${money(doc.total_amount_ex_vat)}</strong></p>
        <p><span>TVA</span><strong>${money(doc.total_vat_amount)}</strong></p>
        <p class="grand-total"><span>Total TTC</span><strong>${money(doc.total_amount_inc_vat)}</strong></p>
      </div>
    </section>
    <section class="signature"><div>Date de reception</div><div>Nom et signature</div><div>Cachet client</div></section>
  </article>`;

  const styles = `
    .bl-document { display: flex; flex-direction: column; min-height: 277mm; }
    .source-order { color: #52616f; font-size: 9.5px; margin: -2px 0 7px; text-align: right; }
    .source-order strong { color: #17212b; }
    .bl-document .parties { gap: 10px; margin: 8px 0 10px; }
    .bl-document .party-card { min-height: 20mm; padding: 7px 9px; }
    .bl-document .party-card h3 { margin-bottom: 4px; }
    .bl-document .party-name { font-size: 12px; }
    .delivery-lines-table { font-size: 9px; table-layout: fixed; }
    .delivery-lines-table th, .delivery-lines-table td { padding: 4px 4px; }
    .delivery-lines-table th { background: #e8eef4; border-color: #aebdcc; color: #17212b; font-size: 7.9px; letter-spacing: 0; }
    .delivery-lines-table tbody tr:nth-child(even) { background: #f8fafc; }
    .delivery-lines-table td { border-color: #d5dde5; line-height: 1.2; }
    .delivery-lines-table td small { font-size: 7.6px; line-height: 1.15; margin-top: 1px; overflow-wrap: anywhere; }
    .line-cell { text-align: center; }
    .designation-cell strong { display: block; overflow-wrap: anywhere; }
    .weight-cell, .vat-cell { font-size: 8.5px; }
    .col-line { width: 6%; }
    .col-plu { width: 9%; }
    .col-designation { width: 29%; }
    .col-packages { width: 7%; }
    .col-weight-pack { width: 10%; }
    .col-weight-total { width: 10%; }
    .col-price { width: 8%; }
    .col-total { width: 8%; }
    .col-vat { width: 6%; }
    .col-ttc { width: 7%; }
    .bottom { align-items: flex-start; display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr) 54mm; margin-top: 10px; }
    .bottom .footer-note { margin-top: 0; }
    .totals { justify-self: end; width: 54mm; }
    .totals p { display: grid; gap: 8px; grid-template-columns: minmax(0, 1fr) auto; padding: 5px 7px; }
    .totals span { text-align: left; }
    .totals strong { text-align: right; white-space: nowrap; }
    .signature { display: grid; gap: 10px; grid-template-columns: repeat(3, 1fr); margin-top: auto; padding-top: 14px; }
    .signature div { border: 1px solid #8b98a5; color: #52616f; font-weight: 700; height: 24mm; padding: 7px; }
  `;

  return htmlDocument('Bon de livraison', body, styles);
}

function deliveryNoteFilename(document = {}) {
  return `${fileSafe(displaySalesDocumentReference(document, 'BL') || 'bon-de-livraison')}.pdf`;
}

module.exports = {
  deliveryNoteFilename,
  renderDeliveryNotePdf,
};
