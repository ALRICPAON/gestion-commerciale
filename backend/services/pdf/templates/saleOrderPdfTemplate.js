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

function traceText(line) {
  const trace = line.traceability_snapshot || {};
  return [
    trace.lot_code || trace.supplier_lot_number,
    trace.latin_name,
    trace.fao_zone,
    trace.sous_zone,
    trace.fishing_gear || trace.engin,
    trace.production_method || trace.category,
  ].filter(Boolean).join(' | ');
}

function renderSaleOrderPdf({ sale, lines, storeSettings }) {
  const doc = sale || {};
  const settings = storeSettings || {};
  const rows = (lines || []).map((line) => `<tr>
    <td>${escapeHtml(line.line_number || '')}</td>
    <td>${escapeHtml(line.article_plu || '')}</td>
    <td><strong>${escapeHtml(line.article_label || '-')}</strong></td>
    <td class="num">${number(line.package_count)}</td>
    <td class="num">${qty(line.total_weight || line.sold_quantity)} ${escapeHtml(line.sale_unit || 'kg')}</td>
    <td>${escapeHtml(traceText(line) || (doc.origin === 'negoce' ? 'Produit negoce hors stock' : '-'))}</td>
    <td class="num">${money(line.unit_sale_price_ht)}</td>
    <td class="num">${money(line.line_amount_ht)}</td>
    <td class="num">${number(line.vat_rate).toFixed(2)} %</td>
    <td class="num">${money(line.line_amount_ttc)}</td>
  </tr>`).join('');

  const body = `<article class="pdf-document order-document">
    ${companyHeader(settings, doc.reference_number || doc.id || 'Commande client', `Commande client - ${formatDate(doc.document_date)}`)}
    <section class="parties">
      <div class="party-card">
        <h3>Client</h3>
        <p class="party-name">${escapeHtml(doc.client_name || doc.delivered_client_name_snapshot || '-')}</p>
        ${doc.client_code ? `<p>Code client : <strong>${escapeHtml(doc.client_code)}</strong></p>` : ''}
      </div>
      <div class="party-card">
        <h3>Informations commande</h3>
        <p>Statut : <strong>${escapeHtml(doc.status || '-')}</strong></p>
        <p>Origine : <strong>${escapeHtml(doc.origin || '-')}</strong></p>
        <p>Tarif : <strong>Tarif ${escapeHtml(doc.tariff_level_snapshot || doc.client_tariff_level || 1)}</strong></p>
      </div>
    </section>
    <table>
      <thead><tr><th>Ligne</th><th>PLU</th><th>Designation</th><th>Colis</th><th>Quantite</th><th>Lot / tracabilite</th><th>Prix HT</th><th>Total HT</th><th>TVA</th><th>TTC</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="10">Aucune ligne.</td></tr>'}</tbody>
    </table>
    <section class="bottom">
      <div class="footer-note">
        ${doc.notes ? `<h3>Notes</h3><p>${escapeHtml(doc.notes)}</p>` : ''}
        ${settings.terms_and_conditions ? `<h3>Conditions</h3><p>${escapeHtml(settings.terms_and_conditions)}</p>` : ''}
      </div>
      <div class="totals">
        <p><span>Total HT</span><strong>${money(doc.total_amount_ex_vat)}</strong></p>
        <p><span>TVA</span><strong>${money(doc.total_vat_amount)}</strong></p>
        <p class="grand-total"><span>Total TTC</span><strong>${money(doc.total_amount_inc_vat)}</strong></p>
      </div>
    </section>
  </article>`;

  const styles = `
    .order-document { min-height: 277mm; }
    .bottom { align-items: flex-start; display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr) 58mm; margin-top: 14px; }
  `;

  return htmlDocument('Commande client', body, styles);
}

function saleOrderFilename(sale = {}) {
  return `${fileSafe(sale.reference_number || sale.id || 'commande-client')}.pdf`;
}

module.exports = {
  renderSaleOrderPdf,
  saleOrderFilename,
};
