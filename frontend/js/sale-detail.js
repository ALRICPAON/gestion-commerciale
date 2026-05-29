const token = localStorage.getItem("gc_token");
const sessionUser = JSON.parse(localStorage.getItem("gc_user") || "null");
const activeDepartment = JSON.parse(localStorage.getItem("gc_active_department") || "null");

if (!token || !sessionUser) {
  window.location.href = "./login.html";
}

const API_BASE = window.APP_CONFIG.API_BASE_URL;
const params = new URLSearchParams(window.location.search);
const saleId = params.get("id");

if (!saleId) {
  window.location.href = "./sales.html";
}

const userNameEl = document.getElementById("user-name");
const logoutBtn = document.getElementById("logout-btn");
const backSalesBtn = document.getElementById("back-sales-btn");
const departmentSelect = document.getElementById("topbar-department-select");
const currentDepartmentNameEl = document.getElementById("current-department-name");

const saveSaleBtn = document.getElementById("save-sale-btn");
const validateSaleBtn = document.getElementById("validate-sale-btn");
const cancelValidationBtn = document.getElementById("cancel-validation-btn");
const addLineBtn = document.getElementById("add-line-btn");

const saleHeaderFeedback = document.getElementById("sale-header-feedback");
const saleLinesFeedback = document.getElementById("sale-lines-feedback");

const saleDocumentDateInput = document.getElementById("sale-document-date");
const saleDocumentTypeInput = document.getElementById("sale-document-type");
const saleStatusInput = document.getElementById("sale-status");
const saleOriginInput = document.getElementById("sale-origin");
const saleReferenceNumberInput = document.getElementById("sale-reference-number");
const saleSourceInventoryDateInput = document.getElementById("sale-source-inventory-date");
const saleNotesInput = document.getElementById("sale-notes");

const saleLinesTableBody = document.getElementById("sale-lines-table-body");

let sale = null;
let lines = [];

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

function formatDateForInput(value) {
  if (!value) return "";
  try {
    return new Date(value).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

function numOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeSaleUnit(raw) {
  const value = String(raw || "").trim().toLowerCase();

  if (
    ["piece", "pièce", "pieces", "pièces", "pcs", "pc", "unite", "unité", "u", "uvc"]
      .includes(value)
  ) {
    return "piece";
  }

  if (["colis", "carton", "cartons", "box"].includes(value)) {
    return "colis";
  }

  return "kg";
}

function getDefaultSalePriceForDocumentType(article, documentType) {
  if (!article) return null;

  if (documentType === "transfer_out") {
    return numOrZero(article.pma || article.unit_cost_ex_vat || 0);
  }

  if (documentType === "manual_sale" || documentType === "waste") {
    return numOrZero(article.pv_ttc_real || 0);
  }

  return null;
}

function getRowPricingArticle(row) {
  if (!row?.dataset?.selectedArticleId) return null;

  return {
    id: row.dataset.selectedArticleId,
    pv_ttc_real: row.dataset.pvTtcReal || 0,
    pma: row.dataset.pma || 0,
    unit_cost_ex_vat: row.dataset.unitCostExVat || 0,
    stock_quantity: row.dataset.stockQuantity || 0,
    sale_unit: row.dataset.saleUnit || "",
  };
}

function applyDefaultSalePriceToRow(row, documentType = saleDocumentTypeInput?.value || "manual_sale") {
  if (documentType === "inventory_sale") return;

  const article = getRowPricingArticle(row);
  const selectedPrice = getDefaultSalePriceForDocumentType(article, documentType);

  if (selectedPrice === null) return;

  const priceInput = row.querySelector(".line-unit-sale-price-ttc");
  if (priceInput) {
    priceInput.value = selectedPrice.toFixed(2);
  }

  console.log('[SALES PRICE PREFILL]', {
    documentType,
    pvTtcReal: article.pv_ttc_real,
    pma: article.pma,
    selectedPrice
  });

  updateLineComputedValues(row);
}

async function apiFetch(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Erreur API");
  }

  return data;
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

async function loadSale() {
  clearFeedback(saleHeaderFeedback);
  clearFeedback(saleLinesFeedback);

  const data = await apiFetch(`/api/sales/${saleId}`);
  sale = data.sale;
  lines = Array.isArray(data.lines) ? data.lines : [];

  renderSaleHeader();
  renderLinesTable();
}

function renderSaleHeader() {
  saleDocumentDateInput.value = formatDateForInput(sale.document_date);
  saleDocumentTypeInput.value = sale.document_type || "manual_sale";
  saleStatusInput.value = sale.status || "draft";
  saleOriginInput.value = sale.origin || "manual";
  saleReferenceNumberInput.value = sale.reference_number || "";
  saleSourceInventoryDateInput.value = formatDateForInput(sale.source_inventory_date);
  saleNotesInput.value = sale.notes || "";

  const locked = sale.status === "validated";

  saleDocumentDateInput.disabled = locked;
  saleDocumentTypeInput.disabled = locked;
  saleStatusInput.disabled = locked;
  saleOriginInput.disabled = locked;
  saleReferenceNumberInput.disabled = locked;
  saleSourceInventoryDateInput.disabled = locked;
  saleNotesInput.disabled = locked;

  saveSaleBtn.disabled = locked;
  addLineBtn.disabled = locked;
  validateSaleBtn.disabled = locked;

  if (cancelValidationBtn) {
    cancelValidationBtn.classList.toggle("hidden", !locked);
    cancelValidationBtn.disabled = !locked;
  }
}

function computeDisplayedLineTotalTtc(line) {
  const qty = numOrZero(line.sold_quantity);
  const unitPrice = numOrZero(line.unit_sale_price_ttc);
  return qty * unitPrice;
}

function renderLinesTable() {
  if (!lines.length) {
    saleLinesTableBody.innerHTML = `
      <tr>
        <td colspan="11">Aucune ligne</td>
      </tr>
    `;
    return;
  }

  const locked = sale.status === "validated";

  saleLinesTableBody.innerHTML = lines.map((line) => {
    const totalTtc = computeDisplayedLineTotalTtc(line);

    return `
      <tr
        data-line-id="${line.id}"
        data-selected-article-id="${line.article_id || ""}"
        data-pv-ttc-real="${line.pv_ttc_real ?? ""}"
        data-pma="${line.pma ?? ""}"
        data-stock-quantity="${line.stock_quantity ?? ""}"
        data-sale-unit="${line.article_sale_unit || line.sale_unit || ""}"
        data-unit-cost-ex-vat="${line.unit_cost_ex_vat ?? ""}"
      >
        <td>
          <input class="line-input line-plu" type="text" value="${line.article_plu || ""}" ${locked ? "disabled" : ""} />
        </td>
        <td>
          <input class="line-input line-article-label" type="text" value="${line.article_name || line.article_label || ""}" readonly />
        </td>
        <td>
          <input class="line-input line-sold-quantity" type="number" step="0.001" value="${line.sold_quantity ?? ""}" ${locked ? "disabled" : ""} />
        </td>
        <td>
          <select class="line-input line-sale-unit" ${locked ? "disabled" : ""}>
            <option value="kg" ${line.sale_unit === "kg" ? "selected" : ""}>kg</option>
            <option value="piece" ${line.sale_unit === "piece" ? "selected" : ""}>pièce</option>
            <option value="colis" ${line.sale_unit === "colis" ? "selected" : ""}>colis</option>
          </select>
        </td>
        <td>
          <input class="line-input line-unit-sale-price-ttc" type="number" step="0.01" value="${line.unit_sale_price_ttc ?? ""}" ${locked ? "disabled" : ""} />
        </td>
        <td>
          <input class="line-input line-total-ttc" type="number" step="0.01" value="${totalTtc ? totalTtc.toFixed(2) : ""}" readonly />
        </td>
        <td>
          <input class="line-input line-unit-cost" type="number" step="0.0001" value="${line.unit_cost_ex_vat ?? ""}" ${locked ? "disabled" : ""} />
        </td>
        <td>
          <input class="line-input line-margin" type="number" step="0.01" value="${line.line_margin_ex_vat ?? ""}" readonly />
        </td>
        <td>
          <input class="line-input line-reason" type="text" value="${line.line_reason || ""}" ${locked ? "disabled" : ""} />
        </td>
        <td>${line.line_status || "-"}</td>
        <td>
          <div class="page-actions-right">
            ${locked ? "" : `<button class="btn btn-secondary btn-sm" data-action="save-line" data-id="${line.id}">💾</button>`}
            ${locked ? "" : `<button class="btn btn-danger btn-sm" data-action="delete-line" data-id="${line.id}">🗑️</button>`}
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function updateLineComputedValues(row) {
  const qty = numOrZero(row.querySelector(".line-sold-quantity")?.value);
  const unitSalePriceTtc = numOrZero(row.querySelector(".line-unit-sale-price-ttc")?.value);
  const unitCost = numOrZero(row.querySelector(".line-unit-cost")?.value);

  const totalTtc = qty * unitSalePriceTtc;
  const totalHt = totalTtc / 1.055;
  const totalCost = qty * unitCost;
  const margin = totalHt - totalCost;

  const totalInput = row.querySelector(".line-total-ttc");
  const marginInput = row.querySelector(".line-margin");

  if (totalInput) {
    totalInput.value = totalTtc ? totalTtc.toFixed(2) : "";
  }

  if (marginInput) {
    marginInput.value = margin ? margin.toFixed(2) : "";
  }
}

async function resolveArticleByPlu(row) {
  const articlePlu = row.querySelector(".line-plu").value.trim();
  const labelInput = row.querySelector(".line-article-label");

  if (!articlePlu) {
    row.dataset.selectedArticleId = "";
    row.dataset.pvTtcReal = "";
    row.dataset.pma = "";
    row.dataset.stockQuantity = "";
    row.dataset.saleUnit = "";
    row.dataset.unitCostExVat = "";
    labelInput.value = "";
    return;
  }

  const currentDepartment = getSafeActiveDepartment();
  const params = new URLSearchParams();
  params.set("q", articlePlu);

  if (currentDepartment?.id) {
    params.set("department_id", currentDepartment.id);
  }

  const results = await apiFetch(`/api/articles/search-in-stock?${params.toString()}`);

  const exact = Array.isArray(results)
    ? results.find((article) => String(article.plu || "").trim() === articlePlu)
    : null;

 const saleUnitSelect = row.querySelector(".line-sale-unit");

if (exact) {
  console.log('[SALE ARTICLE SEARCH RESULT]', exact);

  row.dataset.selectedArticleId = exact.id;
  row.dataset.pvTtcReal = exact.pv_ttc_real ?? "";
  row.dataset.pma = exact.pma ?? "";
  row.dataset.stockQuantity = exact.stock_quantity ?? "";
  row.dataset.saleUnit = exact.sale_unit || exact.unit || "";
  row.dataset.unitCostExVat = exact.unit_cost_ex_vat ?? "";
  row.querySelector(".line-plu").value = exact.plu || articlePlu;
  labelInput.value = exact.designation || "";

  // 🔥 AJOUT IMPORTANT
  const normalizedUnit = normalizeSaleUnit(
    exact.sale_unit || exact.unit || "kg"
  );

  if (saleUnitSelect) {
    saleUnitSelect.value = normalizedUnit;
  }

  applyDefaultSalePriceToRow(row, saleDocumentTypeInput.value || "manual_sale");
} else {
  row.dataset.selectedArticleId = "";
  row.dataset.pvTtcReal = "";
  row.dataset.pma = "";
  row.dataset.stockQuantity = "";
  row.dataset.saleUnit = "";
  row.dataset.unitCostExVat = "";
  labelInput.value = "";

  if (saleUnitSelect) {
    saleUnitSelect.value = "kg";
  }
}

// 🔥 recalcul après changement
updateLineComputedValues(row);
}

async function saveSaleHeader() {
  clearFeedback(saleHeaderFeedback);

  const payload = {
    document_date: saleDocumentDateInput.value || null,
    document_type: saleDocumentTypeInput.value || null,
    status: saleStatusInput.value || null,
    origin: saleOriginInput.value || null,
    reference_number: saleReferenceNumberInput.value.trim() || null,
    source_inventory_date: saleSourceInventoryDateInput.value || null,
    notes: saleNotesInput.value.trim() || null,
  };

  await apiFetch(`/api/sales/${saleId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });

  showFeedback(saleHeaderFeedback, "En-tête vente enregistré");
  await loadSale();
}

async function addLine() {
  clearFeedback(saleLinesFeedback);

  const payload = {
    article_id: null,
    article_plu: null,
    sold_quantity: 0,
    sale_unit: "kg",
    unit_sale_price_ttc: 0,
    unit_sale_price_ht: 0,
    unit_cost_ex_vat: 0,
    line_reason: null,
    ean: null,
    article_label: null,
    source_inventory_line: {},
  };

  await apiFetch(`/api/sales/${saleId}/lines`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  showFeedback(saleLinesFeedback, "Ligne ajoutée");
  await loadSale();
}

async function saveLine(lineId) {
  clearFeedback(saleLinesFeedback);

  const row = saleLinesTableBody.querySelector(`tr[data-line-id="${lineId}"]`);
  if (!row) return;

  const articleId = row.dataset.selectedArticleId || null;
  const articlePlu = row.querySelector(".line-plu").value.trim() || null;

  if (!articleId && !articlePlu) {
    showFeedback(saleLinesFeedback, "Saisis un PLU valide", true);
    return;
  }

  const payload = {
    article_id: articleId,
    article_plu: !articleId ? articlePlu : null,
    sold_quantity: numOrZero(row.querySelector(".line-sold-quantity").value),
    sale_unit: row.querySelector(".line-sale-unit").value || "kg",
    unit_sale_price_ttc: numOrZero(row.querySelector(".line-unit-sale-price-ttc").value),
    unit_cost_ex_vat: numOrZero(row.querySelector(".line-unit-cost").value),
    line_reason: row.querySelector(".line-reason").value.trim() || null,
    article_label: row.querySelector(".line-article-label").value.trim() || null,
    source_inventory_line: {},
  };

  await apiFetch(`/api/sales/lines/${lineId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });

  showFeedback(saleLinesFeedback, "Ligne enregistrée");
  await loadSale();
}

async function deleteLine(lineId) {
  clearFeedback(saleLinesFeedback);

  const confirmed = confirm("Supprimer cette ligne ?");
  if (!confirmed) return;

  await apiFetch(`/api/sales/lines/${lineId}`, {
    method: "DELETE",
  });

  showFeedback(saleLinesFeedback, "Ligne supprimée");
  await loadSale();
}

async function validateSale() {
  clearFeedback(saleLinesFeedback);

  const confirmed = confirm("Confirmer la validation de cette sortie ?");
  if (!confirmed) return;

  const originalText = validateSaleBtn?.textContent;

  try {
    if (validateSaleBtn) {
      validateSaleBtn.disabled = true;
      validateSaleBtn.textContent = "Validation...";
    }

    await apiFetch(`/api/sales/${saleId}/validate`, {
      method: "POST",
      body: JSON.stringify({}),
    });

    showFeedback(saleLinesFeedback, "Sortie validée");
    await loadSale();
  } catch (error) {
    if (validateSaleBtn) {
      validateSaleBtn.disabled = false;
      validateSaleBtn.textContent = originalText || "Valider";
    }
    showFeedback(saleLinesFeedback, error.message || "Erreur validation sortie", true);
  }
}

async function cancelValidation() {
  clearFeedback(saleLinesFeedback);

  const confirmed = confirm("Annuler la validation de cette sortie et remettre le stock ?");
  if (!confirmed) return;

  const originalText = cancelValidationBtn?.textContent;

  try {
    if (cancelValidationBtn) {
      cancelValidationBtn.disabled = true;
      cancelValidationBtn.textContent = "Annulation...";
    }

    await apiFetch(`/api/sales/${saleId}/cancel-validation`, {
      method: "POST",
      body: JSON.stringify({}),
    });

    await loadSale();
    showFeedback(saleLinesFeedback, "Validation annulée, document repassé en brouillon");
  } catch (error) {
    if (cancelValidationBtn) {
      cancelValidationBtn.disabled = false;
      cancelValidationBtn.textContent = originalText || "Annuler validation";
    }
    showFeedback(saleLinesFeedback, error.message || "Erreur annulation validation", true);
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

if (backSalesBtn) {
  backSalesBtn.addEventListener("click", () => {
    window.location.href = "./sales.html";
  });
}

if (saveSaleBtn) {
  saveSaleBtn.addEventListener("click", saveSaleHeader);
}

if (saleDocumentTypeInput) {
  saleDocumentTypeInput.addEventListener("change", () => {
    const documentType = saleDocumentTypeInput.value || "manual_sale";
    saleLinesTableBody
      ?.querySelectorAll("tr[data-line-id]")
      .forEach((row) => applyDefaultSalePriceToRow(row, documentType));
  });
}

if (validateSaleBtn) {
  validateSaleBtn.addEventListener("click", validateSale);
}

if (cancelValidationBtn) {
  cancelValidationBtn.addEventListener("click", cancelValidation);
}

if (addLineBtn) {
  addLineBtn.addEventListener("click", addLine);
}

if (saleLinesTableBody) {
  saleLinesTableBody.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;

    const action = button.dataset.action;
    const lineId = button.dataset.id;

    if (action === "save-line") {
      await saveLine(lineId);
      return;
    }

    if (action === "delete-line") {
      await deleteLine(lineId);
    }
  });
}

if (saleLinesTableBody) {
  saleLinesTableBody.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;

    const target = event.target;
    const row = target.closest("tr[data-line-id]");
    if (!row) return;

    const allowedClasses = [
      "line-plu",
      "line-sold-quantity",
      "line-sale-unit",
      "line-unit-sale-price-ttc",
      "line-unit-cost",
      "line-reason",
    ];

    if (!allowedClasses.some((cls) => target.classList.contains(cls))) return;

    event.preventDefault();

    const lineId = row.dataset.lineId;
    if (!lineId) return;

    await saveLine(lineId);
    await addLine();

    const lastRow = saleLinesTableBody.querySelector("tr[data-line-id]:last-child");
    lastRow?.querySelector(".line-plu")?.focus();
  });
}

if (saleLinesTableBody) {
  saleLinesTableBody.addEventListener(
    "blur",
    async (event) => {
      const input = event.target;
      if (!input.classList.contains("line-plu")) return;

      const row = input.closest("tr[data-line-id]");
      if (!row) return;

      await resolveArticleByPlu(row);
    },
    true
  );
}

if (saleLinesTableBody) {
  saleLinesTableBody.addEventListener("input", (event) => {
    const row = event.target.closest("tr[data-line-id]");
    if (!row) return;

    if (
      event.target.classList.contains("line-sold-quantity") ||
      event.target.classList.contains("line-unit-sale-price-ttc") ||
      event.target.classList.contains("line-unit-cost")
    ) {
      updateLineComputedValues(row);
    }
  });
}

async function init() {
  try {
    renderTopbar();
    renderDepartmentSelector();
    await loadSale();
  } catch (error) {
    console.error("Erreur init détail vente :", error);
    showFeedback(saleLinesFeedback, error.message || "Erreur chargement vente", true);
  }
}

init();
