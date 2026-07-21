const API_BASE_URL = window.APP_CONFIG?.API_BASE_URL || '';
const sessionToken = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
const sessionUserRaw = localStorage.getItem('gc_user') || localStorage.getItem('grv2_user');

if (!sessionToken || !sessionUserRaw) {
  window.location.href = './login.html';
}

const sessionUser = JSON.parse(sessionUserRaw);

const userNameEl = document.getElementById('user-name');
const backHomeBtn = document.getElementById('back-home-btn');
const logoutBtn = document.getElementById('logout-btn');
const periodPreset = document.getElementById('period-preset');
const periodStartInput = document.getElementById('period-start');
const periodEndInput = document.getElementById('period-end');
const comparisonStartInput = document.getElementById('comparison-start');
const comparisonEndInput = document.getElementById('comparison-end');
const loadReportBtn = document.getElementById('load-report-btn');
const syncBtn = document.getElementById('sync-btn');
const exportPdfBtn = document.getElementById('export-pdf-btn');
const exportCsvBtn = document.getElementById('export-csv-btn');
const feedbackEl = document.getElementById('page-feedback');
const reportStatus = document.getElementById('report-status');
const kpiGrid = document.getElementById('kpi-grid');
const syncInfo = document.getElementById('sync-info');
const provisionalBadge = document.getElementById('provisional-badge');
const incomeStatementEl = document.getElementById('income-statement');
const comparisonTableEl = document.getElementById('comparison-table');
const autoAnalysisEl = document.getElementById('auto-analysis');
const trendChartEl = document.getElementById('trend-chart');
const chargesChartEl = document.getElementById('charges-chart');
const clientsChartEl = document.getElementById('clients-chart');
const suppliersChartEl = document.getElementById('suppliers-chart');

const INDICATOR_LABELS = {
  revenue: 'Chiffre d affaires',
  goods_purchases: 'Achats de marchandises',
  other_purchases: 'Autres achats',
  purchases: 'Achats',
  stock_variation: 'Variation de stock',
  purchases_consumed: 'Achats consommes',
  gross_margin: 'Marge brute',
  margin_rate: 'Taux de marge',
  external_services: 'Services exterieurs',
  other_external_services: 'Autres services',
  transport: 'Transport',
  external_charges: 'Charges externes',
  taxes: 'Impots et taxes',
  wages: 'Salaires',
  social_charges: 'Charges sociales',
  staff_costs: 'Masse salariale',
  ebitda: 'EBE estime',
  depreciation: 'Amortissements',
  operating_result: 'Resultat d exploitation',
  financial_result: 'Resultat financier',
  current_result: 'Resultat courant',
  exceptional_result: 'Resultat exceptionnel',
  income_tax: 'Impots sur les benefices',
  net_result: 'Resultat net',
};

function authHeaders() {
  return { Authorization: `Bearer ${sessionToken}` };
}

function showFeedback(message, type = 'success') {
  if (!feedbackEl) return;
  feedbackEl.textContent = message || '';
  feedbackEl.className = `page-feedback ${message ? '' : 'hidden'} ${type === 'error' ? 'error' : 'success'}`;
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function money(value) {
  return Number(value || 0).toLocaleString('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  });
}

function moneyPrecise(value) {
  return Number(value || 0).toLocaleString('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function percent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return `${Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
}

function signedPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  const sign = Number(value) > 0 ? '+' : '';
  return `${sign}${Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function setPresetDates() {
  const now = new Date();
  const value = periodPreset.value;
  let start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  let end = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));

  if (value === 'previous-month') {
    start = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1));
    end = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 0));
  } else if (value === 'current-year') {
    start = new Date(Date.UTC(now.getFullYear(), 0, 1));
  } else if (value === 'custom') {
    return;
  }

  periodStartInput.value = isoDate(start);
  periodEndInput.value = isoDate(end);
  const days = Math.max(1, Math.round((end - start) / 86400000) + 1);
  const comparisonEnd = new Date(start);
  comparisonEnd.setUTCDate(comparisonEnd.getUTCDate() - 1);
  const comparisonStart = new Date(comparisonEnd);
  comparisonStart.setUTCDate(comparisonStart.getUTCDate() - days + 1);
  comparisonStartInput.value = isoDate(comparisonStart);
  comparisonEndInput.value = isoDate(comparisonEnd);
}

function queryParams(extra = {}) {
  const params = new URLSearchParams({
    period_start: periodStartInput.value,
    period_end: periodEndInput.value,
    comparison_period_start: comparisonStartInput.value,
    comparison_period_end: comparisonEndInput.value,
    ...extra,
  });
  return params.toString();
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...authHeaders(),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Erreur API compte d exploitation');
    error.status = response.status;
    error.code = data.code || null;
    throw error;
  }
  return data;
}

function comparisonDelta(compare, key) {
  return compare?.calculations?.[key]?.delta_percent ?? null;
}

function kpiTone(value, positiveIsGood = true) {
  const number = Number(value || 0);
  if (number === 0) return '';
  const good = positiveIsGood ? number > 0 : number < 0;
  return good ? 'is-good' : 'is-alert';
}

function renderKpis(report = {}, compare = {}) {
  const c = report.calculations || {};
  const items = [
    ['Chiffre d affaires', money(c.revenue), comparisonDelta(compare, 'revenue'), true],
    ['Achats', money(c.purchases_consumed), comparisonDelta(compare, 'purchases_consumed'), false],
    ['Marge brute', money(c.gross_margin), comparisonDelta(compare, 'gross_margin'), true],
    ['Taux de marge', percent(c.margin_rate), comparisonDelta(compare, 'margin_rate'), true],
    ['Charges externes', money(c.external_charges), comparisonDelta(compare, 'external_charges'), false],
    ['Masse salariale', money(c.staff_costs), comparisonDelta(compare, 'staff_costs'), false],
    ['Resultat d exploitation', money(c.operating_result), comparisonDelta(compare, 'operating_result'), true],
    ['Resultat courant', money(c.current_result), comparisonDelta(compare, 'current_result'), true],
    ['Resultat net', money(c.net_result), comparisonDelta(compare, 'net_result'), true],
  ];
  kpiGrid.innerHTML = items.map(([label, value, delta, positiveIsGood]) => `
    <article class="financial-kpi ${kpiTone(delta, positiveIsGood)}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${delta === null ? 'Comparaison indisponible' : `${escapeHtml(signedPercent(delta))} vs periode precedente`}</small>
    </article>
  `).join('');
}

function sectionClass(section = {}) {
  if (section.section_code === 'to_classify') return 'is-alert';
  if (section.subsection_code === 'revenue') return 'is-revenue';
  if (section.subsection_code === 'goods_purchases' || section.subsection_code === 'purchases') return 'is-purchase';
  if (section.section_code === 'operating_expenses') return 'is-expense';
  if (section.section_code === 'financial_result') return 'is-financial';
  if (section.section_code === 'exceptional_result') return 'is-exceptional';
  return '';
}

function resultRows(report = {}) {
  const c = report.calculations || {};
  return [
    ['MARGE BRUTE', c.gross_margin],
    ['EXCEDENT BRUT D EXPLOITATION', c.ebitda],
    ['RESULTAT D EXPLOITATION', c.operating_result],
    ['RESULTAT FINANCIER', c.financial_result],
    ['RESULTAT COURANT', c.current_result],
    ['RESULTAT EXCEPTIONNEL', c.exceptional_result],
    ['RESULTAT NET', c.net_result],
  ];
}

function renderStatement(report = {}) {
  const sections = Array.isArray(report.sections) ? report.sections : [];
  if (!sections.length) {
    incomeStatementEl.innerHTML = '<div class="financial-empty">Aucune balance comptable chargee pour cette periode.</div>';
    return;
  }
  const unknownAccounts = Array.isArray(report.unknown_accounts) ? report.unknown_accounts : [];
  const unknownAmount = unknownAccounts.reduce((sum, account) => sum + Math.abs(Number(account.amount || 0)), 0);
  const unclassifiedWarning = unknownAccounts.length
    ? `<div class="financial-warning">
        <div>
          <strong>${unknownAccounts.length} compte${unknownAccounts.length > 1 ? 's' : ''} representant ${escapeHtml(moneyPrecise(unknownAmount))} restent a classer.</strong>
          <span>Ils sont inclus dans les totaux du compte d exploitation.</span>
        </div>
        <button class="btn btn-secondary btn-sm" type="button" data-action="open-accounting-settings">Parametres comptables</button>
      </div>`
    : '';
  const control = report.consistency_control || {};
  const controlIsOk = control.status === 'conforme';
  const controlHtml = control.status
    ? `<div class="financial-control ${controlIsOk ? 'is-ok' : 'is-alert'}">
        <strong>${controlIsOk ? 'Controle conforme avec la balance Pennylane' : 'Ecart detecte avec la balance Pennylane'}</strong>
        <span>Charges ${escapeHtml(moneyPrecise(control.alta?.charges))} / Produits ${escapeHtml(moneyPrecise(control.alta?.products))} / Resultat ${escapeHtml(moneyPrecise(control.alta?.result))}</span>
        ${controlIsOk ? '' : `<span>Ecart resultat : ${escapeHtml(moneyPrecise(control.gaps?.result))}</span>`}
      </div>`
    : '';
  const warning = report.incomplete && !unknownAccounts.length
    ? '<div class="financial-warning">Certaines donnees sont incompletes. Le resultat reste provisoire.</div>'
    : '';
  const sectionHtml = sections.map((section) => `
    <details class="financial-section ${sectionClass(section)}" open>
      <summary>
        <span>${escapeHtml(section.display_label)}</span>
        <strong>${escapeHtml(money(section.amount))}</strong>
      </summary>
      <table class="financial-table">
        <thead>
          <tr><th>Compte</th><th>Libelle</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Solde</th></tr>
        </thead>
        <tbody>
          ${(section.accounts || []).map((account) => `
            <tr class="drill-row" title="Le detail des ecritures et factures sera raccorde avec les ecritures Pennylane detaillees.">
              <td>${escapeHtml(account.formatted_account_number || account.account_number)}</td>
              <td>${escapeHtml(account.account_label || '')}</td>
              <td class="num">${escapeHtml(money(account.total_debit))}</td>
              <td class="num">${escapeHtml(money(account.total_credit))}</td>
              <td class="num">${escapeHtml(money(account.amount))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </details>
  `).join('');
  const totals = resultRows(report).map(([label, value]) => `
    <div class="financial-result-line">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(money(value))}</strong>
    </div>
  `).join('');
  incomeStatementEl.innerHTML = `${unclassifiedWarning}${controlHtml}${warning}<div class="financial-result-stack">${totals}</div>${sectionHtml}`;
}

function renderComparison(compare = {}) {
  const keys = ['revenue', 'purchases_consumed', 'gross_margin', 'external_charges', 'staff_costs', 'operating_result', 'current_result', 'net_result'];
  const rows = keys.map((key) => [key, compare.calculations?.[key]]).filter(([, row]) => row);
  if (!rows.length) {
    comparisonTableEl.innerHTML = '<div class="financial-empty">Aucune comparaison disponible.</div>';
    return;
  }
  comparisonTableEl.innerHTML = `
    <table class="financial-table">
      <thead><tr><th>Indicateur</th><th class="num">Periode actuelle</th><th class="num">Periode precedente</th><th class="num">Ecart</th><th class="num">Ecart %</th></tr></thead>
      <tbody>
        ${rows.map(([key, row]) => `
          <tr>
            <td>${escapeHtml(INDICATOR_LABELS[key] || key)}</td>
            <td class="num">${escapeHtml(money(row.current))}</td>
            <td class="num">${escapeHtml(money(row.previous))}</td>
            <td class="num">${escapeHtml(money(row.delta))}</td>
            <td class="num">${escapeHtml(signedPercent(row.delta_percent))}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderBarChart(element, rows, options = {}) {
  if (!rows.length) {
    element.innerHTML = '<div class="financial-empty">Aucune donnée disponible.</div>';
    return;
  }
  const max = Math.max(1, ...rows.map((row) => Math.abs(Number(row.value || 0))));
  element.innerHTML = rows.map((row) => {
    const width = Math.max(4, Math.round((Math.abs(Number(row.value || 0)) / max) * 100));
    return `
      <div class="chart-row">
        <div class="chart-label"><span>${escapeHtml(row.label)}</span><strong>${escapeHtml(options.percent ? percent(row.value) : money(row.value))}</strong></div>
        <div class="chart-track"><span class="${row.className || ''}" style="width:${width}%"></span></div>
      </div>
    `;
  }).join('');
}

function renderCharts(report = {}, compare = {}) {
  const c = report.calculations || {};
  const business = report.business_breakdown || {};
  renderBarChart(trendChartEl, [
    { label: 'Chiffre d affaires', value: comparisonDelta(compare, 'revenue') || 0, className: 'is-revenue' },
    { label: 'Marge brute', value: comparisonDelta(compare, 'gross_margin') || 0, className: 'is-good' },
    { label: 'Resultat net', value: comparisonDelta(compare, 'net_result') || 0, className: 'is-result' },
  ], { percent: true });
  renderBarChart(chargesChartEl, [
    { label: 'Achats', value: c.purchases_consumed || 0, className: 'is-purchase' },
    { label: 'Charges externes', value: c.external_charges || 0, className: 'is-expense' },
    { label: 'Transport', value: c.transport || 0, className: 'is-expense' },
    { label: 'Masse salariale', value: c.staff_costs || 0, className: 'is-staff' },
    { label: 'Amortissements', value: c.depreciation || 0, className: 'is-muted' },
  ]);
  renderBarChart(clientsChartEl, (business.top_clients || []).map((row) => ({
    label: row.label,
    value: row.amount,
    className: 'is-revenue',
  })));
  renderBarChart(suppliersChartEl, (business.top_suppliers || []).map((row) => ({
    label: row.label,
    value: row.amount,
    className: 'is-purchase',
  })));
}

function analysisSentence(label, delta, goodWhenPositive = true) {
  if (delta === null || delta === undefined) return null;
  const direction = Number(delta) >= 0 ? 'progresse' : 'recule';
  const tone = (Number(delta) >= 0) === goodWhenPositive ? 'point positif' : 'point de vigilance';
  return `${label} ${direction} de ${signedPercent(Math.abs(delta))} : ${tone}.`;
}

function renderAutoAnalysis(report = {}, compare = {}) {
  const c = report.calculations || {};
  const purchaseRatio = c.revenue ? (c.purchases_consumed / c.revenue) * 100 : null;
  const alerts = [
    analysisSentence('Le chiffre d affaires', comparisonDelta(compare, 'revenue'), true),
    analysisSentence('La marge brute', comparisonDelta(compare, 'gross_margin'), true),
    analysisSentence('Les charges externes', comparisonDelta(compare, 'external_charges'), false),
    analysisSentence('Le resultat net', comparisonDelta(compare, 'net_result'), true),
  ].filter(Boolean);
  const vigilance = [];
  if (purchaseRatio !== null && purchaseRatio > 75) vigilance.push(`Les achats representent ${percent(purchaseRatio)} du chiffre d affaires.`);
  if ((comparisonDelta(compare, 'transport') || 0) > 10) vigilance.push('Les frais de transport augmentent fortement.');
  if ((comparisonDelta(compare, 'margin_rate') || 0) < 0) vigilance.push('Le taux de marge se degrade.');
  if (!vigilance.length) vigilance.push('Aucun signal majeur detecte sur la periode comparee.');

  autoAnalysisEl.innerHTML = `
    <p>${alerts[0] ? escapeHtml(alerts[0]) : 'Analyse disponible apres synchronisation et comparaison.'}</p>
    ${alerts.slice(1).map((item) => `<p>${escapeHtml(item)}</p>`).join('')}
    <h4>Points de vigilance</h4>
    <ul>${vigilance.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
  `;
}

function updateMeta(report = {}) {
  reportStatus.textContent = `Periode du ${report.period_start || periodStartInput.value} au ${report.period_end || periodEndInput.value}`;
  provisionalBadge.textContent = report.provisional ? 'Document provisoire' : 'Periode cloturee';
  provisionalBadge.classList.toggle('is-final', !report.provisional);
  const fetchedAt = report.snapshot?.fetched_at || report.last_sync?.completed_at || null;
  syncInfo.textContent = fetchedAt
    ? `Derniere synchronisation : ${new Date(fetchedAt).toLocaleString('fr-FR')}`
    : 'Aucune synchronisation chargee.';
}

async function loadReport(refresh = false) {
  showFeedback('');
  const report = await requestJson(`/api/reports/financial/income-statement?${queryParams({ refresh })}`);
  const compare = await requestJson(`/api/reports/financial/comparison?${queryParams()}`);
  renderKpis(report, compare);
  renderStatement(report);
  renderComparison(compare);
  renderCharts(report, compare);
  renderAutoAnalysis(report, compare);
  updateMeta(report);
}

async function syncReport() {
  syncBtn.disabled = true;
  syncBtn.textContent = 'Synchronisation...';
  try {
    await requestJson('/api/reports/financial/sync', {
      method: 'POST',
      body: JSON.stringify({
        period_start: periodStartInput.value,
        period_end: periodEndInput.value,
      }),
    });
    await loadReport(false);
    showFeedback('Balance comptable synchronisee.', 'success');
  } catch (error) {
    console.error('Erreur synchronisation compte exploitation :', { message: error.message, status: error.status, code: error.code });
    showFeedback(error.message || 'Erreur synchronisation Pennylane', 'error');
  } finally {
    syncBtn.disabled = false;
    syncBtn.textContent = 'Actualiser depuis Pennylane';
  }
}

async function exportReport(format) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/reports/financial/export?${queryParams({ format })}`, {
      headers: authHeaders(),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Erreur export compte d exploitation');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `compte-exploitation-${periodStartInput.value}-${periodEndInput.value}.${format === 'pdf' ? 'pdf' : 'csv'}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Erreur export compte exploitation :', { message: error.message });
    showFeedback(error.message || 'Erreur export compte d exploitation', 'error');
  }
}

function initEvents() {
  userNameEl.textContent = sessionUser.email || sessionUser.name || 'Utilisateur';
  backHomeBtn.addEventListener('click', () => { window.location.href = './home.html'; });
  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('gc_token');
    localStorage.removeItem('gc_user');
    localStorage.removeItem('grv2_token');
    localStorage.removeItem('grv2_user');
    window.location.href = './login.html';
  });
  periodPreset.addEventListener('change', setPresetDates);
  loadReportBtn.addEventListener('click', () => loadReport(false).catch((error) => {
    console.error('Erreur chargement compte exploitation :', { message: error.message, status: error.status, code: error.code });
    showFeedback(error.message || 'Erreur chargement compte d exploitation', 'error');
  }));
  syncBtn.addEventListener('click', syncReport);
  exportPdfBtn.addEventListener('click', () => exportReport('pdf'));
  exportCsvBtn.addEventListener('click', () => exportReport('csv'));
  incomeStatementEl.addEventListener('click', (event) => {
    if (!event.target.closest('[data-action="open-accounting-settings"]')) return;
    window.location.href = './accounting-settings.html';
  });
}

setPresetDates();
initEvents();
loadReport(false).catch((error) => {
  console.error('Erreur initialisation compte exploitation :', { message: error.message, status: error.status, code: error.code });
  showFeedback(error.message || 'Erreur initialisation compte d exploitation', 'error');
});
