const API_URL = `${window.APP_CONFIG.API_BASE_URL}/api`;

const token = localStorage.getItem('grv2_token');
const sessionUser = JSON.parse(localStorage.getItem('grv2_user') || 'null');
const activeDepartment = JSON.parse(localStorage.getItem('grv2_active_department') || 'null');

if (!token || !sessionUser) {
  window.location.href = './login.html';
}

if (!['admin', 'responsable'].includes(sessionUser?.role)) {
  alert('Accès réservé aux responsables et administrateurs.');
  window.location.href = './home.html';
}

if (!activeDepartment?.id) {
  alert('Aucun rayon actif.');
  window.location.href = './compta-home.html';
}

const departmentNameEl = document.getElementById('department-name');
const startDateInput = document.getElementById('start-date');
const endDateInput = document.getElementById('end-date');
const anomalyTypeSelect = document.getElementById('anomaly-type');
const loadBtn = document.getElementById('load-btn');
const anomaliesBody = document.getElementById('anomalies-body');
const anomalyCountEl = document.getElementById('anomaly-count');
const feedbackEl = document.getElementById('feedback');
const backBtn = document.getElementById('back-btn');
const logoutBtn = document.getElementById('logout-btn');

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartString() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('fr-FR');
}

function formatQty(value) {
  return Number(value || 0).toLocaleString('fr-FR', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function anomalyLabel(type) {
  const labels = {
    stock_alert: 'Stock nul',
    missing_sale_price: 'PV manquant',
    inventory_anomaly: 'Inventaire',
  };

  return labels[type] || type || '';
}

function anomalyBadgeClass(type) {
  const classes = {
    stock_alert: 'stock_alert',
    missing_sale_price: 'missing_sale_price',
    inventory_anomaly: 'inventory_anomaly',
  };

  return `anomaly-badge ${classes[type] || ''}`.trim();
}

function showFeedback(message, isError = false) {
  if (!feedbackEl) return;
  feedbackEl.textContent = message || '';
  feedbackEl.classList.toggle('error', !!isError);
}

async function loadAnomalies() {
  if (!startDateInput.value || !endDateInput.value) {
    showFeedback('Renseigne une période.', true);
    return;
  }

  const params = new URLSearchParams({
    department_id: activeDepartment.id,
    start_date: startDateInput.value,
    end_date: endDateInput.value,
  });

  if (anomalyTypeSelect.value) {
    params.append('anomaly_type', anomalyTypeSelect.value);
  }

  showFeedback('Chargement...');

  const res = await fetch(`${API_URL}/compta/inventory-anomalies?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    showFeedback(data.error || 'Erreur chargement anomalies inventaire', true);
    renderAnomalies([]);
    return;
  }

  renderAnomalies(data.anomalies || []);
  showFeedback('');
}

function renderAnomalies(rows) {
  if (anomalyCountEl) {
    anomalyCountEl.textContent = String(rows.length);
  }

  if (!rows.length) {
    anomaliesBody.innerHTML = `
      <tr>
        <td colspan="12">Aucune anomalie trouvée.</td>
      </tr>
    `;
    return;
  }

  anomaliesBody.innerHTML = rows.map((row) => `
    <tr>
      <td>${formatDate(row.inventory_date)}</td>
      <td><span class="${anomalyBadgeClass(row.anomaly_type)}">${escapeHtml(anomalyLabel(row.anomaly_type))}</span></td>
      <td>${escapeHtml(row.article_plu)}</td>
      <td>${escapeHtml(row.article_label)}</td>
      <td>${escapeHtml(row.ean)}</td>
      <td>${formatQty(row.stock_quantity)}</td>
      <td>${formatQty(row.sold_quantity)}</td>
      <td>${escapeHtml(row.sale_unit)}</td>
      <td>${formatMoney(row.line_total_ttc)}</td>
      <td>${escapeHtml(row.reason)}</td>
      <td>${escapeHtml(row.sales_document_reference)}</td>
      <td>${escapeHtml(row.user_email)}</td>
    </tr>
  `).join('');
}

if (departmentNameEl) {
  departmentNameEl.textContent = activeDepartment?.name
    ? `Anomalies inventaire - ${activeDepartment.name}`
    : 'Anomalies inventaire';
}

if (loadBtn) {
  loadBtn.addEventListener('click', loadAnomalies);
}

if (backBtn) {
  backBtn.addEventListener('click', () => {
    window.location.href = './compta-home.html';
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('grv2_token');
    localStorage.removeItem('grv2_user');
    localStorage.removeItem('grv2_active_department');
    window.location.href = './login.html';
  });
}

startDateInput.value = monthStartString();
endDateInput.value = todayString();

await loadAnomalies();
