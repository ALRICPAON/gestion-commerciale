const API_BASE_URL = window.APP_CONFIG.API_BASE_URL;

const token = localStorage.getItem('grv2_token');
const user = JSON.parse(localStorage.getItem('grv2_user'));
let activeDepartment = JSON.parse(localStorage.getItem('grv2_active_department'));

if (!token || !user || !activeDepartment) {
  window.location.href = './login.html';
}

const params = new URLSearchParams(window.location.search);
const articleId = params.get('id');
const urlDepartmentId = params.get('department_id');
const detailDepartmentId = urlDepartmentId || activeDepartment.id;

const identityEl = document.getElementById('identity');
const metaEl = document.getElementById('meta');
const unitsEl = document.getElementById('units');
const historyBody = document.getElementById('history-body');

const userNameEl = document.getElementById('user-name');
const departmentSelect = document.getElementById('department-select');
const backBtn = document.getElementById('back-btn');
const editBtn = document.getElementById('edit-btn');
const saveBtn = document.getElementById('save-btn');

const stockSummaryEl = document.getElementById('stock-summary');
const lotsBody = document.getElementById('lots-body');
const movementsBody = document.getElementById('movements-body');
const salesHistoryBody = document.getElementById('sales-history-body');

let editMode = false;
let currentArticle = null;

function formatVatRate(value) {
  const rate = Number(value ?? 5.5);
  return `${Number.isInteger(rate) ? rate : rate.toFixed(1)}%`;
}

function vatSelectValue(value) {
  const rate = Number(value ?? 5.5);
  if (rate === 2.1) return '2.10';
  if (rate === 5.5) return '5.50';
  return String(rate);
}

function authHeaders() {
  return {
    Authorization: `Bearer ${token}`
  };
}

function fillTopbar() {
  userNameEl.textContent = user.email;

  departmentSelect.innerHTML = '';

  user.departments.forEach(dep => {
    const option = document.createElement('option');
    option.value = dep.id;
    option.textContent = dep.name;

    if (dep.id === activeDepartment.id) {
      option.selected = true;
    }

    departmentSelect.appendChild(option);
  });
}

async function loadArticle() {
  const res = await fetch(
  `${API_BASE_URL}/api/articles/${articleId}?department_id=${detailDepartmentId}`,
  {
    headers: authHeaders()
  }
);

  const data = await res.json();

  const article = data.article;
  currentArticle = article;

  // 🔹 IDENTITÉ
  identityEl.innerHTML = `
  <p><strong>PLU</strong><br>
    <input ${!editMode ? 'disabled' : ''} id="edit-plu" value="${article.plu || ''}">
  </p>

  <p><strong>Désignation</strong><br>
    <input ${!editMode ? 'disabled' : ''} id="edit-designation" value="${article.designation || ''}">
  </p>

  <p><strong>EAN</strong><br>
    <input ${!editMode ? 'disabled' : ''} id="edit-ean" value="${article.ean || ''}">
  </p>

  <p><strong>Unité</strong><br>
    <input ${!editMode ? 'disabled' : ''} id="edit-unit" value="${article.unit || ''}">
  </p>

  <p><strong>TVA</strong><br>
    <select ${!editMode ? 'disabled' : ''} id="edit-vat-rate">
      <option value="5.50" ${vatSelectValue(article.vat_rate) === '5.50' ? 'selected' : ''}>5.5%</option>
      <option value="10" ${vatSelectValue(article.vat_rate) === '10' ? 'selected' : ''}>10%</option>
      <option value="20" ${vatSelectValue(article.vat_rate) === '20' ? 'selected' : ''}>20%</option>
      <option value="2.10" ${vatSelectValue(article.vat_rate) === '2.10' ? 'selected' : ''}>2.1%</option>
      <option value="0" ${vatSelectValue(article.vat_rate) === '0' ? 'selected' : ''}>0%</option>
    </select>
  </p>
`;

  // 🔹 MÉTIER
  metaEl.innerHTML = `
    <p><strong>Rayon :</strong> ${article.department_name || '-'}</p>
    <p><strong>Secteur :</strong> ${article.sector_name || '-'}</p>
    <p><strong>TVA :</strong> ${formatVatRate(article.vat_rate)}</p>
    <p><strong>Catégorie :</strong> ${article.category || '-'}</p>
    <p><strong>Nom latin :</strong> ${article.latin_name || '-'}</p>
    <p><strong>FAO :</strong> ${article.fao_zone || '-'}</p>
    <p><strong>Sous-zone :</strong> ${article.sous_zone || '-'}</p>
    <p><strong>Engin :</strong> ${article.engin || '-'}</p>
    <p><strong>Allergènes :</strong> ${article.allergenes || '-'}</p>
  `;

  // 🔹 UNITÉS
  unitsEl.innerHTML = `
    <p><strong>Achat :</strong> ${article.purchase_unit || '-'}</p>
    <p><strong>Stock :</strong> ${article.stock_unit || '-'}</p>
    <p><strong>Vente :</strong> ${article.sale_unit || '-'}</p>
  `;

  // 🔹 STOCK
const stock = data.stock || {};

stockSummaryEl.innerHTML = `
  <p><strong>Stock :</strong> ${stock.stock_quantity ?? 0}</p>
  <p><strong>Valeur stock HT :</strong> ${stock.stock_value_ex_vat ?? 0}</p>
  <p><strong>PMA :</strong> ${stock.pma ?? 0}</p>
  <p><strong>PV TTC réel :</strong> ${stock.pv_ttc_real ?? 0}</p>
  <p><strong>Prochaine DLC :</strong> ${stock.next_dlc || '-'}</p>
`;

// 🔹 LOTS
lotsBody.innerHTML = '';

(data.lots || []).forEach(lot => {
  const tr = document.createElement('tr');

  tr.innerHTML = `
    <td>${lot.lot_code || '-'}</td>
    <td>${lot.qty_remaining ?? 0}</td>
    <td>${lot.unit_cost_ex_vat ?? 0}</td>
    <td>${lot.dlc || '-'}</td>
    <td>${lot.supplier_name || '-'}</td>
    <td>${lot.source_type || '-'}</td>
  `;

  lotsBody.appendChild(tr);
});

// 🔹 MOUVEMENTS
movementsBody.innerHTML = '';

(data.movements || []).forEach(movement => {
  const tr = document.createElement('tr');

  tr.innerHTML = `
    <td>${movement.created_at || '-'}</td>
    <td>${movement.movement_type || '-'}</td>
    <td>${movement.quantity ?? 0}</td>
    <td>${movement.unit_cost_ex_vat ?? 0}</td>
    <td>${movement.lot_code || '-'}</td>
    <td>${movement.notes || '-'}</td>
  `;

  movementsBody.appendChild(tr);
});

// 🔹 HISTORIQUE VENTES
salesHistoryBody.innerHTML = '';

(data.history?.sales || []).forEach(sale => {
  const tr = document.createElement('tr');

  tr.innerHTML = `
    <td>${sale.document_date || '-'}</td>
    <td>${sale.document_type || '-'}</td>
    <td>${sale.reference_number || '-'}</td>
    <td>${sale.sold_quantity ?? 0}</td>
    <td>${sale.sale_unit || '-'}</td>
    <td>${sale.unit_sale_price_ttc ?? 0}</td>
    <td>${sale.line_reason || '-'}</td>
    <td>${sale.status || '-'}</td>
  `;

  salesHistoryBody.appendChild(tr);
});

  // 🔹 HISTORIQUE
  historyBody.innerHTML = '';

  data.history.purchases.forEach(p => {
    const tr = document.createElement('tr');

    tr.innerHTML = `
      <td>${p.purchase_date || '-'}</td>
      <td>${p.received_quantity ?? '-'}</td>
<td>${p.unit_price_ex_vat ?? '-'}</td>
    `;

    historyBody.appendChild(tr);
  });
}

departmentSelect.addEventListener('change', (e) => {
  const selected = user.departments.find(d => d.id === e.target.value);
  if (!selected) return;

  activeDepartment = selected;
  localStorage.setItem('grv2_active_department', JSON.stringify(selected));
  location.reload();
});

backBtn.addEventListener('click', () => {
  window.location.href = './articles.html';
});

editBtn.addEventListener('click', () => {
  editMode = true;
  saveBtn.classList.remove('hidden');
  editBtn.classList.add('hidden');
  loadArticle();
});

saveBtn.addEventListener('click', async () => {
  try {
    const payload = {
      plu: document.getElementById('edit-plu').value,
      designation: document.getElementById('edit-designation').value,
      ean: document.getElementById('edit-ean').value,
      unit: document.getElementById('edit-unit').value,
      vat_rate: document.getElementById('edit-vat-rate').value,
      department_id: currentArticle.department_id,
      sector_code: currentArticle.sector_code,
      category: currentArticle.category || '',
      latin_name: currentArticle.latin_name || '',
      fao_zone: currentArticle.fao_zone || '',
      sous_zone: currentArticle.sous_zone || '',
      engin: currentArticle.engin || '',
      allergenes: currentArticle.allergenes || '',
      display_name: currentArticle.display_name || '',
      purchase_unit: currentArticle.purchase_unit || '',
      stock_unit: currentArticle.stock_unit || '',
      sale_unit: currentArticle.sale_unit || '',
      is_active: currentArticle.is_active,
    };

    const res = await fetch(`${API_BASE_URL}/api/articles/${articleId}`, {
      method: 'PATCH',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Erreur');
    }

    editMode = false;
    saveBtn.classList.add('hidden');
    editBtn.classList.remove('hidden');

    alert('Article mis à jour ✅');

    loadArticle();
  } catch (err) {
    console.error(err);
    alert(err.message);
  }
});

fillTopbar();
loadArticle();
