function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[char]));
}

function number(value, fallback = 0) {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function money(value) {
  if (value === null || value === undefined || value === '') return '-';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(number(value));
}

function qty(value, digits = 3) {
  return number(value).toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatDate(value) {
  if (!value) return '-';
  try { return new Intl.DateTimeFormat('fr-FR').format(new Date(value)); }
  catch { return String(value); }
}

function joinAddress(settings = {}) {
  return [
    settings.address_line1,
    settings.address_line2,
    [settings.postal_code, settings.city].filter(Boolean).join(' '),
    settings.country,
  ].filter(Boolean);
}

function resolveCompanyEmail(settings = {}) {
  return settings.contact_email || settings.email || settings.email_sender_address || null;
}

function companyHeader(settings = {}, title = '', subtitle = '') {
  const companyName = settings.company_name || 'Gestion Commerciale';
  const address = joinAddress(settings).map((part) => `<p>${escapeHtml(part)}</p>`).join('');
  const meta = [
    settings.phone ? `Tel. ${settings.phone}` : null,
    resolveCompanyEmail(settings),
    settings.siret ? `SIRET ${settings.siret}` : null,
    settings.vat_number ? `TVA ${settings.vat_number}` : null,
    settings.sanitary_approval_number ? `Agrement sanitaire ${settings.sanitary_approval_number}` : null,
  ].filter(Boolean).map((item) => `<p>${escapeHtml(item)}</p>`).join('');

  return `<header class="doc-header">
    <div class="company-block">
      ${settings.logo_url ? `<img class="company-logo" src="${escapeHtml(settings.logo_url)}" alt="Logo ${escapeHtml(companyName)}">` : ''}
      <div>
        <h1>${escapeHtml(companyName)}</h1>
        ${address}
        <div class="company-meta">${meta}</div>
      </div>
    </div>
    <div class="document-title">
      <p>${escapeHtml(subtitle)}</p>
      <h2>${escapeHtml(title)}</h2>
    </div>
  </header>`;
}

function baseStyles(extra = '') {
  return `<style>
    @page { size: A4; margin: 10mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #17212b; font-family: Arial, sans-serif; font-size: 11px; line-height: 1.35; }
    .pdf-document { page-break-after: always; }
    .pdf-document:last-child { page-break-after: auto; }
    .doc-header { align-items: flex-start; border-bottom: 2px solid #17212b; display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr) 62mm; padding-bottom: 9px; margin-bottom: 10px; }
    .company-block { display: grid; gap: 8px; grid-template-columns: auto minmax(0, 1fr); }
    .company-logo { max-height: 18mm; max-width: 28mm; object-fit: contain; }
    .company-block h1, .document-title h2 { margin: 0; }
    .company-block h1 { font-size: 16px; }
    .company-block p, .document-title p, .party-card p, .footer-note p { margin: 2px 0; }
    .company-meta { display: flex; flex-wrap: wrap; gap: 0 8px; margin-top: 4px; }
    .document-title { border: 1px solid #8b98a5; padding: 8px 10px; text-align: right; }
    .document-title p { color: #52616f; font-size: 9.5px; font-weight: 700; text-transform: uppercase; }
    .document-title h2 { font-size: 16px; line-height: 1.2; overflow-wrap: anywhere; }
    .parties { display: grid; gap: 12px; grid-template-columns: 1fr 1fr; margin: 12px 0; }
    .party-card { border: 1px solid #c6d0d8; min-height: 24mm; padding: 9px 11px; }
    .party-card h3, .footer-note h3 { color: #52616f; font-size: 10px; margin: 0 0 6px; text-transform: uppercase; }
    .party-name { font-size: 13px; font-weight: 700; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #c6d0d8; padding: 5px 5px; text-align: left; vertical-align: top; }
    th { background: #eef2f5; color: #263746; font-size: 9.5px; text-transform: uppercase; }
    td small { color: #52616f; display: block; margin-top: 2px; }
    .num { text-align: right; white-space: nowrap; }
    .totals { border: 1px solid #17212b; margin-left: auto; width: 58mm; }
    .totals p { align-items: center; border-bottom: 1px solid #c6d0d8; display: flex; justify-content: space-between; margin: 0; padding: 6px 8px; }
    .totals p:last-child { border-bottom: 0; }
    .totals .grand-total { background: #eef2f5; font-size: 12px; }
    .footer-note { margin-top: 12px; }
    ${extra}
  </style>`;
}

function htmlDocument(title, body, extraStyles = '') {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>${baseStyles(extraStyles)}</head><body>${body}</body></html>`;
}

function fileSafe(value, fallback = 'document') {
  return String(value || fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || fallback;
}

module.exports = {
  companyHeader,
  escapeHtml,
  fileSafe,
  formatDate,
  htmlDocument,
  money,
  number,
  qty,
  resolveCompanyEmail,
};
