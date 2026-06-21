const API_BASE_URL = window.APP_CONFIG.API_BASE_URL;
const token = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
const sessionUser = JSON.parse(localStorage.getItem('gc_user') || localStorage.getItem('grv2_user') || 'null');

if (!token || !sessionUser) window.location.href = './login.html';

const els = {
  user: document.getElementById('user-name'),
  home: document.getElementById('home-btn'),
  logout: document.getElementById('logout-btn'),
  feedback: document.getElementById('royale-feedback'),
  from: document.getElementById('from-date'),
  to: document.getElementById('to-date'),
  deliveredClient: document.getElementById('delivered-client-select'),
  commissionRate: document.getElementById('commission-rate'),
  apply: document.getElementById('apply-btn'),
  refresh: document.getElementById('refresh-btn'),
  prepare: document.getElementById('prepare-credit-note-btn'),
  subtitle: document.getElementById('settlement-subtitle'),
  body: document.getElementById('settlement-body'),
  totals: {
    weight: document.getElementById('total-weight'),
    ht: document.getElementById('total-ht'),
    ttc: document.getElementById('total-ttc'),
    credit: document.getElementById('total-credit'),
  },
};

let lastSettlement = null;

function authHeaders(json = false) {
  const headers = { Authorization: `Bearer ${token}` };
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[char]));
}

function showFeedback(message = '', type = 'success') {
  els.feedback.textContent = message;
  els.feedback.className = message ? `page-feedback ${type}` : 'page-feedback hidden';
}

function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  return number.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}

function kg(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  return `${number.toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg`;
}

function numberText(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  return number.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function setDefaultWeek() {
  const now = new Date();
  const day = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() + 1 - day);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  els.from.value = isoDate(monday);
  els.to.value = isoDate(sunday);
}

async function apiGet(path) {
  const response = await fetch(`${API_BASE_URL}${path}`, { headers: authHeaders(false) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erreur API');
  return data;
}

async function apiPost(path, payload) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: authHeaders(true),
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erreur API');
  return data;
}

async function loadClients() {
  try {
    const clients = await apiGet('/api/clients');
    const rows = Array.isArray(clients) ? clients : clients.clients || [];
    els.deliveredClient.innerHTML = '<option value="">Tous magasins</option>' + rows
      .filter((client) => String(client.status || 'active') !== 'inactive')
      .map((client) => `<option value="${escapeHtml(client.id)}">${escapeHtml(client.name || client.code || client.id)}</option>`)
      .join('');
  } catch (error) {
    showFeedback(`Filtre magasins indisponible : ${error.message}`, 'warning');
  }
}

function settlementQuery() {
  const params = new URLSearchParams({
    from: els.from.value,
    to: els.to.value,
    commission_rate: els.commissionRate.value || '0.30',
  });
  if (els.deliveredClient.value) params.set('delivered_client_id', els.deliveredClient.value);
  return params.toString();
}

function setTotals(totals = {}) {
  els.totals.weight.textContent = kg(totals.total_weight_kg);
  els.totals.ht.textContent = money(totals.total_ht);
  els.totals.ttc.textContent = money(totals.total_ttc);
  els.totals.credit.textContent = money(totals.credit_amount_ht);
}

function renderRows(rows = []) {
  if (!rows.length) {
    els.body.innerHTML = '<tr><td colspan="9">Aucun BL ou facture Royale Maree trouve sur la periode.</td></tr>';
    return;
  }
  els.body.innerHTML = rows.map((row) => `<tr>
    <td>${escapeHtml(row.delivered_client_name || row.delivered_client_code || 'Magasin non renseigne')}</td>
    <td>${kg(row.total_weight_kg)}</td>
    <td>${money(row.total_ht)}</td>
    <td>${money(row.total_vat)}</td>
    <td>${money(row.total_ttc)}</td>
    <td>${Number(row.delivery_note_count || 0)}</td>
    <td>${Number(row.invoice_count || 0)}</td>
    <td>${numberText(row.commission_rate_per_kg, 2)}</td>
    <td>${money(row.credit_amount_ht)}</td>
  </tr>`).join('');
}

async function loadSettlement() {
  showFeedback('');
  els.prepare.disabled = true;
  const data = await apiGet(`/api/royale-maree-settlement?${settlementQuery()}`);
  lastSettlement = data;
  if (!data.royale_client) {
    setTotals({});
    renderRows([]);
    els.subtitle.textContent = data.message || 'Client ROYALE MAREE introuvable.';
    showFeedback(els.subtitle.textContent, 'warning');
    return;
  }
  setTotals(data.totals || {});
  renderRows(data.rows || []);
  els.subtitle.textContent = data.rows?.length
    ? `${data.from} au ${data.to} - client facture : ${data.royale_client.name}`
    : (data.message || 'Aucune donnee Royale Maree sur la periode.');
  els.prepare.disabled = !data.rows?.length || Number(data.totals?.credit_amount_ht || 0) <= 0;
}

async function prepareCreditNote() {
  if (!lastSettlement?.rows?.length) return;
  const total = money(lastSettlement.totals?.credit_amount_ht || 0);
  if (!confirm(`Preparer un avoir Royale Maree de ${total} ?`)) return;
  els.prepare.disabled = true;
  try {
    const data = await apiPost('/api/royale-maree-settlement/credit-note', {
      from: els.from.value,
      to: els.to.value,
      delivered_client_id: els.deliveredClient.value || null,
      commission_rate: Number(els.commissionRate.value || 0.30),
    });
    showFeedback(`Avoir prepare : ${data.credit_note_reference} (${money(data.amount_ht)} HT)`);
  } catch (error) {
    showFeedback(error.message || 'Erreur preparation avoir Royale Maree', 'error');
  } finally {
    els.prepare.disabled = false;
  }
}

function logout() {
  ['gc_token', 'gc_user', 'gc_active_department', 'grv2_token', 'grv2_user', 'grv2_active_department'].forEach((key) => localStorage.removeItem(key));
  window.location.href = './login.html';
}

els.user.textContent = sessionUser.email || 'Utilisateur';
els.home.addEventListener('click', () => { window.location.href = './home.html'; });
els.logout.addEventListener('click', logout);
els.apply.addEventListener('click', () => loadSettlement().catch((error) => showFeedback(error.message, 'error')));
els.refresh.addEventListener('click', () => loadSettlement().catch((error) => showFeedback(error.message, 'error')));
els.prepare.addEventListener('click', () => prepareCreditNote());
els.commissionRate.addEventListener('change', () => loadSettlement().catch((error) => showFeedback(error.message, 'error')));

setDefaultWeek();
loadClients().finally(() => loadSettlement().catch((error) => showFeedback(error.message, 'error')));
