const API_URL = `${window.APP_CONFIG.API_BASE_URL}/api`;

const token = localStorage.getItem('grv2_token');

const activeDepartment = JSON.parse(
  localStorage.getItem('grv2_active_department')
);

const startDateInput = document.getElementById('start-date');
const endDateInput = document.getElementById('end-date');
const supplierFilter = document.getElementById('supplier-filter');

const loadBtn = document.getElementById('load-btn');
const printBtn = document.getElementById('print-btn');

const kpiPurchases = document.getElementById('kpi-purchases');
const kpiVolume = document.getElementById('kpi-volume');

const suppliersBody = document.getElementById('suppliers-body');

const backBtn = document.getElementById('back-btn');
const logoutBtn = document.getElementById('logout-btn');

function formatMoney(v) {
  return Number(v || 0).toLocaleString(
    'fr-FR',
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }
  ) + ' €';
}

function formatQty(v) {
  return Number(v || 0).toLocaleString(
    'fr-FR',
    {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3
    }
  );
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartString() {
  const d = new Date();

  return new Date(
    d.getFullYear(),
    d.getMonth(),
    1
  ).toISOString().slice(0, 10);
}

async function loadSuppliers() {
  try {
    const res = await fetch(
      `${API_URL}/suppliers?store_id=${activeDepartment.store_id}`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    const data = await res.json();

    if (!res.ok) {
      console.error('Erreur chargement fournisseurs:', data.error);
      return;
    }

    const currentValue = supplierFilter.value;

    supplierFilter.innerHTML = '<option value="">Tous</option>';

    data.forEach(supplier => {
      const option = document.createElement('option');
      option.value = supplier.id;
      option.textContent = `${supplier.code} - ${supplier.name}`;
      supplierFilter.appendChild(option);
    });

    // Restaurer la sélection précédente si elle existe
    if (currentValue && supplierFilter.querySelector(`option[value="${currentValue}"]`)) {
      supplierFilter.value = currentValue;
    }

  } catch (err) {
    console.error('Erreur chargement fournisseurs:', err);
  }
}

async function loadSupplierStats() {

  const params = new URLSearchParams({
    department_id: activeDepartment.id,
    start_date: startDateInput.value,
    end_date: endDateInput.value
  });

  if (supplierFilter.value) {
    params.append('supplier_id', supplierFilter.value);
  }

  const res = await fetch(
    `${API_URL}/compta/supplier-stats?${params}`,
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );

  const data = await res.json();

  if (!res.ok) {
    alert(data.error || 'Erreur chargement stats');
    return;
  }

  renderSummary(data.summary || {});
  renderSuppliers(data.suppliers || []);
}

function renderSummary(summary) {

  kpiPurchases.textContent =
    formatMoney(summary.purchases_ht);

  kpiVolume.textContent =
    formatQty(summary.total_volume);
}

function renderSuppliers(rows) {

  if (!rows.length) {

    suppliersBody.innerHTML = `
      <tr>
        <td colspan="10">
          Aucun fournisseur trouvé.
        </td>
      </tr>
    `;

    return;
  }

  suppliersBody.innerHTML = rows.map((row) => `
  <tr>
    <td>${row.code || ''}</td>
    <td>${row.name || ''}</td>
    <td>${formatMoney(row.purchases_ht)}</td>
    <td>${formatMoney(row.ca_ht)}</td>
    <td>${formatMoney(row.cost_ht)}</td>
    <td>${formatMoney(row.margin_ht)}</td>
    <td>${Number(row.margin_pct || 0).toFixed(2)} %</td>
    <td>${formatQty(row.total_volume)}</td>
    <td>${row.purchases_count || 0}</td>
    <td>${row.articles_count || 0}</td>
  </tr>
`).join('');
}

function printReport() {
  const printWindow = window.open('', '_blank', 'width=1400,height=900');

  const selectedSupplierText = supplierFilter.options[supplierFilter.selectedIndex]?.text || 'Tous';
  const periodText = `Du ${startDateInput.value} au ${endDateInput.value}`;

  const suppliersHtml = Array.from(suppliersBody.querySelectorAll('tr')).map(row => {
    const cells = Array.from(row.querySelectorAll('td')).map(cell => cell.outerHTML).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Statistiques fournisseurs</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        .header { margin-bottom: 20px; }
        .kpis { display: flex; gap: 20px; margin-bottom: 20px; }
        .kpi { background: #f8f9fa; padding: 10px; border-radius: 8px; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background: #f8fafc; font-weight: bold; }
        td:nth-child(n+3) { text-align: right; }
        @media print { body { margin: 0; } }
      </style>
    </head>
    <body>
      <h1>Statistiques fournisseurs</h1>
      <div class="header">
        <p><strong>Période :</strong> ${periodText}</p>
        <p><strong>Fournisseur :</strong> ${selectedSupplierText}</p>
      </div>
      <div class="kpis">
        <div class="kpi">
          <strong>Achats HT :</strong> ${kpiPurchases.textContent}
        </div>
        <div class="kpi">
          <strong>Volume acheté :</strong> ${kpiVolume.textContent}
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Code</th>
            <th>Fournisseur</th>
            <th>Achats HT</th>
            <th>CA HT</th>
            <th>Coût HT</th>
            <th>Marge HT</th>
            <th>% marge</th>
            <th>Volume</th>
            <th>Nb achats</th>
            <th>Nb articles</th>
          </tr>
        </thead>
        <tbody>
          ${suppliersHtml}
        </tbody>
      </table>
    </body>
    </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();

  setTimeout(() => {
    printWindow.print();
  }, 500);
}

loadBtn.addEventListener(
  'click',
  loadSupplierStats
);

printBtn.addEventListener(
  'click',
  printReport
);

if (backBtn) {
  backBtn.addEventListener('click', () => {
    window.location.href =
      './compta-home.html';
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

loadSuppliers();

loadSupplierStats();