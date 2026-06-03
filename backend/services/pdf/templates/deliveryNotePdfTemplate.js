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

function addressBlock(parts) {
  return parts.filter(Boolean).map((part) => `<p>${escapeHtml(part)}</p>`).join('');
}

function lineLots(line) {
  return (line.allocations || [])
    .map((lot) => [
      lot.lot_code,
      lot.supplier_lot_number,
      lot.dlc ? `DLC ${formatDate(lot.dlc)}` : null,
      lot.quantity ? `${qty(lot.quantity)} ${escapeHtml(line.sale_unit || 'kg')}` : null,
    ].filter(Boolean).join(' - '))
    .filter(Boolean)
    .join('<br>');
}

function renderDeliveryNotePdf({ document, lines, storeSettings }) {
  const doc = document || {};
  const settings = storeSettings || {};
  const deliveredStoreId = doc.client_store_identifier || doc.delivered_client_store_identifier || '';
  const sourceOrder = doc.source_order_reference || doc.source_order_id || '';
  const rows = (lines || []).map((line) => `<tr>
    <td>${escapeHtml(line.line_number || '')}</td>
    <td><strong>${escapeHtml(line.article_label || '-')}</strong><small>${escapeHtml(line.article_plu || '')}</small></td>
    <td class="num">${number(line.package_count)}</td>
    <td class="num">${qty(line.total_weight || line.sold_quantity)} ${escapeHtml(line.sale_unit || 'kg')}</td>
    <td>${lineLots(line) || '-'}</td>
    <td class="num">${money(line.unit_sale_price_ht)}</td>
    <td class="num">${money(line.line_amount_ht)}</td>
    <td class="num">${number(line.vat_rate).toFixed(2)} %</td>
    <td class="num">${money(line.line_amount_ttc)}</td>
  </tr>`).join('');

  const body = `<article class="pdf-document bl-document">
    ${companyHeader(settings, doc.reference_number || doc.id || 'Bon de livraison', `Bon de livraison - ${formatDate(doc.document_date)}`)}
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
    <table>
      <thead><tr><th>Ligne</th><th>Designation</th><th>Colis</th><th>Poids</th><th>Lots</th><th>Prix HT</th><th>Total HT</th><th>TVA</th><th>TTC</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="9">Aucune ligne.</td></tr>'}</tbody>
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
    .source-order { margin: -4px 0 8px; }
    .bottom { align-items: flex-start; display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr) 58mm; margin-top: 14px; }
    .signature { display: grid; gap: 12px; grid-template-columns: repeat(3, 1fr); margin-top: auto; padding-top: 18px; }
    .signature div { border: 1px solid #8b98a5; color: #52616f; font-weight: 700; height: 28mm; padding: 8px; }
  `;

  return htmlDocument('Bon de livraison', body, styles);
}

function deliveryNoteFilename(document = {}) {
  return `${fileSafe(document.reference_number || document.id || 'bon-de-livraison')}.pdf`;
}

module.exports = {
  deliveryNoteFilename,
  renderDeliveryNotePdf,
};
