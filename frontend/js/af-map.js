const token = localStorage.getItem("gc_token") || localStorage.getItem("grv2_token");
const sessionUser = JSON.parse(localStorage.getItem("gc_user") || localStorage.getItem("grv2_user") || "null");

if (!token || !sessionUser) {
  window.location.href = "./login.html";
}

const API_BASE = window.APP_CONFIG.API_BASE_URL;

const userNameEl = document.getElementById("user-name");
const backHomeBtn = document.getElementById("back-home-btn");
const logoutBtn = document.getElementById("logout-btn");

const supplierFilter = document.getElementById("supplier-filter");
const mappingSearchInput = document.getElementById("mapping-search-input");
const activeFilter = document.getElementById("active-filter");
const refreshMappingsBtn = document.getElementById("refresh-mappings-btn");
const mappingsTableBody = document.getElementById("mappings-table-body");

const mappingFormTitle = document.getElementById("mapping-form-title");
const mappingFeedback = document.getElementById("mapping-feedback");
const mappingIdInput = document.getElementById("mapping-id");
const mappingSupplierIdInput = document.getElementById("mapping-supplier-id");
const mappingArticleIdInput = document.getElementById("mapping-article-id");
const mappingSupplierInput = document.getElementById("mapping-supplier-input");
const mappingSupplierRefInput = document.getElementById("mapping-supplier-ref-input");
const mappingSupplierLabelInput = document.getElementById("mapping-supplier-label-input");
const mappingArticleInput = document.getElementById("mapping-article-input");
const mappingPurchaseUnitSelect = document.getElementById("mapping-purchase-unit-select");
const mappingPriceUnitSelect = document.getElementById("mapping-price-unit-select");
const saveMappingBtn = document.getElementById("save-mapping-btn");
const resetMappingFormBtn = document.getElementById("reset-mapping-form-btn");
const newMappingBtn = document.getElementById("new-mapping-btn");

const supplierModal = document.getElementById("supplier-modal");
const closeSupplierModalBtn = document.getElementById("close-supplier-modal-btn");
const supplierSearchInput = document.getElementById("supplier-search-input");
const supplierModalTableBody = document.getElementById("supplier-modal-table-body");

const articleModal = document.getElementById("article-modal");
const closeArticleModalBtn = document.getElementById("close-article-modal-btn");
const articleSearchInput = document.getElementById("article-search-input");
const articleModalTableBody = document.getElementById("article-modal-table-body");

let suppliers = [];
let mappings = [];
let articleResults = [];
let supplierResults = [];

function showFeedback(el, message, isError = false) {
  el.textContent = message;
  el.classList.remove("hidden");
  el.classList.toggle("error", isError);
  el.classList.toggle("success", !isError);
}

function clearFeedback(el) {
  el.textContent = "";
  el.classList.add("hidden");
  el.classList.remove("error", "success");
}

async function apiFetch(path, options = {}) {
  const headers = {
    Authorization: `Bearer ${token}`,
    ...(options.headers || {}),
  };
  if (!(options.body instanceof FormData)) headers["Content-Type"] = "application/json";

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Erreur API");
  return data;
}

async function loadSuppliers() {
  suppliers = await apiFetch("/api/suppliers");
  supplierFilter.innerHTML = `<option value="">Tous</option>`;
  suppliers.forEach((supplier) => {
    const option = document.createElement("option");
    option.value = supplier.id;
    option.textContent = `${supplier.code || "-"} - ${supplier.name || "-"}`;
    supplierFilter.appendChild(option);
  });
}

async function loadMappings() {
  const params = new URLSearchParams();
  if (supplierFilter.value) params.set("supplier_id", supplierFilter.value);
  if (mappingSearchInput.value.trim()) params.set("search", mappingSearchInput.value.trim());
  if (activeFilter.value) params.set("active", activeFilter.value);

  mappings = await apiFetch(`/api/af-map?${params.toString()}`);
  renderMappingsTable();
}

function renderMappingsTable() {
  if (!mappings.length) {
    mappingsTableBody.innerHTML = `<tr><td colspan="9">Aucun mapping trouve</td></tr>`;
    return;
  }

  mappingsTableBody.innerHTML = mappings.map((mapping) => `
    <tr data-mapping-id="${mapping.id}">
      <td>${mapping.supplier_code || "-"} - ${mapping.supplier_name || "-"}</td>
      <td>${mapping.supplier_ref || "-"}</td>
      <td>${mapping.supplier_label || "-"}</td>
      <td>${mapping.article_plu || "-"}</td>
      <td>${mapping.article_name || "-"}</td>
      <td>${mapping.purchase_unit || "kg"}</td>
      <td>${mapping.price_unit || "kg"}</td>
      <td><span class="mapping-status ${mapping.is_active ? "active" : "inactive"}">${mapping.is_active ? "Actif" : "Inactif"}</span></td>
      <td>
        <div class="page-actions-right">
          <button class="btn btn-secondary btn-sm" data-action="edit" data-id="${mapping.id}">Modifier</button>
          <button class="btn btn-secondary btn-sm" data-action="toggle" data-id="${mapping.id}">
            ${mapping.is_active ? "Desactiver" : "Activer"}
          </button>
        </div>
      </td>
    </tr>
  `).join("");
}

function resetForm() {
  mappingFormTitle.textContent = "Nouveau mapping";
  mappingIdInput.value = "";
  mappingSupplierIdInput.value = "";
  mappingArticleIdInput.value = "";
  mappingSupplierInput.value = "";
  mappingSupplierRefInput.value = "";
  mappingSupplierLabelInput.value = "";
  mappingArticleInput.value = "";
  mappingPurchaseUnitSelect.value = "kg";
  mappingPriceUnitSelect.value = "kg";
  clearFeedback(mappingFeedback);
}

function editMapping(mapping) {
  mappingFormTitle.textContent = "Modifier mapping";
  mappingIdInput.value = mapping.id;
  mappingSupplierIdInput.value = mapping.supplier_id;
  mappingArticleIdInput.value = mapping.article_id;
  mappingSupplierInput.value = `${mapping.supplier_code || "-"} - ${mapping.supplier_name || "-"}`;
  mappingSupplierRefInput.value = mapping.supplier_ref || "";
  mappingSupplierLabelInput.value = mapping.supplier_label || "";
  mappingArticleInput.value = `${mapping.article_plu || "-"} - ${mapping.article_name || "-"}`;
  mappingPurchaseUnitSelect.value = mapping.purchase_unit || "kg";
  mappingPriceUnitSelect.value = mapping.price_unit || "kg";
  clearFeedback(mappingFeedback);
}

async function saveMapping() {
  clearFeedback(mappingFeedback);

  const payload = {
    supplier_id: mappingSupplierIdInput.value || null,
    article_id: mappingArticleIdInput.value || null,
    supplier_ref: mappingSupplierRefInput.value.trim(),
    supplier_label: mappingSupplierLabelInput.value.trim() || null,
    purchase_unit: mappingPurchaseUnitSelect.value,
    price_unit: mappingPriceUnitSelect.value,
  };

  if (!payload.supplier_id || !payload.article_id || !payload.supplier_ref) {
    showFeedback(mappingFeedback, "Fournisseur, article et reference fournisseur sont obligatoires", true);
    return;
  }

  const id = mappingIdInput.value;
  await apiFetch(id ? `/api/af-map/${id}` : "/api/af-map", {
    method: id ? "PATCH" : "POST",
    body: JSON.stringify(payload),
  });

  showFeedback(mappingFeedback, "Mapping enregistre");
  resetForm();
  await loadMappings();
}

function openSupplierModal() {
  supplierModal.classList.remove("hidden");
  supplierSearchInput.value = "";
  renderSupplierModal();
  supplierSearchInput.focus();
}

function closeSupplierModal() {
  supplierModal.classList.add("hidden");
}

function renderSupplierModal() {
  const search = supplierSearchInput.value.trim().toLowerCase();
  supplierResults = suppliers.filter((supplier) => {
    if (!search) return true;
    return String(supplier.code || "").toLowerCase().includes(search) ||
      String(supplier.name || "").toLowerCase().includes(search);
  });

  supplierModalTableBody.innerHTML = supplierResults.length
    ? supplierResults.map((supplier) => `
      <tr data-supplier-id="${supplier.id}">
        <td>${supplier.code || "-"}</td>
        <td>${supplier.name || "-"}</td>
        <td>${supplier.contact_name || "-"}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="3">Aucun fournisseur trouve</td></tr>`;
}

function selectSupplier(supplier) {
  mappingSupplierIdInput.value = supplier.id;
  mappingSupplierInput.value = `${supplier.code || "-"} - ${supplier.name || "-"}`;
  closeSupplierModal();
}

async function openArticleModal() {
  articleModal.classList.remove("hidden");
  articleSearchInput.value = "";
  articleModalTableBody.innerHTML = `<tr><td colspan="4">Tape une recherche</td></tr>`;
  articleSearchInput.focus();
}

function closeArticleModal() {
  articleModal.classList.add("hidden");
}

async function loadArticleResults() {
  const params = new URLSearchParams();
  params.set("limit", "50");
  if (articleSearchInput.value.trim()) params.set("search", articleSearchInput.value.trim());
  articleResults = await apiFetch(`/api/articles?${params.toString()}`);
  articleModalTableBody.innerHTML = articleResults.length
    ? articleResults.map((article) => `
      <tr data-article-id="${article.id}">
        <td>${article.plu || "-"}</td>
        <td>${article.designation || "-"}</td>
        <td>${article.latin_name || "-"}</td>
        <td>${article.unit || "-"}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="4">Aucun article trouve</td></tr>`;
}

function selectArticle(article) {
  mappingArticleIdInput.value = article.id;
  mappingArticleInput.value = `${article.plu || "-"} - ${article.designation || "-"}`;
  mappingPurchaseUnitSelect.value = article.purchase_unit || article.unit || "kg";
  mappingPriceUnitSelect.value = article.purchase_unit || article.unit || "kg";
  closeArticleModal();
}

async function toggleMapping(id) {
  const mapping = mappings.find((item) => item.id === id);
  if (!mapping) return;
  await apiFetch(`/api/af-map/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ is_active: !mapping.is_active }),
  });
  await loadMappings();
}

if (userNameEl) userNameEl.textContent = sessionUser.email || "Utilisateur";

backHomeBtn?.addEventListener("click", () => {
  window.location.href = "./home.html";
});

logoutBtn?.addEventListener("click", () => {
  localStorage.removeItem("gc_token");
  localStorage.removeItem("gc_user");
  localStorage.removeItem("gc_active_department");
  localStorage.removeItem("grv2_token");
  localStorage.removeItem("grv2_user");
  localStorage.removeItem("grv2_active_department");
  window.location.href = "./login.html";
});

newMappingBtn?.addEventListener("click", resetForm);
resetMappingFormBtn?.addEventListener("click", resetForm);
saveMappingBtn?.addEventListener("click", saveMapping);
refreshMappingsBtn?.addEventListener("click", loadMappings);
supplierFilter?.addEventListener("change", loadMappings);
mappingSearchInput?.addEventListener("input", loadMappings);
activeFilter?.addEventListener("change", loadMappings);

mappingSupplierInput?.addEventListener("keydown", (event) => {
  if (event.key === "F9") {
    event.preventDefault();
    openSupplierModal();
  }
});

mappingArticleInput?.addEventListener("keydown", (event) => {
  if (event.key === "F9") {
    event.preventDefault();
    openArticleModal();
  }
});

closeSupplierModalBtn?.addEventListener("click", closeSupplierModal);
supplierSearchInput?.addEventListener("input", renderSupplierModal);
supplierModalTableBody?.addEventListener("dblclick", (event) => {
  const row = event.target.closest("tr[data-supplier-id]");
  if (!row) return;
  const supplier = supplierResults.find((item) => item.id === row.dataset.supplierId);
  if (supplier) selectSupplier(supplier);
});

closeArticleModalBtn?.addEventListener("click", closeArticleModal);
articleSearchInput?.addEventListener("input", () => {
  loadArticleResults().catch((error) => showFeedback(mappingFeedback, error.message, true));
});
articleModalTableBody?.addEventListener("dblclick", (event) => {
  const row = event.target.closest("tr[data-article-id]");
  if (!row) return;
  const article = articleResults.find((item) => item.id === row.dataset.articleId);
  if (article) selectArticle(article);
});

mappingsTableBody?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const id = button.dataset.id;
  if (button.dataset.action === "edit") {
    const mapping = mappings.find((item) => item.id === id);
    if (mapping) editMapping(mapping);
  } else if (button.dataset.action === "toggle") {
    await toggleMapping(id);
  }
});

async function init() {
  try {
    await loadSuppliers();
    await loadMappings();
  } catch (error) {
    showFeedback(mappingFeedback, error.message || "Erreur chargement", true);
  }
}

init();
