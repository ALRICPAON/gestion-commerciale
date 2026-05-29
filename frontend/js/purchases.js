// Debug persistant et listeners globaux ajoutés plus bas
const token = localStorage.getItem("gc_token");
const sessionUser = JSON.parse(localStorage.getItem("gc_user") || "null");
const activeDepartment = JSON.parse(localStorage.getItem("gc_active_department") || "null");

if (!token || !sessionUser) {
  window.location.href = "./login.html";
}

const API_BASE = window.APP_CONFIG.API_BASE_URL;

const userNameEl = document.getElementById("user-name");
const logoutBtn = document.getElementById("logout-btn");
const backHomeBtn = document.getElementById("back-home-btn");
const departmentSelect = document.getElementById("topbar-department-select");
const currentDepartmentNameEl = document.getElementById("current-department-name");

const purchaseStatusFilter = document.getElementById("purchase-status-filter");
const purchaseSupplierFilter = document.getElementById("purchase-supplier-filter");
const purchaseDateFromFilter = document.getElementById("purchase-date-from-filter");
const purchaseDateToFilter = document.getElementById("purchase-date-to-filter");
const purchaseSearchInput = document.getElementById("purchase-search-input");
const refreshPurchasesBtn = document.getElementById("refresh-purchases-btn");
const resetFiltersBtn = document.getElementById("reset-filters-btn");
const newOrderBtn = document.getElementById("new-order-btn");
const newBlBtn = document.getElementById("new-bl-btn");

const purchasesFeedback = document.getElementById("purchases-feedback");
const purchasesTableBody = document.getElementById("purchases-table-body");
const importDocumentFileInput = document.getElementById("import-document-file");
const importSupplierSelect = document.getElementById("import-supplier-select");
const testImportDocumentBtn = document.getElementById("test-import-document-btn");
const importDocumentFeedback = document.getElementById("import-document-feedback");
const importDocumentResult = document.getElementById("import-document-result");

const supplierModal = document.getElementById("supplier-modal");
const closeSupplierModalBtn = document.getElementById("close-supplier-modal-btn");
const supplierSearchInput = document.getElementById("supplier-search-input");
const supplierModalTableBody = document.getElementById("supplier-modal-table-body");

const importMappingPanel = document.getElementById("import-mapping-panel");
const closeImportMappingModalBtn = document.getElementById("close-import-mapping-modal");
const closeImportMappingModalBtn2 = document.getElementById("close-import-mapping-modal-2");
const saveImportMappingsBtn = document.getElementById("save-import-mappings-btn");

function getImportMappingDom() {
  const dom = {
    importMappingPanel: document.getElementById("import-mapping-panel"),
    importMappingArticlesList: document.getElementById("import-mapping-articles-list"),
    importMappingSearchInput: document.getElementById("import-mapping-search"),
    importMappingFeedback: document.getElementById("import-mapping-feedback"),
    importMappingRef: document.getElementById("import-mapping-ref"),
    importMappingDesignation: document.getElementById("import-mapping-designation"),
    importMappingSelectedArticle: document.getElementById("import-mapping-selected-article"),
    importMappingStepCounter: document.getElementById("import-mapping-step-counter"),
    prevImportMappingBtn: document.getElementById("prev-import-mapping-btn"),
    nextImportMappingBtn: document.getElementById("next-import-mapping-btn"),
  };

  const missing = Object.entries(dom).filter(([, node]) => !node).map(([key]) => key);
  if (missing.length) {
    console.error("Missing DOM elements for import mapping modal:", missing);
    throw new Error("DOM elements for import mapping modal are missing");
  }

  return dom;
}


let suppliers = [];
let purchases = [];
let createMode = "order";

let pendingImportPurchaseId = null;
let pendingImportSupplierCode = null;
let pendingTradMappings = [];
let cachedArticlesForImportMapping = [];
let importMappingsState = []; // Array of { supplier_reference, designation, article_id }
let currentImportMappingIndex = 0; // Index de la référence courante en cours de mapping
let importMappingSearchTerm = ""; // Terme de recherche courant

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
  localStorage.setItem("gc_active_department", JSON.stringify(department));
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

function formatDate(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleDateString("fr-FR");
  } catch {
    return value;
  }
}

function formatCurrency(value) {
  const numberValue = Number(value || 0);
  return numberValue.toLocaleString('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPurchaseStatus(status) {
  const map = {
    draft: "Brouillon",
    ordered: "Commandé",
    receiving: "Réception en cours",
    received: "Reçu",
    closed: "Clôturé",
    cancelled: "Annulé",
  };

  return map[status] || status || "-";
}

function renderPurchaseStatusBadge(status) {
  const safeStatus = (status || '').toString();
  const label = formatPurchaseStatus(safeStatus);
  const cls = `purchase-status-badge status-${safeStatus}`;
  return `<span class="${cls}">${label}</span>`;
}

function formatPurchaseType(type) {
  const map = {
    order: "Commande",
    direct_bl: "BL direct",
    invoice_only: "Facture seule",
  };

  return map[type] || type || "-";
}

function formatDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function setCurrentMonthPurchaseDates() {
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);

  if (purchaseDateFromFilter) {
    purchaseDateFromFilter.value = formatDateInput(firstDay);
  }

  if (purchaseDateToFilter) {
    purchaseDateToFilter.value = formatDateInput(today);
  }
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

async function loadSuppliers() {
  suppliers = await apiFetch("/api/suppliers");
  purchaseSupplierFilter.innerHTML = `<option value="">Tous</option>`;

  suppliers.forEach((supplier) => {
    const option = document.createElement("option");
    option.value = supplier.id;
    option.textContent = `${supplier.code} - ${supplier.name}`;
    purchaseSupplierFilter.appendChild(option);
  });

  renderSupplierModalTable();
}

function renderSupplierModalTable() {
  const search = String(supplierSearchInput?.value || "").trim().toLowerCase();

  const filtered = suppliers.filter((supplier) => {
    if (!search) return true;
    return (
      String(supplier.code || "").toLowerCase().includes(search) ||
      String(supplier.name || "").toLowerCase().includes(search) ||
      String(supplier.contact_name || "").toLowerCase().includes(search)
    );
  });

  if (!filtered.length) {
    supplierModalTableBody.innerHTML = `
      <tr><td colspan="5">Aucun fournisseur trouvé</td></tr>
    `;
    return;
  }

  supplierModalTableBody.innerHTML = filtered.map((supplier) => `
    <tr data-supplier-id="${supplier.id}">
      <td>${supplier.code || "-"}</td>
      <td>${supplier.name || "-"}</td>
      <td>${supplier.contact_name || "-"}</td>
      <td>${supplier.phone || "-"}</td>
      <td>${supplier.is_active ? "Actif" : "Inactif"}</td>
    </tr>
  `).join("");
}

async function loadPurchases() {
  clearFeedback(purchasesFeedback);

  const params = new URLSearchParams();

  if (purchaseStatusFilter.value) params.set("status", purchaseStatusFilter.value);
  if (purchaseSupplierFilter.value) params.set("supplier_id", purchaseSupplierFilter.value);
  if (purchaseDateFromFilter?.value) params.set("date_from", purchaseDateFromFilter.value);
  if (purchaseDateToFilter?.value) params.set("date_to", purchaseDateToFilter.value);

  purchases = await apiFetch(`/api/purchases?${params.toString()}`);
  renderPurchasesTable();
}

function renderPurchasesTable() {
  const search = String(purchaseSearchInput.value || "").trim().toLowerCase();

  let filtered = purchases;

  if (search) {
    filtered = purchases.filter((purchase) => {
      return (
        String(purchase.supplier_name || "").toLowerCase().includes(search) ||
        String(purchase.bl_number || "").toLowerCase().includes(search) ||
        String(purchase.purchase_type || "").toLowerCase().includes(search) ||
        String(purchase.status || "").toLowerCase().includes(search)
      );
    });
  }

  if (!filtered.length) {
    purchasesTableBody.innerHTML = `
      <tr>
        <td colspan="8">Aucun achat trouvé</td>
      </tr>
    `;
    return;
  }

  purchasesTableBody.innerHTML = filtered.map((purchase) => `
    <tr>
      <td>${formatDate(purchase.order_date)}</td>
      <td>${purchase.supplier_name || "-"}</td>
      <td>${formatPurchaseType(purchase.purchase_type)}</td>
      <td>${renderPurchaseStatusBadge(purchase.status)}</td>
      <td>${purchase.bl_number || "-"}</td>
      <td class="purchases-total-cell"><strong>${formatCurrency(purchase.total_amount_ex_vat)}</strong></td>
      <td>${purchase.line_count || 0}</td>
      <td>
        <div class="page-actions-right">
          <button class="btn btn-secondary btn-sm" data-action="open-purchase" data-id="${purchase.id}">
            Ouvrir
          </button>
          <button class="btn btn-secondary btn-sm" data-action="duplicate-purchase" data-id="${purchase.id}">
            Dupliquer
          </button>
          <button class="btn btn-danger btn-sm" data-action="delete-purchase" data-id="${purchase.id}">
            Supprimer
          </button>
        </div>
      </td>
    </tr>
  `).join("");
}

function openSupplierModal(mode) {
  createMode = mode;
  supplierModal.classList.remove("hidden");
  supplierSearchInput.value = "";
  renderSupplierModalTable();
  supplierSearchInput.focus();
}

function closeSupplierModal() {
  supplierModal.classList.add("hidden");
}

async function createPurchaseFromSupplier(supplier) {
  clearFeedback(purchasesFeedback);

  const currentDepartment = getSafeActiveDepartment();

  if (!currentDepartment?.id) {
    showFeedback(purchasesFeedback, "Aucun rayon actif sélectionné", true);
    return;
  }

  const payload = {
    supplier_id: supplier.id,
    department_id: currentDepartment.id,
    purchase_type: createMode === "bl" ? "direct_bl" : "order",
  };

  const data = await apiFetch("/api/purchases", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  closeSupplierModal();

  showFeedback(
    purchasesFeedback,
    `Achat créé avec succès pour ${supplier.code} - ${supplier.name}`
  );

  if (data?.purchase?.id) {
    window.location.href = `./purchase-detail.html?id=${encodeURIComponent(data.purchase.id)}`;
    return;
  }

  await loadPurchases();
}

async function duplicatePurchase(purchaseId) {
  clearFeedback(purchasesFeedback);

  const confirmed = confirm("Dupliquer cet achat ?");
  if (!confirmed) return;

  const data = await apiFetch(`/api/purchases/${purchaseId}/duplicate`, {
    method: "POST",
    body: JSON.stringify({}),
  });

  showFeedback(purchasesFeedback, "Achat dupliqué avec succès");

  if (data?.purchase?.id) {
    window.location.href = `./purchase-detail.html?id=${encodeURIComponent(data.purchase.id)}`;
    return;
  }

  await loadPurchases();
}

async function deletePurchase(purchaseId) {
  clearFeedback(purchasesFeedback);

  const confirmed = confirm("Supprimer cet achat ?");
  if (!confirmed) return;

  await apiFetch(`/api/purchases/${purchaseId}`, {
    method: "DELETE",
  });

  purchases = purchases.filter((purchase) => purchase.id !== purchaseId);
  renderPurchasesTable();

  showFeedback(purchasesFeedback, "Achat supprimé");
}

async function testImportDocument(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  clearFeedback(importDocumentFeedback);

  const file = importDocumentFileInput?.files?.[0];
  const currentDepartment = getSafeActiveDepartment();
  const selectedSupplier = importSupplierSelect?.value;

  if (!file) {
    showFeedback(importDocumentFeedback, "Choisis un fichier à importer", true);
    return;
  }

  if (!currentDepartment?.id) {
    showFeedback(importDocumentFeedback, "Aucun rayon actif sélectionné", true);
    return;
  }

  if (!selectedSupplier) {
    showFeedback(importDocumentFeedback, "Choisis un fournisseur pour l'import", true);
    return;
  }

  const formData = new FormData();
  formData.append("document", file);
  formData.append("department_id", currentDepartment.id);
  formData.append("import_parser_id", selectedSupplier);

  // Pour les criées, ajouter supplier_code_override
  if (selectedSupplier === "CRIEE_81268") {
    formData.append("supplier_code_override", "81268");
  } else if (selectedSupplier === "CRIEE_81269") {
    formData.append("supplier_code_override", "81269");
  }

  if (importDocumentResult) {
    importDocumentResult.textContent = "Import en cours...";
  }

  try {
    const response = await fetch(`${API_BASE}/api/purchases/import-document`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || data.message || "Erreur import document");
    }

    showFeedback(
      importDocumentFeedback,
      `Import terminé : ${data.imported_lines || 0} ligne(s) • ${data.detected_label || data.detected_type || "format détecté"}`
    );

    if (importDocumentResult) {
      importDocumentResult.textContent = JSON.stringify(data, null, 2);
    }

    if (!data?.purchase?.id) {
      return;
    }

    const purchaseId = data.purchase.id;

    const serverMissingMappings = Array.isArray(data.missing_trad_mappings)
      ? data.missing_trad_mappings
      : [];

    if (serverMissingMappings.length > 0) {
      await openImportMappingModal({
        purchaseId,
        supplierCode: data.purchase.supplier_code || data.purchase.supplierCode || null,
        missingMappings: serverMissingMappings,
      });
      return;
    }

    // No missing mappings - redirect to purchase detail
    window.location.href = `./purchase-detail.html?id=${encodeURIComponent(purchaseId)}`;
  } catch (error) {
    console.error("Erreur import document :", error);
    showFeedback(importDocumentFeedback, error.message || "Erreur import document", true);

    if (importDocumentResult) {
      importDocumentResult.textContent = error.message || "Erreur import document";
    }
  }
}

async function loadArticlesForImportMapping() {
  // No longer needed - articles are searched dynamically on the backend
  cachedArticlesForImportMapping = [];
}

async function searchImportMappingArticles(searchTerm) {
  const currentDepartment = getSafeActiveDepartment();
  
  if (!currentDepartment?.id) {
    return [];
  }

  if (!searchTerm || searchTerm.trim().length === 0) {
    return [];
  }

  try {
    const params = new URLSearchParams();
    params.set("department_id", currentDepartment.id);
    params.set("q", searchTerm.trim());

    const data = await apiFetch(`/api/articles/search?${params.toString()}`);
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error("Erreur recherche articles mapping:", error);
    return [];
  }
}

async function openImportMappingModal({ purchaseId, supplierCode, missingMappings }) {
  const dom = getImportMappingDom();

  pendingImportPurchaseId = purchaseId;
  pendingImportSupplierCode = supplierCode;
  pendingTradMappings = Array.isArray(missingMappings) ? missingMappings : [];
  currentImportMappingIndex = 0;
  importMappingSearchTerm = "";

  // Initialiser le state : chaque entrée a { supplier_reference, designation, article_id }
  importMappingsState = pendingTradMappings.map((item) => ({
    supplier_reference: item.supplier_reference,
    designation: item.designation,
    article_id: "",
  }));

  clearFeedback(dom.importMappingFeedback);

  if (!pendingTradMappings.length) {
    window.location.href = `./purchase-detail.html?id=${encodeURIComponent(purchaseId)}`;
    return;
  }

  dom.importMappingPanel.classList.remove("hidden");
  dom.importMappingPanel.style.display = "flex";

  dom.importMappingSearchInput.value = "";
  dom.importMappingSearchInput.oninput = async (e) => {
    importMappingSearchTerm = (e.target.value || "").trim().toLowerCase();
    await renderCurrentImportMappingStep();
  };

  dom.prevImportMappingBtn.onclick = () => goToPreviousImportMapping().catch(console.error);
  dom.nextImportMappingBtn.onclick = () => goToNextImportMapping().catch(console.error);

  await renderCurrentImportMappingStep();
}


function filterImportMappingArticles(searchTerm) {
  // Fonction dépréciée - la recherche se fait maintenant côté backend
  // Conservée pour compatibilité
  return [];
}

let importMappingSearchResults = []; // Stocke les résultats de la dernière recherche

async function selectImportMappingArticle(articleId) {
  if (currentImportMappingIndex < importMappingsState.length) {
    importMappingsState[currentImportMappingIndex].article_id = articleId;
    
    // Chercher l'article dans les résultats de recherche
    const articleData = importMappingSearchResults.find((a) => a.id === articleId);
    if (articleData) {
      importMappingsState[currentImportMappingIndex].article_data = articleData;
    }
  }
  await renderCurrentImportMappingStep();
}

window.selectImportMappingArticle = selectImportMappingArticle;

async function renderCurrentImportMappingStep() {
  const dom = getImportMappingDom();
  const currentMapping = importMappingsState[currentImportMappingIndex];
  if (!currentMapping) return;

  dom.importMappingRef.textContent = currentMapping.supplier_reference;
  dom.importMappingDesignation.textContent = currentMapping.designation;

  dom.importMappingStepCounter.textContent = `Étape ${currentImportMappingIndex + 1} / ${importMappingsState.length}`;

  // Appeler le backend pour rechercher les articles
  importMappingSearchResults = importMappingSearchTerm
    ? await searchImportMappingArticles(importMappingSearchTerm)
    : [];

  dom.importMappingArticlesList.innerHTML = importMappingSearchResults.map((article) => `
      <tr style="cursor: pointer; transition: background 0.2s;" 
          onmouseover="this.style.background='#f5f5f5'" 
          onmouseout="this.style.background=''" 
          onclick="selectImportMappingArticle('${article.id}')">
        <td>${article.plu || ""}</td>
        <td>${article.designation || ""}</td>
        <td>${article.display_name || ""}</td>
      </tr>
    `).join("");

  if (importMappingSearchResults.length === 0 && importMappingSearchTerm) {
    dom.importMappingArticlesList.innerHTML = `<tr><td colspan="3" style="text-align: center; color: #999; padding: 16px;">Aucun article trouvé</td></tr>`;
  } else if (!importMappingSearchTerm) {
    dom.importMappingArticlesList.innerHTML = `<tr><td colspan="3" style="text-align: center; color: #999; padding: 16px;">Tape pour rechercher...</td></tr>`;
  }

  const selectedArticleId = currentMapping.article_id;
  if (selectedArticleId) {
    const selectedArticleData = currentMapping.article_data;
    if (selectedArticleData) {
      dom.importMappingSelectedArticle.innerHTML = `<strong>✓ Sélectionné:</strong> ${selectedArticleData.plu} - ${selectedArticleData.designation}`;
      dom.importMappingSelectedArticle.style.background = "#e8f5e9";
    } else {
      dom.importMappingSelectedArticle.innerHTML = `<span style="color: #666;">Article sélectionné (ID: ${selectedArticleId})</span>`;
      dom.importMappingSelectedArticle.style.background = "#f5f5f5";
    }
  } else {
    dom.importMappingSelectedArticle.innerHTML = `<span style="color: #666;">Aucun article sélectionné</span>`;
    dom.importMappingSelectedArticle.style.background = "#f5f5f5";
  }

  dom.prevImportMappingBtn.disabled = currentImportMappingIndex === 0;
  dom.nextImportMappingBtn.disabled = currentImportMappingIndex === importMappingsState.length - 1;
}

async function goToPreviousImportMapping() {
  const dom = getImportMappingDom();
  if (currentImportMappingIndex > 0) {
    currentImportMappingIndex--;
    dom.importMappingSearchInput.value = "";
    importMappingSearchTerm = "";
    await renderCurrentImportMappingStep();
  }
}

async function goToNextImportMapping() {
  const dom = getImportMappingDom();
  if (currentImportMappingIndex < importMappingsState.length - 1) {
    currentImportMappingIndex++;
    dom.importMappingSearchInput.value = "";
    importMappingSearchTerm = "";
    await renderCurrentImportMappingStep();
  }
}

function closeImportMappingModal() {
  const dom = getImportMappingDom();
  dom.importMappingPanel.classList.add("hidden");
  dom.importMappingPanel.style.display = "";
  pendingImportPurchaseId = null;
  pendingImportSupplierCode = null;
  pendingTradMappings = [];
  importMappingsState = [];
  currentImportMappingIndex = 0;
  importMappingSearchTerm = "";
  dom.importMappingArticlesList.innerHTML = "";
  dom.importMappingRef.textContent = "";
  dom.importMappingDesignation.textContent = "";
  dom.importMappingSelectedArticle.innerHTML = "";
  dom.importMappingStepCounter.textContent = "";
  dom.importMappingSearchInput.value = "";
  clearFeedback(dom.importMappingFeedback);
}

async function saveImportMappings() {
  const { importMappingFeedback: domFeedback } = getImportMappingDom();
  clearFeedback(domFeedback);

  if (!importMappingsState.length || !pendingImportSupplierCode) {
    closeImportMappingModal();
    return;
  }

  // Construire les lignes à sauver uniquement pour les mappings avec un article_id
  const rowsToSave = importMappingsState
    .filter((state) => state.article_id) // Seulement ceux avec un article sélectionné
    .map((state) => {
      const articleData = state.article_data;
      if (!articleData) return null;

      return {
        supplier_code: pendingImportSupplierCode,
        plu: articleData.plu,
        supplier_ref: state.supplier_reference,
        supplier_label: state.designation || null,
      };
    })
    .filter(Boolean);

  if (!rowsToSave.length) {
    showFeedback(domFeedback, "Sélectionne au moins un article avant de sauver", true);
    return;
  }

  try {
    // Créer tous les AF_MAP
    for (const row of rowsToSave) {
      const response = await fetch(`${API_BASE}/api/af-map`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(row),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Erreur création mapping");
      }
    }

    const purchaseId = pendingImportPurchaseId;

    // Appliquer les mappings à la commande d'achat
    if (purchaseId) {
      const applyResponse = await fetch(`${API_BASE}/api/purchases/${encodeURIComponent(purchaseId)}/apply-af-mappings`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const applyData = await applyResponse.json().catch(() => ({}));

      if (!applyResponse.ok) {
        throw new Error(applyData.error || "Erreur application mappings achat");
      }
    }

    showFeedback(domFeedback, `${rowsToSave.length} mapping(s) enregistré(s)`);

    closeImportMappingModal();

    if (purchaseId) {
      setTimeout(() => {
        window.location.href = `./purchase-detail.html?id=${encodeURIComponent(purchaseId)}`;
      }, 500);
    }
  } catch (error) {
    console.error("Erreur saveImportMappings :", error);
    showFeedback(domFeedback, error.message || "Erreur enregistrement mappings", true);
  }
}

async function init() {
  try {
    renderTopbar();
    renderDepartmentSelector();
    setCurrentMonthPurchaseDates();
    await loadSuppliers();
    await loadPurchases();
  } catch (error) {
    console.error("Erreur init achats :", error);
    showFeedback(purchasesFeedback, error.message || "Erreur chargement achats", true);
  }
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", () => {
    localStorage.removeItem("gc_token");
    localStorage.removeItem("gc_user");
    localStorage.removeItem("gc_active_department");
    window.location.href = "./login.html";
  });
}

if (backHomeBtn) {
  backHomeBtn.addEventListener("click", () => {

    window.location.href = "./home.html";
  });
}

if (refreshPurchasesBtn) {
  refreshPurchasesBtn.addEventListener("click", loadPurchases);
}

if (resetFiltersBtn) {
  resetFiltersBtn.addEventListener("click", async () => {
    purchaseStatusFilter.value = "";
    purchaseSupplierFilter.value = "";
    purchaseSearchInput.value = "";
    setCurrentMonthPurchaseDates();
    await loadPurchases();
  });
}

if (purchaseSearchInput) {
  purchaseSearchInput.addEventListener("input", renderPurchasesTable);
}

if (purchaseStatusFilter) {
  purchaseStatusFilter.addEventListener("change", loadPurchases);
}

if (purchaseSupplierFilter) {
  purchaseSupplierFilter.addEventListener("change", loadPurchases);
}

if (purchaseDateFromFilter) {
  purchaseDateFromFilter.addEventListener("change", loadPurchases);
}

if (purchaseDateToFilter) {
  purchaseDateToFilter.addEventListener("change", loadPurchases);
}

if (newOrderBtn) {
  newOrderBtn.addEventListener("click", () => openSupplierModal("order"));
}

if (newBlBtn) {
  newBlBtn.addEventListener("click", () => openSupplierModal("bl"));
}

if (closeSupplierModalBtn) {
  closeSupplierModalBtn.addEventListener("click", closeSupplierModal);
}

if (supplierSearchInput) {
  supplierSearchInput.addEventListener("input", renderSupplierModalTable);
}
if (closeImportMappingModalBtn) {
  closeImportMappingModalBtn.addEventListener("click", closeImportMappingModal);
}

if (closeImportMappingModalBtn2) {
  closeImportMappingModalBtn2.addEventListener("click", closeImportMappingModal);
}

if (importMappingPanel) {
  importMappingPanel.addEventListener("click", (event) => {
    if (event.target === importMappingPanel) {
      closeImportMappingModal();
    }
  });
}

if (supplierModalTableBody) {
  supplierModalTableBody.addEventListener("dblclick", async (event) => {
    const row = event.target.closest("tr[data-supplier-id]");
    if (!row) return;

    const supplier = suppliers.find((item) => item.id === row.dataset.supplierId);
    if (!supplier) return;

    await createPurchaseFromSupplier(supplier);
  });
}

if (testImportDocumentBtn) {
  testImportDocumentBtn.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      await testImportDocument();
    } catch (globalError) {
      console.error("[GLOBAL ERROR] UNCAUGHT ERROR IN testImportDocument:", globalError);
    }
  });
}

if (saveImportMappingsBtn) {
  saveImportMappingsBtn.addEventListener("click", saveImportMappings);
}

if (purchasesTableBody) {
  purchasesTableBody.addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-action]");
    if (!btn) return;

    const action = btn.dataset.action;
    const purchaseId = btn.dataset.id;

    if (action === "open-purchase") {
      window.location.href = `./purchase-detail.html?id=${encodeURIComponent(purchaseId)}`;
      return;
    }

    if (action === "duplicate-purchase") {
      await duplicatePurchase(purchaseId);
      return;
    }

    if (action === "delete-purchase") {
      await deletePurchase(purchaseId);
    }
  });
}

init();
