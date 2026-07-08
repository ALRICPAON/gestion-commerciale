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

function infoBlock(title, entries) {
  const content = entries.filter(Boolean).join('');
  return content ? `<h3>${escapeHtml(title)}</h3>${content}` : '';
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
  const allocationDetails = (line.allocations || []).map(lotTraceDetails).filter(Boolean);
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

function lineDeliveredKey(line) {
  return line.delivered_client_id
    || line.delivered_client_name_snapshot
    || line.delivered_client_code_snapshot
    || line.delivered_client_store_identifier_snapshot
    || '';
}

function lineDeliveredLabel(line, fallback) {
  const name = line.delivered_client_name_snapshot
    || (line.delivered_client_id ? line.delivered_client_name : null)
    || line.delivered_client_code_snapshot
    || (line.delivered_client_id ? line.delivered_client_code : null)
    || fallback
    || 'Client livre';
  const storeIdentifier = line.delivered_client_store_identifier_snapshot
    || (line.delivered_client_id ? line.delivered_client_store_identifier : null);
  return storeIdentifier ? `${name} - N° magasin ${storeIdentifier}` : name;
}

function renderInvoiceLineRow(line) {
  const details = [escapeHtml(line.article_plu || ''), lineTrace(line)].filter(Boolean).join('<br>');
  return `<tr>
    <td class="line-cell">${escapeHtml(line.line_number || '')}</td>
    <td class="designation-cell"><strong>${escapeHtml(line.article_label || '-')}</strong><small>${details || '-'}</small></td>
    <td class="num">${number(line.package_count)}</td>
    <td class="num">${qty(line.weight_per_package)} ${escapeHtml(line.sale_unit || 'kg')}</td>
    <td class="num">${qty(line.total_weight || line.sold_quantity)} ${escapeHtml(line.sale_unit || 'kg')}</td>
    <td class="num">${money(line.unit_sale_price_ht)}</td>
    <td class="num">${money(line.line_amount_ht)}</td>
    <td class="num vat-cell">${number(line.vat_rate).toFixed(2)} %</td>
    <td class="num">${money(line.line_vat_amount)}</td>
    <td class="num">${money(line.line_amount_ttc)}</td>
  </tr>`;
}

function renderGroupedRows(lines, fallbackLabel) {
  if (!lines.length) return '<tr><td colspan="10">Aucune ligne.</td></tr>';
  const hasDeliveredGroups = lines.some((line) => lineDeliveredKey(line));
  if (!hasDeliveredGroups) return lines.map(renderInvoiceLineRow).join('');

  const groups = new Map();
  lines.forEach((line) => {
    const key = lineDeliveredKey(line) || '__main__';
    if (!groups.has(key)) groups.set(key, { label: lineDeliveredLabel(line, fallbackLabel), lines: [] });
    groups.get(key).lines.push(line);
  });

  return Array.from(groups.values()).map((group) => {
    const subtotal = group.lines.reduce((sum, line) => sum + number(line.line_amount_ht), 0);
    return `<tr class="invoice-group-row"><td colspan="10">${escapeHtml(group.label)}</td></tr>
      ${group.lines.map(renderInvoiceLineRow).join('')}
      <tr class="invoice-subtotal-row"><td colspan="6">Sous-total ${escapeHtml(group.label)}</td><td class="num">${money(subtotal)}</td><td></td><td></td><td></td></tr>`;
  }).join('');
}

function renderCustomerInvoicePdf({ invoice, lines, storeSettings }) {
  const doc = invoice || {};
  const settings = storeSettings || {};
  const deliveredStoreId = doc.client_store_identifier || doc.delivered_client_store_identifier || '';
  const sourceDeliveryNote = doc.source_delivery_note_reference || doc.source_delivery_note_id || '';
  const sourceOrder = doc.source_order_reference || doc.source_order_id || '';
  const paymentInfo = infoBlock('Paiement', [
    settings.payment_terms ? `<p><strong>Conditions de paiement :</strong> ${escapeHtml(settings.payment_terms)}</p>` : '',
    settings.iban ? `<p><strong>IBAN :</strong> ${escapeHtml(settings.iban)}</p>` : '',
    settings.bic ? `<p><strong>BIC :</strong> ${escapeHtml(settings.bic)}</p>` : '',
  ]);
  const legalInfo = [
    settings.invoice_footer ? `<h3>Pied de facture</h3><p>${escapeHtml(settings.invoice_footer)}</p>` : '',
    settings.legal_mentions ? `<h3>Mentions legales</h3><p>${escapeHtml(settings.legal_mentions)}</p>` : '',
    settings.terms_and_conditions ? `<h3>CGV</h3><p>${escapeHtml(settings.terms_and_conditions)}</p>` : '',
  ].filter(Boolean).join('');

  const rows = renderGroupedRows(lines || [], doc.delivered_client_name || doc.delivered_client_name_snapshot);

  const body = `<article class="pdf-document invoice-document">
    ${companyHeader(settings, doc.reference_number || doc.id || 'Facture client', `Facture client - ${formatDate(doc.document_date)}`)}
    <section class="invoice-links">
      ${sourceDeliveryNote ? `<p>BL source : <strong>${escapeHtml(sourceDeliveryNote)}</strong></p>` : ''}
      ${sourceOrder ? `<p>Commande source : <strong>${escapeHtml(sourceOrder)}</strong></p>` : ''}
    </section>
    <section class="parties">
      <div class="party-card">
        <h3>Client facture</h3>
        <p class="party-name">${escapeHtml(doc.billed_client_name || doc.billed_client_name_snapshot || doc.client_name || '-')}</p>
        ${doc.billed_client_code ? `<p>Code client : <strong>${escapeHtml(doc.billed_client_code)}</strong></p>` : ''}
      </div>
      <div class="party-card">
        <h3>Client livre</h3>
        <p class="party-name">${escapeHtml(doc.delivered_client_name || doc.delivered_client_name_snapshot || '-')}</p>
        ${deliveredStoreId ? `<p>Identifiant magasin : <strong>${escapeHtml(deliveredStoreId)}</strong></p>` : ''}
        ${addressBlock([doc.address_line1, doc.address_line2, [doc.postal_code, doc.city].filter(Boolean).join(' ')])}
      </div>
    </section>
    <table class="invoice-lines-table">
      <colgroup>
        <col class="col-line">
        <col class="col-designation">
        <col class="col-packages">
        <col class="col-weight-pack">
        <col class="col-quantity">
        <col class="col-price">
        <col class="col-total">
        <col class="col-vat-rate">
        <col class="col-vat">
        <col class="col-ttc">
      </colgroup>
      <thead><tr><th>Ligne</th><th>Designation</th><th>Colis</th><th>Poids/colis</th><th>Poids total</th><th>Prix HT</th><th>Total HT</th><th>TVA</th><th>Montant TVA</th><th>TTC</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <section class="bottom">
      <div class="footer-note">
        ${doc.notes ? `<h3>Notes</h3><p>${escapeHtml(doc.notes)}</p>` : ''}
        ${paymentInfo}
        ${legalInfo}
      </div>
      <div class="totals">
        <p><span>Total HT</span><strong>${money(doc.total_amount_ex_vat)}</strong></p>
        <p><span>TVA</span><strong>${money(doc.total_vat_amount)}</strong></p>
        <p class="grand-total"><span>Total TTC</span><strong>${money(doc.total_amount_inc_vat)}</strong></p>
      </div>
    </section>
    <p class="pennylane-status">Statut Pennylane : ${escapeHtml(doc.pennylane_status || 'not_sent')}</p>
  </article>`;

  const styles = `
    .invoice-document { display: flex; flex-direction: column; min-height: 277mm; }
    .invoice-document .doc-header { margin-bottom: 8px; }
    .invoice-links { color: #52616f; display: flex; gap: 14px; justify-content: flex-end; margin: -2px 0 8px; }
    .invoice-links p { margin: 0; }
    .invoice-lines-table { font-size: 8.8px; table-layout: fixed; }
    .invoice-lines-table th, .invoice-lines-table td { padding: 4px 3px; }
    .invoice-lines-table th { background: #e8eef4; border-color: #aebdcc; color: #17212b; font-size: 7.5px; letter-spacing: 0; }
    .invoice-lines-table tbody tr:nth-child(even) { background: #f8fafc; }
    .invoice-lines-table .invoice-group-row td { background: #dbe7ef; color: #17212b; font-size: 8.8px; font-weight: 800; text-transform: uppercase; }
    .invoice-lines-table .invoice-subtotal-row td { background: #eef3f7; font-weight: 800; }
    .designation-cell strong { display: block; overflow-wrap: anywhere; }
    .designation-cell small { font-size: 7.5px; line-height: 1.15; margin-top: 1px; overflow-wrap: anywhere; }
    .line-cell { text-align: center; }
    .vat-cell { font-size: 8px; }
    .col-line { width: 6%; }
    .col-designation { width: 27%; }
    .col-packages { width: 6%; }
    .col-weight-pack { width: 9%; }
    .col-quantity { width: 10%; }
    .col-price { width: 9%; }
    .col-total { width: 9%; }
    .col-vat-rate { width: 6%; }
    .col-vat { width: 8%; }
    .col-ttc { width: 10%; }
    .bottom { align-items: flex-start; display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr) 58mm; margin-top: 12px; }
    .footer-note h3 { margin-top: 8px; }
    .footer-note h3:first-child { margin-top: 0; }
    .pennylane-status { color: #64748b; font-size: 9px; margin-top: auto; text-align: right; }
  `;

  return htmlDocument('Facture client', body, styles);
}

function customerInvoiceFilename(invoice = {}) {
  return `${fileSafe(invoice.reference_number || invoice.id || 'facture-client')}.pdf`;
}

module.exports = {
  customerInvoiceFilename,
  renderCustomerInvoicePdf,
};
