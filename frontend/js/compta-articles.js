const API_URL = `${window.APP_CONFIG.API_BASE_URL}/api`;

const token = localStorage.getItem('grv2_token');

const activeDepartment = JSON.parse(
  localStorage.getItem('grv2_active_department')
);

const startDateInput = document.getElementById('start-date');
const endDateInput = document.getElementById('end-date');
const articleFilter = document.getElementById('article-filter');

const loadBtn = document.getElementById('load-btn');
const printBtn = document.getElementById('print-btn');

const kpiCa = document.getElementById('kpi-ca');
const kpiCost = document.getElementById('kpi-cost');
const kpiMargin = document.getElementById('kpi-margin');
const kpiMarginPct = document.getElementById('kpi-margin-pct');
const kpiVolume = document.getElementById('kpi-volume');
const kpiCount = document.getElementById('kpi-count');

const articlesBody = document.getElementById('articles-body');

const backBtn = document.getElementById('back-btn');
const logoutBtn = document.getElementById('logout-btn');

function formatMoney(v) {
  return Number(v || 0).toLocaleString('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }) + ' €';
}

function formatQty(v) {
  return Number(v || 0).toLocaleString('fr-FR', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3
  });
}

function formatPct(v) {
  return Number(v || 0).toLocaleString('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }) + ' %';
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartString() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function anomalyText(row) {
  const notes = [];

  if (row.pricing_issue) notes.push('PV absent');
  if (row.cost_issue) notes.push('Coût absent');
  if (row.negative_margin) notes.push('Marge négative');

  return notes.length ? notes.join(' / ') : 'OK';
}

function anomalyClass(row) {
  return row.pricing_issue || row.cost_issue || row.negative_margin
    ? 'badge-warning'
    : 'badge-ok';
}

async function loadArticlesFilter() {
  const params = new URLSearchParams({
    department_id: activeDepartment.id,
    start_date: startDateInput.value,
    end_date: endDateInput.value
  });

  const res = await fetch(`${API_URL}/compta/article-stats?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await res.json();

  if (!res.ok) {
    console.error(data);
    return;
  }

  const currentValue = articleFilter.value;

  articleFilter.innerHTML = '<option value="">Tous</option>';

  (data.articles || []).forEach((article) => {
    const option = document.createElement('option');
    option.value = article.id || '';
    option.textContent = `${article.article_plu || ''} - ${article.article_label || ''}`;
    articleFilter.appendChild(option);
  });

  if (currentValue && articleFilter.querySelector(`option[value="${currentValue}"]`)) {
    articleFilter.value = currentValue;
  }
}

async function loadArticleStats() {
  const params = new URLSearchParams({
    department_id: activeDepartment.id,
    start_date: startDateInput.value,
    end_date: endDateInput.value
  });

  if (articleFilter.value) {
    params.append('article_id', articleFilter.value);
  }

  const res = await fetch(`${API_URL}/compta/article-stats?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await res.json();

  if (!res.ok) {
    console.error(data);
    alert(data.error || 'Erreur chargement stats articles');
    return;
  }

  renderSummary(data.summary || {});
  renderArticles(data.articles || []);
}

function renderSummary(summary) {
  const ca = Number(summary.ca_ht || 0);
  const margin = Number(summary.margin_ht || 0);
  const marginPct = ca > 0 ? (margin / ca) * 100 : 0;

  kpiCa.textContent = formatMoney(summary.ca_ht);
  kpiCost.textContent = formatMoney(summary.cost_ht);
  kpiMargin.textContent = formatMoney(summary.margin_ht);
  kpiMarginPct.textContent = formatPct(marginPct);
  kpiVolume.textContent = formatQty(summary.total_qty);
  kpiCount.textContent = summary.articles_count || 0;
}

function renderArticles(rows) {
  if (!rows.length) {
    articlesBody.innerHTML = `
      <tr>
        <td colspan="9">Aucun article trouvé.</td>
      </tr>
    `;
    return;
  }

  articlesBody.innerHTML = rows.map((row) => `
    <tr>
      <td>${row.article_plu || ''}</td>
      <td>${row.article_label || ''}</td>
      <td>${formatQty(row.qty_sold)}</td>
      <td>${row.sale_unit || ''}</td>
      <td>${formatMoney(row.ca_ht)}</td>
      <td>${formatMoney(row.cost_ht)}</td>
      <td>${formatMoney(row.margin_ht)}</td>
      <td>${formatPct(row.margin_pct)}</td>
      <td><span class="${anomalyClass(row)}">${anomalyText(row)}</span></td>
    </tr>
  `).join('');
}

function printReport() {
  const printWindow = window.open('', '_blank', 'width=1400,height=900');

  if (!printWindow) {
    alert("Impossible d'ouvrir la fenêtre d'impression.");
    return;
  }

  const selectedArticleText =
    articleFilter.options[articleFilter.selectedIndex]?.text || 'Tous';

  const periodText = `Du ${startDateInput.value} au ${endDateInput.value}`;

  const rowsHtml = Array.from(articlesBody.querySelectorAll('tr')).map((row) => {
    const cells = Array.from(row.querySelectorAll('td')).map((cell) => cell.outerHTML).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Statistiques articles</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; color: #111827; }
        h1 { margin-bottom: 6px; }
        .header { margin-bottom: 20px; color: #374151; }
        .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }
        .kpi { background: #f8fafc; border: 1px solid #e5e7eb; padding: 10px; border-radius: 8px; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 12px; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background: #f8fafc; font-weight: bold; }
        td:nth-child(n+3) { text-align: right; }
        td:nth-child(9) { text-align: left; }
        .badge-ok { color: #166534; font-weight: 700; }
        .badge-warning { color: #b45309; font-weight: 700; }
        @media print { body { margin: 0; } }
      </style>
    </head>
    <body>
      <h1>Statistiques articles</h1>

      <div class="header">
        <p><strong>Période :</strong> ${periodText}</p>
        <p><strong>Article :</strong> ${selectedArticleText}</p>
      </div>

      <div class="kpis">
        <div class="kpi"><strong>CA HT :</strong> ${kpiCa.textContent}</div>
        <div class="kpi"><strong>Coût HT :</strong> ${kpiCost.textContent}</div>
        <div class="kpi"><strong>Marge HT :</strong> ${kpiMargin.textContent}</div>
        <div class="kpi"><strong>% marge :</strong> ${kpiMarginPct.textContent}</div>
        <div class="kpi"><strong>Volume vendu :</strong> ${kpiVolume.textContent}</div>
        <div class="kpi"><strong>Nb articles :</strong> ${kpiCount.textContent}</div>
      </div>

      <table>
        <thead>
          <tr>
            <th>PLU</th>
            <th>Article</th>
            <th>Volume</th>
            <th>Unité</th>
            <th>CA HT</th>
            <th>Coût HT</th>
            <th>Marge HT</th>
            <th>% marge</th>
            <th>Anomalie</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </body>
    </html>
  `);

  printWindow.document.close();

  setTimeout(() => {
    printWindow.print();
  }, 500);
}

if (loadBtn) {
  loadBtn.addEventListener('click', async () => {
    await loadArticlesFilter();
    await loadArticleStats();
  });
}

if (printBtn) {
  printBtn.addEventListener('click', printReport);
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

await loadArticlesFilter();
await loadArticleStats();