const API_BASE_URL = window.APP_CONFIG?.API_BASE_URL || '';
const sessionToken = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
const sessionUserRaw = localStorage.getItem('gc_user') || localStorage.getItem('grv2_user');

if (!sessionToken || !sessionUserRaw) {
  window.location.href = './login.html';
}

const sessionUser = JSON.parse(sessionUserRaw);

const els = {
  userName: document.getElementById('user-name'),
  backHome: document.getElementById('back-home-btn'),
  logout: document.getElementById('logout-btn'),
  status: document.getElementById('cashflow-status'),
  feedback: document.getElementById('page-feedback'),
  scenario: document.getElementById('scenario-select'),
  horizon: document.getElementById('horizon-select'),
  sync: document.getElementById('sync-btn'),
  exportPdf: document.getElementById('export-pdf-btn'),
  exportCsv: document.getElementById('export-csv-btn'),
  kpis: document.getElementById('kpi-grid'),
  chart: document.getElementById('forecast-chart'),
  forecastAlert: document.getElementById('forecast-alert'),
  reliability: document.getElementById('reliability-box'),
  weekly: document.getElementById('weekly-table'),
  receivables: document.getElementById('receivables-table'),
  behaviours: document.getElementById('behaviour-table'),
  payables: document.getElementById('payables-table'),
  distrimerBox: document.getElementById('distrimer-box'),
  distrimerTable: document.getElementById('distrimer-table'),
  distrimerPlanned: document.getElementById('distrimer-planned'),
  distrimerPayment: document.getElementById('distrimer-payment'),
  distrimerSimulation: document.getElementById('distrimer-simulation'),
  simulateDistrimer: document.getElementById('simulate-distrimer-btn'),
  bankWarning: document.getElementById('bank-warning'),
  bankAccounts: document.getElementById('bank-accounts-table'),
  bankTable: document.getElementById('bank-table'),
  chargesAlerts: document.getElementById('charges-alerts'),
  recurringChargesTable: document.getElementById('recurring-charges-table'),
  diagnosticTable: document.getElementById('diagnostic-table'),
  runDiagnostic: document.getElementById('run-diagnostic-btn'),
  manualForm: document.getElementById('manual-form'),
  manualTable: document.getElementById('manual-table'),
  settingsForm: document.getElementById('settings-form'),
  settingOpeningBalance: document.getElementById('setting-opening-balance'),
  settingBankLabel: document.getElementById('setting-bank-label'),
  settingDistrimerLimit: document.getElementById('setting-distrimer-limit'),
  settingDistrimerTarget: document.getElementById('setting-distrimer-target'),
  settingDefaultDelay: document.getElementById('setting-default-delay'),
};

let state = {
  dashboard: null,
  receivables: [],
  payables: [],
  distrimer: null,
  settings: null,
};

function authHeaders() {
  return { Authorization: `Bearer ${sessionToken}` };
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
  const number = Number(value || 0);
  return number.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}

function dateFr(value) {
  if (!value) return '-';
  return new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR');
}

function showFeedback(message, type = 'success') {
  els.feedback.textContent = message || '';
  els.feedback.className = `page-feedback ${message ? '' : 'hidden'} ${type === 'error' ? 'error' : 'success'}`;
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
  if (!response.ok) throw new Error(data.error || 'Erreur tresorerie');
  return data;
}

function table(headers, rows, empty = 'Aucune donnee disponible.') {
  if (!rows.length) return `<div class="cashflow-warning">${escapeHtml(empty)}</div>`;
  return `
    <table class="cashflow-table">
      <thead><tr>${headers.map((head) => `<th class="${head.className || ''}">${escapeHtml(head.label)}</th>`).join('')}</tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>
  `;
}

function renderKpis(kpis = {}) {
  const items = [
    ['Solde bancaire actuel', money(kpis.bank_balance), kpis.bank_balance_source === 'snapshot_bancaire_alta' ? 'Snapshot bancaire ALTA' : 'Solde manuel', ''],
    ['Tresorerie prevue a 7 jours', money(kpis.forecast_7_days), 'Solde cumule', Number(kpis.forecast_7_days) < 0 ? 'is-alert' : 'is-good'],
    ['Tresorerie prevue a 30 jours', money(kpis.forecast_30_days), 'Solde cumule', Number(kpis.forecast_30_days) < 0 ? 'is-alert' : ''],
    ['Encaissements attendus', money(kpis.expected_inflows), 'Factures et mouvements', 'is-good'],
    ['Decaissements attendus', money(kpis.expected_outflows), 'Factures et mouvements', 'is-warning'],
    ['Factures clients en retard', kpis.overdue_customer_invoices || 0, 'A encaisser', Number(kpis.overdue_customer_invoices) > 0 ? 'is-alert' : ''],
    ['Factures fournisseurs a payer', kpis.supplier_invoices_to_pay || 0, 'Echeances ouvertes', ''],
    ['Encours DISTRIMER', money(kpis.distrimer_exposure), 'Limite assuree 10 000 EUR', Number(kpis.distrimer_exposure) > 9500 ? 'is-alert' : 'is-warning'],
    ['Marge disponible DISTRIMER', money(kpis.distrimer_remaining_margin), 'Avant limite assuree', Number(kpis.distrimer_remaining_margin) < 0 ? 'is-alert' : ''],
  ];
  els.kpis.innerHTML = items.map(([label, value, note, tone]) => `
    <article class="cashflow-kpi ${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(note)}</small>
    </article>
  `).join('');
}

function renderChart(forecast = {}) {
  const rows = forecast.rows || [];
  if (!rows.length) {
    els.chart.innerHTML = '<div class="cashflow-warning">Aucune prevision disponible.</div>';
    return;
  }
  const max = Math.max(1, ...rows.map((row) => Math.abs(Number(row.closing_balance || 0))));
  els.chart.innerHTML = `
    <div class="chart-bars">
      ${rows.map((row) => {
        const height = Math.max(3, Math.round((Math.abs(Number(row.closing_balance || 0)) / max) * 100));
        return `<span class="chart-bar ${Number(row.closing_balance) < 0 ? 'is-negative' : ''}" style="height:${height}%" title="${dateFr(row.date)} - ${money(row.closing_balance)}"></span>`;
      }).join('')}
    </div>
  `;
  els.forecastAlert.textContent = forecast.first_negative_date
    ? `Alerte : solde negatif prevu le ${dateFr(forecast.first_negative_date)}. Point bas ${money(forecast.minimum_balance)}.`
    : `Point bas prevu : ${money(forecast.minimum_balance)} le ${dateFr(forecast.minimum_date)}.`;
}

function renderReliability(reliability = {}) {
  const source = reliability.source || {};
  const diagnostics = reliability.diagnostics || [];
  els.reliability.innerHTML = `
    <p><strong>Derniere synchronisation :</strong> ${reliability.last_sync?.completed_at ? new Date(reliability.last_sync.completed_at).toLocaleString('fr-FR') : 'Aucune synchronisation cashflow'}</p>
    <p><strong>Compte bancaire :</strong> ${escapeHtml(reliability.bank_account || '-')}</p>
    <p><strong>Comptes inclus :</strong> ${escapeHtml((reliability.bank_accounts || []).filter((account) => account.include_in_cashflow).map((account) => account.name).join(', ') || '-')}</p>
    <p><strong>Factures clients :</strong> ${reliability.customer_invoice_count || 0}</p>
    <p><strong>Factures fournisseurs :</strong> ${reliability.supplier_invoice_count || 0}</p>
    <p><strong>Mouvements manuels :</strong> ${reliability.manual_item_count || 0}</p>
    <p><strong>Charges recurrentes :</strong> ${reliability.recurring_charge_count || 0}</p>
    <p><strong>Diagnostic Pennylane :</strong> ${diagnostics.length ? `${diagnostics.filter((row) => row.access_status === 'accessible').length}/${diagnostics.length} acces OK` : escapeHtml((source.required_scopes || []).join(', '))}</p>
  `;
  renderDiagnostic({ diagnostics });
}

function renderWeekly(rows = []) {
  els.weekly.innerHTML = table(
    [
      { label: 'Semaine' },
      { label: 'Solde debut', className: 'num' },
      { label: 'Encaissements', className: 'num' },
      { label: 'Decaissements', className: 'num' },
      { label: 'Solde fin', className: 'num' },
    ],
    rows.map((row) => `
      <tr>
        <td>${escapeHtml(row.week)}</td>
        <td class="num">${money(row.opening_balance)}</td>
        <td class="num">${money(row.inflows)}</td>
        <td class="num">${money(row.outflows)}</td>
        <td class="num">${money(row.closing_balance)}</td>
      </tr>
    `)
  );
}

function renderReceivables(data = {}) {
  state.receivables = data.invoices || [];
  els.receivables.innerHTML = table(
    [
      { label: 'Client' }, { label: 'Facture' }, { label: 'Date' }, { label: 'Echeance' },
      { label: 'Montant restant', className: 'num' }, { label: 'Paiement previsionnel' }, { label: 'Retard' }, { label: 'Fiabilite' },
    ],
    state.receivables.map((row) => `
      <tr>
        <td>${escapeHtml(row.client_name)}</td>
        <td>${escapeHtml(row.invoice_number || '-')}</td>
        <td>${dateFr(row.invoice_date)}</td>
        <td>${dateFr(row.due_date)}</td>
        <td class="num">${money(row.remaining_amount)}</td>
        <td>${dateFr(row.expected_payment_date)}</td>
        <td>${row.is_overdue ? '<span class="cashflow-badge rouge">En retard</span>' : '<span class="cashflow-badge vert">A venir</span>'}</td>
        <td>${escapeHtml(row.forecast_reliability || 'standard')}</td>
      </tr>
    `)
  );
  els.behaviours.innerHTML = table(
    [
      { label: 'Client' }, { label: 'Factures payees', className: 'num' }, { label: 'Delai facture paiement', className: 'num' }, { label: 'Retard moyen', className: 'num' }, { label: 'Fiabilite' },
    ],
    (data.behaviours || []).map((row) => `
      <tr>
        <td>${escapeHtml(row.client_name)}</td>
        <td class="num">${row.paid_invoice_count || 0}</td>
        <td class="num">${row.average_invoice_to_payment_days ?? '-'}</td>
        <td class="num">${row.average_due_delay_days ?? '-'}</td>
        <td>${escapeHtml(row.reliability)}</td>
      </tr>
    `)
  );
}

function renderPayables(data = {}) {
  state.payables = data.invoices || [];
  els.payables.innerHTML = table(
    [
      { label: 'Fournisseur' }, { label: 'Facture' }, { label: 'Echeance' }, { label: 'Montant restant', className: 'num' }, { label: 'Paye confirme', className: 'num' }, { label: 'En cours', className: 'num' }, { label: 'Paiement prevu' }, { label: 'Priorite' },
    ],
    state.payables.map((row) => `
      <tr>
        <td>${escapeHtml(row.supplier_name)}</td>
        <td>${escapeHtml(row.invoice_number || '-')}</td>
        <td>${dateFr(row.due_date)}</td>
        <td class="num">${money(row.remaining_amount)}</td>
        <td class="num">${money(row.confirmed_paid_amount)}</td>
        <td class="num">${money(row.pending_payment_amount)}</td>
        <td>${dateFr(row.planned_payment_date)}</td>
        <td>${escapeHtml(row.priority || 'normale')}</td>
      </tr>
    `)
  );
}

function renderDistrimer(data = {}) {
  state.distrimer = data;
  els.distrimerBox.innerHTML = `
    <p><strong>Encours DISTRIMER :</strong> ${money(data.exposure)}</p>
    <p><strong>Limite assuree :</strong> ${money(data.limit)}</p>
    <p><strong>Marge restante :</strong> ${money(data.remaining_margin)}</p>
    <p><span class="cashflow-badge ${escapeHtml(data.level)}">${escapeHtml(data.level || 'vert')}</span></p>
    <p>${data.breach ? `L'encours atteindra ${money(data.breach.exposure)} le ${dateFr(data.breach.date)}. Paiement minimum ${money(data.minimum_payment)}.` : 'Aucun depassement prevu avec les factures connues.'}</p>
    <p><strong>Paiement conseille :</strong> ${money(data.advised_payment)}</p>
  `;
  els.distrimerTable.innerHTML = table(
    [{ label: 'Source' }, { label: 'Facture' }, { label: 'Date' }, { label: 'Montant', className: 'num' }],
    (data.items || []).map((row) => `
      <tr>
        <td>${escapeHtml(row.source)}</td>
        <td>${escapeHtml(row.label)}</td>
        <td>${dateFr(row.date)}</td>
        <td class="num">${money(row.amount)}</td>
      </tr>
    `)
  );
}

async function simulateDistrimer() {
  const payload = {
    current_exposure: state.distrimer?.exposure || 0,
    planned_purchases: Number(els.distrimerPlanned.value || 0),
    payment_amount: els.distrimerPayment.value === '' ? null : Number(els.distrimerPayment.value),
    bank_balance: state.dashboard?.kpis?.bank_balance || 0,
    expected_inflows: state.dashboard?.kpis?.expected_inflows || 0,
  };
  const data = await requestJson('/api/cashflow/distrimer/simulate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  els.distrimerSimulation.innerHTML = `
    <p><strong>Encours futur :</strong> ${money(data.future_exposure)}</p>
    <p><strong>Paiement minimum obligatoire :</strong> ${money(data.minimum_payment)}</p>
    <p><strong>Paiement conseille :</strong> ${money(data.advised_payment)}</p>
    <p><strong>Date limite :</strong> ${dateFr(data.payment_deadline)}</p>
    <p><strong>Tresorerie apres paiement :</strong> ${money(data.treasury_after_payment)}</p>
  `;
}

async function loadBank() {
  const [data, accounts] = await Promise.all([
    requestJson('/api/cashflow/bank-transactions'),
    requestJson('/api/cashflow/bank-accounts'),
  ]);
  els.bankWarning.textContent = data.warning || 'Les mouvements sont issus de Pennylane lorsque le scope transactions:readonly est autorise.';
  els.bankAccounts.innerHTML = table(
    [{ label: 'Compte' }, { label: 'Solde', className: 'num' }, { label: 'Devise' }, { label: 'Inclus' }, { label: 'Mise a jour Pennylane' }],
    (accounts.accounts || []).map((row) => `
      <tr>
        <td>${escapeHtml(row.name)}</td>
        <td class="num">${money(row.balance)}</td>
        <td>${escapeHtml(row.currency || 'EUR')}</td>
        <td>${row.include_in_cashflow ? '<span class="cashflow-badge vert">Oui</span>' : '<span class="cashflow-badge">Non</span>'}</td>
        <td>${row.pennylane_updated_at ? new Date(row.pennylane_updated_at).toLocaleString('fr-FR') : '-'}</td>
      </tr>
    `),
    'Aucun compte bancaire Pennylane synchronise.'
  );
  els.bankTable.innerHTML = table(
    [{ label: 'Date' }, { label: 'Libelle' }, { label: 'Montant', className: 'num' }, { label: 'Type' }, { label: 'Rapprochement' }, { label: 'Tiers' }, { label: 'Source' }],
    (data.transactions || []).map((row) => `
      <tr>
        <td>${dateFr(row.transaction_date)}</td>
        <td>${escapeHtml(row.label)}</td>
        <td class="num">${money(row.amount)}</td>
        <td>${row.direction === 'out' ? 'Decaissement' : 'Encaissement'}</td>
        <td>${escapeHtml(reconciliationLabel(row))}</td>
        <td>${escapeHtml(row.counterparty_name || '-')}</td>
        <td>${escapeHtml(row.source || 'Pennylane')}</td>
      </tr>
    `)
  );
}

function reconciliationLabel(row) {
  const status = String(row.reconciliation_status || '').toLowerCase();
  if (['matched', 'reconciled'].includes(status) || row.reconciled === true) return 'Rapproche';
  if (status.includes('partial')) return 'Partiellement rapproche';
  if (!status && row.reconciled === false) return 'Non rapproche';
  return status || 'A verifier';
}

function renderDiagnostic(data = {}) {
  if (!els.diagnosticTable) return;
  els.diagnosticTable.innerHTML = table(
    [{ label: 'Donnee' }, { label: 'Endpoint' }, { label: 'Statut' }, { label: 'Scope requis' }, { label: 'Elements', className: 'num' }, { label: 'Action' }],
    (data.diagnostics || []).map((row) => `
      <tr>
        <td>${escapeHtml(row.label || row.endpoint)}</td>
        <td>${escapeHtml(row.endpoint)}</td>
        <td><span class="cashflow-badge ${row.access_status === 'accessible' ? 'vert' : 'rouge'}">${row.access_status === 'accessible' ? 'Accessible' : 'Acces refuse'}</span></td>
        <td>${escapeHtml(row.required_scope)}</td>
        <td class="num">${row.item_count || 0}</td>
        <td>${escapeHtml(row.action_required || row.error_message || '-')}</td>
      </tr>
    `),
    'Aucun diagnostic execute.'
  );
}

async function loadCharges() {
  const [completion, recurring] = await Promise.all([
    requestJson('/api/cashflow/charges-to-complete'),
    requestJson('/api/cashflow/recurring-charges'),
  ]);
  els.chargesAlerts.innerHTML = table(
    [{ label: 'Alerte' }, { label: 'Action' }],
    (completion.alerts || []).map((row) => `
      <tr><td>${escapeHtml(row.message)}</td><td><button class="btn btn-secondary btn-sm" type="button" data-prefill-charge="${escapeHtml(row.code)}">${escapeHtml(row.action)}</button></td></tr>
    `),
    'Aucune charge manquante detectee.'
  );
  els.recurringChargesTable.innerHTML = table(
    [{ label: 'Libelle' }, { label: 'Categorie' }, { label: 'Montant', className: 'num' }, { label: 'Premiere echeance' }, { label: 'Frequence' }],
    (recurring.charges || []).map((row) => `
      <tr><td>${escapeHtml(row.label)}</td><td>${escapeHtml(row.category_code)}</td><td class="num">${money(row.cash_amount)}</td><td>${dateFr(row.first_due_date)}</td><td>${escapeHtml(row.frequency)}</td></tr>
    `),
    'Aucune charge recurrente configuree.'
  );
}

async function loadManualItems() {
  const data = await requestJson('/api/cashflow/manual-items');
  els.manualTable.innerHTML = table(
    [{ label: 'Libelle' }, { label: 'Type' }, { label: 'Montant', className: 'num' }, { label: 'Date' }, { label: 'Recurrence' }, { label: '' }],
    (data.items || []).map((row) => `
      <tr>
        <td>${escapeHtml(row.label)}</td>
        <td>${row.direction === 'out' ? 'Sortie' : 'Entree'}</td>
        <td class="num">${money(row.amount)}</td>
        <td>${dateFr(row.forecast_date)}</td>
        <td>${escapeHtml(row.recurrence)}</td>
        <td><button class="btn btn-secondary btn-sm" type="button" data-delete-manual="${escapeHtml(row.id)}">Supprimer</button></td>
      </tr>
    `)
  );
}

async function loadSettings() {
  const data = await requestJson('/api/cashflow/settings');
  state.settings = data.settings || {};
  els.settingOpeningBalance.value = state.settings.opening_balance ?? 0;
  els.settingBankLabel.value = state.settings.main_bank_account_label || '';
  els.settingDistrimerLimit.value = state.settings.distrimer_limit ?? 10000;
  els.settingDistrimerTarget.value = state.settings.distrimer_target_after_payment ?? 7500;
  els.settingDefaultDelay.value = state.settings.default_customer_delay_days ?? 30;
}

async function loadAll() {
  showFeedback('');
  const query = `scenario=${encodeURIComponent(els.scenario.value)}&days=${encodeURIComponent(els.horizon.value)}`;
  const [dashboard, forecast, receivables, payables, distrimer] = await Promise.all([
    requestJson(`/api/cashflow/dashboard?${query}`),
    requestJson(`/api/cashflow/forecast?${query}`),
    requestJson('/api/cashflow/customer-receivables'),
    requestJson('/api/cashflow/supplier-payables'),
    requestJson('/api/cashflow/distrimer'),
  ]);
  state.dashboard = dashboard;
  renderKpis(dashboard.kpis || {});
  renderChart(forecast);
  renderReliability(dashboard.reliability || {});
  renderWeekly(forecast.weekly_rows || dashboard.weekly_forecast || []);
  renderReceivables(receivables);
  renderPayables(payables);
  renderDistrimer(distrimer);
  await Promise.all([loadBank(), loadCharges(), loadManualItems(), loadSettings()]);
  els.status.textContent = `Scenario ${els.scenario.options[els.scenario.selectedIndex].textContent.toLowerCase()} sur ${els.horizon.value} jours.`;
}

async function syncPennylane() {
  els.sync.disabled = true;
  els.sync.textContent = 'Synchronisation...';
  try {
    await requestJson('/api/cashflow/sync', { method: 'POST', body: JSON.stringify({}) });
    await loadAll();
    showFeedback('Synchronisation Pennylane terminee. Les donnees bancaires restent limitees aux sources validees.', 'success');
  } catch (error) {
    showFeedback(error.message || 'Erreur synchronisation', 'error');
  } finally {
    els.sync.disabled = false;
    els.sync.textContent = 'Synchroniser Pennylane';
  }
}

async function exportForecast(format) {
  const query = `scenario=${encodeURIComponent(els.scenario.value)}&days=${encodeURIComponent(els.horizon.value)}&format=${format}`;
  const response = await fetch(`${API_BASE_URL}/api/cashflow/export?${query}`, { headers: authHeaders() });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Erreur export');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `previsionnel-tresorerie.${format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function bindEvents() {
  els.userName.textContent = sessionUser.email || sessionUser.name || 'Utilisateur';
  els.backHome.addEventListener('click', () => { window.location.href = './home.html'; });
  els.logout.addEventListener('click', () => {
    localStorage.removeItem('gc_token');
    localStorage.removeItem('gc_user');
    localStorage.removeItem('grv2_token');
    localStorage.removeItem('grv2_user');
    window.location.href = './login.html';
  });
  document.querySelectorAll('.cashflow-tab').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.cashflow-tab').forEach((tab) => tab.classList.remove('is-active'));
      document.querySelectorAll('.cashflow-tab-panel').forEach((panel) => panel.classList.remove('is-active'));
      button.classList.add('is-active');
      document.querySelector(`[data-panel="${button.dataset.tab}"]`)?.classList.add('is-active');
    });
  });
  els.scenario.addEventListener('change', () => loadAll().catch((error) => showFeedback(error.message, 'error')));
  els.horizon.addEventListener('change', () => loadAll().catch((error) => showFeedback(error.message, 'error')));
  els.sync.addEventListener('click', syncPennylane);
  els.exportPdf.addEventListener('click', () => exportForecast('pdf').catch((error) => showFeedback(error.message, 'error')));
  els.exportCsv.addEventListener('click', () => exportForecast('csv').catch((error) => showFeedback(error.message, 'error')));
  els.simulateDistrimer.addEventListener('click', () => simulateDistrimer().catch((error) => showFeedback(error.message, 'error')));
  els.runDiagnostic.addEventListener('click', async () => {
    const data = await requestJson('/api/cashflow/diagnostic', { method: 'POST', body: JSON.stringify({}) });
    renderDiagnostic(data);
    showFeedback('Diagnostic Pennylane execute.', 'success');
  });
  els.manualForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await requestJson('/api/cashflow/manual-items', {
      method: 'POST',
      body: JSON.stringify({
        label: document.getElementById('manual-label').value,
        direction: document.getElementById('manual-direction').value,
        amount: Number(document.getElementById('manual-amount').value),
        forecast_date: document.getElementById('manual-date').value,
        recurrence: document.getElementById('manual-recurrence').value,
        category: document.getElementById('manual-category').value,
      }),
    });
    els.manualForm.reset();
    await loadAll();
  });
  els.manualTable.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-delete-manual]');
    if (!button) return;
    await fetch(`${API_BASE_URL}/api/cashflow/manual-items/${encodeURIComponent(button.dataset.deleteManual)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    await loadAll();
  });
  els.settingsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await requestJson('/api/cashflow/settings', {
      method: 'PUT',
      body: JSON.stringify({
        opening_balance: Number(els.settingOpeningBalance.value || 0),
        main_bank_account_label: els.settingBankLabel.value,
        distrimer_limit: Number(els.settingDistrimerLimit.value || 10000),
        distrimer_target_after_payment: Number(els.settingDistrimerTarget.value || 7500),
        default_customer_delay_days: Number(els.settingDefaultDelay.value || 30),
      }),
    });
    await loadAll();
    showFeedback('Parametres enregistres.', 'success');
  });
}

bindEvents();
loadAll().catch((error) => showFeedback(error.message || 'Erreur initialisation tresorerie', 'error'));
