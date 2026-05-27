const API_URL = `${window.APP_CONFIG.API_BASE_URL}/api`;

const token = localStorage.getItem('grv2_token');

const activeDepartment = JSON.parse(
  localStorage.getItem('grv2_active_department')
);

const dateInput = document.getElementById('closure-date');

const caRealInput = document.getElementById('ca-real-ht');
const caN1Input = document.getElementById('ca-n1-ht');
const stockEndInput = document.getElementById('stock-end-ht');
const notesInput = document.getElementById('notes');

const realResults = document.getElementById('real-results');
const theoreticalResults = document.getElementById('theoretical-results');
const deltaResults = document.getElementById('delta-results');

const articleAnalysisBody = document.getElementById('article-analysis-body');
const anomaliesOnlyInput = document.getElementById('anomalies-only');

const backComptaHomeBtn = document.getElementById('back-compta-home-btn');
const logoutBtn = document.getElementById('logout-btn');

function formatMoney(v) {
  return Number(v || 0).toFixed(2) + ' €';
}

function formatQty(v) {
  return Number(v || 0).toFixed(3);
}

function formatPct(v) {
  return Number(v || 0).toFixed(2) + ' %';
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function anomalyBadge(line) {
  if (!line.anomaly_note) return '<span class="badge-ok">OK</span>';
  return `<span class="badge-warning">${line.anomaly_note}</span>`;
}

dateInput.value = todayString();

async function loadDay() {
  const date = dateInput.value;

  const res = await fetch(
    `${API_URL}/compta/daily/${date}?department_id=${activeDepartment.id}`,
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );

  const data = await res.json();

  const closure = data.closure || {};
  const computed = data.computed || {};

  caRealInput.value = closure.ca_real_ht || '';
  caN1Input.value = closure.ca_n1_ht || '';
  stockEndInput.value = closure.stock_end_value_ht || '';
  notesInput.value = closure.notes || '';

  renderComputed(computed);
  await loadArticleAnalysis();
}

function renderComputed(c) {
  realResults.innerHTML = `
    <p>Stock début HT : ${formatMoney(c.stock_start_value_ht)}</p>
    <p>Achats HT : ${formatMoney(c.purchases_ht)}</p>
    <p>Coût consommé réel : ${formatMoney(c.real_consumed_cost_ht)}</p>
    <p>Marge réelle : ${formatMoney(c.real_margin_ht)}</p>
    <p>Marge réelle % : ${(c.real_margin_pct || 0).toFixed(2)}%</p>
  `;

  theoreticalResults.innerHTML = `
    <p>CA théorique : ${formatMoney(c.theoretical_ca_ht)}</p>
    <p>Coût théorique : ${formatMoney(c.theoretical_cost_ht)}</p>
    <p>Marge théorique : ${formatMoney(c.theoretical_margin_ht)}</p>
    <p>Marge théorique % : ${(c.theoretical_margin_pct || 0).toFixed(2)}%</p>
  `;

  deltaResults.innerHTML = `
    <p>Écart CA réel / théorique : ${formatMoney(c.delta_ca_real_vs_theoretical)}</p>
    <p>Écart marge réel / théorique : ${formatMoney(c.delta_margin_real_vs_theoretical)}</p>
    <p>Écart CA vs N-1 : ${formatMoney(c.delta_ca_vs_n1)}</p>
    <p>Écart CA vs N-1 % : ${(c.delta_ca_vs_n1_pct || 0).toFixed(2)}%</p>
  `;
}

async function loadArticleAnalysis() {
  if (!articleAnalysisBody) return;

  const date = dateInput.value;
  const anomaliesOnly = anomaliesOnlyInput?.checked ? 'true' : 'false';

  const res = await fetch(
    `${API_URL}/compta/daily/${date}/article-lines?department_id=${activeDepartment.id}&anomalies_only=${anomaliesOnly}`,
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );

  const data = await res.json();

  if (!res.ok) {
    console.error(data);
    articleAnalysisBody.innerHTML = `
      <tr>
        <td colspan="10">Erreur chargement analyse articles.</td>
      </tr>
    `;
    return;
  }

  const lines = data.lines || [];

  if (!lines.length) {
    articleAnalysisBody.innerHTML = `
      <tr>
        <td colspan="10">Aucune ligne théorique trouvée.</td>
      </tr>
    `;
    return;
  }

  articleAnalysisBody.innerHTML = lines.map((line) => `
    <tr>
      <td>${line.article_plu || ''}</td>
      <td>${line.article_label || ''}</td>
      <td>${formatQty(line.qty_sold_theoretical)}</td>
      <td>${line.sale_unit || ''}</td>
      <td>${formatMoney(line.unit_sale_price_ht)}</td>
      <td>${formatMoney(line.unit_cost_ht)}</td>
      <td>${formatMoney(line.theoretical_ca_ht)}</td>
      <td>${formatMoney(line.theoretical_margin_ht)}</td>
      <td>${formatPct(line.theoretical_margin_pct)}</td>
      <td>${anomalyBadge(line)}</td>
    </tr>
  `).join('');
}

async function saveInputs() {
  const body = {
    department_id: activeDepartment.id,
    closure_date: dateInput.value,
    ca_real_ht: caRealInput.value,
    ca_n1_ht: caN1Input.value,
    stock_end_value_ht: stockEndInput.value,
    notes: notesInput.value
  };

  const res = await fetch(
    `${API_URL}/compta/daily/save-inputs`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(body)
    }
  );

  const data = await res.json();

  alert('Saisie enregistrée');
  await loadDay();
}

async function computeDay() {
  const res = await fetch(
    `${API_URL}/compta/daily/compute`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        department_id: activeDepartment.id,
        closure_date: dateInput.value
      })
    }
  );

  const data = await res.json();

  alert('Calcul effectué');
  await loadDay();
}

async function validateDay() {
  if (!confirm('Valider cette journée ?')) {
    return;
  }

  const res = await fetch(
    `${API_URL}/compta/daily/validate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        department_id: activeDepartment.id,
        closure_date: dateInput.value
      })
    }
  );

  const data = await res.json();

  alert('Journée validée');
  await loadDay();
}

document
  .getElementById('save-btn')
  .addEventListener('click', saveInputs);

document
  .getElementById('compute-btn')
  .addEventListener('click', computeDay);

document
  .getElementById('validate-btn')
  .addEventListener('click', validateDay);

dateInput.addEventListener('change', loadDay);

if (anomaliesOnlyInput) {
  anomaliesOnlyInput.addEventListener('change', loadArticleAnalysis);
}

if (backComptaHomeBtn) {
  backComptaHomeBtn.addEventListener('click', () => {
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

loadDay();