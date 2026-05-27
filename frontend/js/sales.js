const token = localStorage.getItem("grv2_token");
const sessionUser = JSON.parse(localStorage.getItem("grv2_user") || "null");
const activeDepartment = JSON.parse(localStorage.getItem("grv2_active_department") || "null");

if (!token || !sessionUser) {
  window.location.href = "./login.html";
}

const API_BASE = window.APP_CONFIG.API_BASE_URL;

const userNameEl = document.getElementById("user-name");
const logoutBtn = document.getElementById("logout-btn");
const backHomeBtn = document.getElementById("back-home-btn");
const departmentSelect = document.getElementById("topbar-department-select");
const currentDepartmentNameEl = document.getElementById("current-department-name");

const saleStatusFilter = document.getElementById("sale-status-filter");
const saleTypeFilter = document.getElementById("sale-type-filter");
const refreshSalesBtn = document.getElementById("refresh-sales-btn");
const resetSalesFiltersBtn = document.getElementById("reset-sales-filters-btn");
const newSaleBtn = document.getElementById("new-sale-btn");

const salesFeedback = document.getElementById("sales-feedback");
const salesTableBody = document.getElementById("sales-table-body");

let sales = [];

function getUserDepartments() {
  return Array.isArray(sessionUser.departments) ? sessionUser.departments : [];
}

function getSafeActiveDepartment() {
  const departments = getUserDepartments();

  if (activeDepartment && departments.some((dep) => dep.id === activeDepartment.id)) {
    return activeDepartment;
  }

  return departments.length > 0 ? departments[0] : null;
}

function saveActiveDepartment(department) {
  localStorage.setItem("grv2_active_department", JSON.stringify(department));
}

function applyDepartmentTheme(department) {
  document.body.classList.remove(
    "theme-pois",
    "theme-bouch",
    "theme-fdl",
    "theme-boul",
    "theme-char",
    "theme-trait",
    "theme-from"
  );

  if (!department || !department.code) return;

  const map = {
    POIS: "theme-pois",
    BOUCH: "theme-bouch",
    FDL: "theme-fdl",
    BOUL: "theme-boul",
    CHAR: "theme-char",
    TRAIT: "theme-trait",
    FROM: "theme-from",
  };

  const themeClass = map[String(department.code).toUpperCase()];
  if (themeClass) document.body.classList.add(themeClass);
}

function showFeedback(el, message, isError = false) {
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hidden");
  el.classList.toggle("error", isError);
  el.classList.toggle("success", !isError);
}

function clearFeedback(el) {
  if (!el) return;
  el.textContent = "";
  el.classList.add("hidden");
  el.classList.remove("error", "success");
}

async function apiFetch(path, options = {}) {
  const headers = {
    Authorization: `Bearer ${token}`,
    ...(options.headers || {}),
  };

  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Erreur API");
  }

  return data;
}

function formatDate(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleDateString("fr-FR");
  } catch {
    return value;
  }
}

function formatSaleStatus(status) {
  const map = {
    draft: "Brouillon",
    validated: "Validé",
    cancelled: "Annulé",
  };
  return map[status] || status || "-";
}

function formatSaleType(type) {
  const map = {
    inventory_sale: "Vente inventaire",
    manual_sale: "Vente manuelle",
    transfer_out: "Rétrocession",
    waste: "Casse / perte",
  };
  return map[type] || type || "-";
}

function formatOrigin(origin) {
  const map = {
    inventory_import: "Inventaire",
    manual: "Manuel",
    interdepartment: "Inter-rayon",
    adjustment: "Ajustement",
  };
  return map[origin] || origin || "-";
}

function renderTopbar() {
  if (userNameEl) {
    userNameEl.textContent = sessionUser.email || "Utilisateur";
  }
}

function renderDepartmentSelector() {
  const departments = getUserDepartments();
  const currentDepartment = getSafeActiveDepartment();

  departmentSelect.innerHTML = "";

  if (departments.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Aucun rayon";
    departmentSelect.appendChild(option);
    departmentSelect.disabled = true;
    currentDepartmentNameEl.textContent = "Aucun rayon";
    return;
  }

  departments.forEach((department) => {
    const option = document.createElement("option");
    option.value = department.id;
    option.textContent = `${department.name} (${department.code})`;
    departmentSelect.appendChild(option);
  });

  if (currentDepartment) {
    departmentSelect.value = currentDepartment.id;
    currentDepartmentNameEl.textContent = currentDepartment.name || "-";
    saveActiveDepartment(currentDepartment);
    applyDepartmentTheme(currentDepartment);
  }

  departmentSelect.disabled = departments.length === 1;

  departmentSelect.addEventListener("change", () => {
    const selectedDepartment = departments.find((dep) => dep.id === departmentSelect.value);
    if (!selectedDepartment) return;
    saveActiveDepartment(selectedDepartment);
    applyDepartmentTheme(selectedDepartment);
    window.location.reload();
  });
}

async function loadSales() {
  clearFeedback(salesFeedback);

  const currentDepartment = getSafeActiveDepartment();

  if (!currentDepartment?.id) {
    sales = [];
    renderSalesTable();
    return;
  }

  const params = new URLSearchParams();
  params.set("department_id", currentDepartment.id);

  if (saleStatusFilter.value) params.set("status", saleStatusFilter.value);
  if (saleTypeFilter.value) params.set("document_type", saleTypeFilter.value);

  sales = await apiFetch(`/api/sales?${params.toString()}`);
  renderSalesTable();
}

function renderSalesTable() {
  if (!sales.length) {
    salesTableBody.innerHTML = `
      <tr>
        <td colspan="7">Aucun document trouvé</td>
      </tr>
    `;
    return;
  }

  salesTableBody.innerHTML = sales.map((sale) => `
    <tr>
      <td>${formatDate(sale.document_date)}</td>
      <td>${formatSaleType(sale.document_type)}</td>
      <td>${formatOrigin(sale.origin)}</td>
      <td>${formatSaleStatus(sale.status)}</td>
      <td>${sale.reference_number || "-"}</td>
      <td>${sale.line_count || 0}</td>
      <td>
        <div class="page-actions-right">
          <button class="btn btn-secondary btn-sm" data-action="open-sale" data-id="${sale.id}">
            Ouvrir
          </button>
          ${sale.status === "draft" ? `
            <button class="btn btn-danger btn-sm" data-action="delete-sale" data-id="${sale.id}">
              Supprimer
            </button>
          ` : ""}
        </div>
      </td>
    </tr>
  `).join("");
}

async function createSale() {
  clearFeedback(salesFeedback);

  const currentDepartment = getSafeActiveDepartment();

  if (!currentDepartment?.id) {
    showFeedback(salesFeedback, "Aucun rayon actif sélectionné", true);
    return;
  }

  const data = await apiFetch("/api/sales", {
    method: "POST",
    body: JSON.stringify({
      department_id: currentDepartment.id,
      document_type: "manual_sale",
      origin: "manual",
      notes: null,
    }),
  });

  if (data?.sale?.id) {
    window.location.href = `./sale-detail.html?id=${encodeURIComponent(data.sale.id)}`;
    return;
  }

  await loadSales();
}

async function deleteSale(saleId) {
  clearFeedback(salesFeedback);

  const confirmed = confirm("Supprimer ce document de vente ?");
  if (!confirmed) return;

  await apiFetch(`/api/sales/${saleId}`, {
    method: "DELETE",
  });

  sales = sales.filter((sale) => sale.id !== saleId);
  renderSalesTable();

  showFeedback(salesFeedback, "Document supprimé");
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", () => {
    localStorage.removeItem("grv2_token");
    localStorage.removeItem("grv2_user");
    localStorage.removeItem("grv2_active_department");
    window.location.href = "./login.html";
  });
}

if (backHomeBtn) {
  backHomeBtn.addEventListener("click", () => {
    window.location.href = "./home.html";
  });
}

if (refreshSalesBtn) {
  refreshSalesBtn.addEventListener("click", loadSales);
}

if (resetSalesFiltersBtn) {
  resetSalesFiltersBtn.addEventListener("click", async () => {
    saleStatusFilter.value = "";
    saleTypeFilter.value = "";
    await loadSales();
  });
}

if (saleStatusFilter) {
  saleStatusFilter.addEventListener("change", loadSales);
}

if (saleTypeFilter) {
  saleTypeFilter.addEventListener("change", loadSales);
}

if (newSaleBtn) {
  newSaleBtn.addEventListener("click", createSale);
}

if (salesTableBody) {
  salesTableBody.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;

    const action = button.dataset.action;
    const saleId = button.dataset.id;

    if (action === "open-sale") {
      window.location.href = `./sale-detail.html?id=${encodeURIComponent(saleId)}`;
      return;
    }

    if (action === "delete-sale") {
      await deleteSale(saleId);
    }
  });
}

async function init() {
  try {
    renderTopbar();
    renderDepartmentSelector();
    await loadSales();
  } catch (error) {
    console.error("Erreur init ventes :", error);
    showFeedback(salesFeedback, error.message || "Erreur chargement ventes", true);
  }
}

init();