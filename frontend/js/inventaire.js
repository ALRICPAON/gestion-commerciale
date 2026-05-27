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

const importBtn = document.getElementById("import-inventory-btn");
const manualInventoryBtn = document.getElementById("manual-inventory-btn");
const validateInventoryBtn = document.getElementById("validate-inventory-btn");
const validateAnomaliesBtn = document.getElementById("validate-anomalies-btn");
const clearPreviewBtn = document.getElementById("clear-preview-btn");

const fileInput = document.getElementById("inventory-file");
const dateInput = document.getElementById("inventory-date");
const notesInput = document.getElementById("inventory-notes");
const feedbackEl = document.getElementById("inventory-feedback");

const inventoryTableBody = document.getElementById("inventory-table-body");
const inventorySearchInput = document.getElementById("inventory-search-input");

const statTotalLinesEl = document.getElementById("stat-total-lines");
const statRetainedLinesEl = document.getElementById("stat-retained-lines");
const statStockAlertLinesEl = document.getElementById("stat-stock-alert-lines");
const statTotalCaEl = document.getElementById("stat-total-ca");

let previewData = {
  total_input_lines: 0,
  retained_lines: [],
  ignored_lines: [],
  anomaly_lines: [],
};

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

function showFeedback(message, isError = false) {
  if (!feedbackEl) return;
  feedbackEl.textContent = message;
  feedbackEl.style.whiteSpace = "pre-line";
  feedbackEl.classList.remove("hidden");
  feedbackEl.classList.toggle("error", isError);
  feedbackEl.classList.toggle("success", !isError);
}

function clearFeedback() {
  if (!feedbackEl) return;
  feedbackEl.textContent = "";
  feedbackEl.classList.add("hidden");
  feedbackEl.classList.remove("error", "success");
}

function formatCurrency(value, digits = 2) {
  const n = Number(value || 0);
  return n.toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatNumber(value, digits = 3) {
  const n = Number(value || 0);
  return n.toLocaleString("fr-FR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function numOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeSaleUnit(raw) {
  const value = String(raw || "").trim().toLowerCase();

  if (["piece", "pièce", "pieces", "pièces", "pcs", "pc", "unite", "unité", "u", "uvc"].includes(value)) {
    return "piece";
  }

  if (["colis", "carton", "cartons", "box"].includes(value)) {
    return "colis";
  }

  return "kg";
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
    const error = new Error(data.error || "Erreur API");
    error.status = response.status;
    error.code = data.code;
    error.details = Array.isArray(data.details) ? data.details : [];
    throw error;
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

  if (!departmentSelect) return;

  departmentSelect.innerHTML = "";

  if (departments.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Aucun rayon";
    departmentSelect.appendChild(option);
    departmentSelect.disabled = true;

    if (currentDepartmentNameEl) {
      currentDepartmentNameEl.textContent = "Aucun rayon";
    }
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
    if (currentDepartmentNameEl) {
      currentDepartmentNameEl.textContent = currentDepartment.name || "-";
    }
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

function resetPreviewData() {
  previewData = {
    total_input_lines: 0,
    retained_lines: [],
    ignored_lines: [],
    anomaly_lines: [],
  };
}

function renderStats() {
  const retained = Array.isArray(previewData.retained_lines) ? previewData.retained_lines : [];
  const stockAlertCount = retained.filter((line) => !!line.stock_alert).length;
  const resolvedCount = retained.filter((line) => !!line.resolved).length;
  const excludedCount = retained.filter((line) => line.include === false).length;
  const includedLines = retained.filter((line) => line.include !== false);
  const unresolvedLines = retained.filter((line) => {
    if (line.include !== false && !line.resolved) return true;

    return (
      line.include === false
      && (line.stock_alert || line.anomaly_type || line.insufficient_stock)
      && !String(line.line_reason || "").trim()
    );
  });
  const totalCa = includedLines.reduce((sum, line) => sum + numOrZero(line.line_total_ttc), 0);

  if (statTotalLinesEl) statTotalLinesEl.textContent = String(previewData.total_input_lines || 0);
  if (statRetainedLinesEl) statRetainedLinesEl.textContent = String(retained.length);
  if (statStockAlertLinesEl) statStockAlertLinesEl.textContent = String(stockAlertCount);
  if (statTotalCaEl) statTotalCaEl.textContent = formatCurrency(totalCa, 2);

  // Ajouter les nouvelles stats si les éléments existent
  const statResolvedEl = document.getElementById("stat-resolved-lines");
  const statUnresolvedEl = document.getElementById("stat-unresolved-lines");

  if (statResolvedEl) statResolvedEl.textContent = String(resolvedCount);
  if (statUnresolvedEl) statUnresolvedEl.textContent = String(unresolvedLines.length);

  if (validateInventoryBtn) {
  validateInventoryBtn.disabled = retained.length === 0;
}
}

function getStatusLabel(line) {
  if (line.insufficient_stock) return "Stock insuffisant";
  if (line.stock_alert) return "Stock nul";
  if (line.anomaly_type) return "Anomalie";
  if (line.resolved) return "Résolu";
  if (line.include === false) return "Exclu";
  return "OK";
}

function getStatusStyle(line) {
  if (line.insufficient_stock) return 'class="status-alert"';
  if (line.stock_alert) return 'class="status-alert"';
  if (line.anomaly_type) return 'class="status-alert"';
  if (line.resolved) return 'class="status-resolved"';
  if (line.include === false) return 'class="status-excluded"';
  return 'class="status-normal"';
}

function clearInsufficientStockHighlights() {
  const retained = Array.isArray(previewData.retained_lines) ? previewData.retained_lines : [];
  retained.forEach((line) => {
    line.insufficient_stock = false;
  });
}

function markInsufficientStockLines(details) {
  clearInsufficientStockHighlights();

  const articleIds = new Set(
    details
      .map((detail) => detail.article_id)
      .filter(Boolean)
      .map(String)
  );
  const plus = new Set(
    details
      .map((detail) => detail.plu)
      .filter(Boolean)
      .map((plu) => String(plu).trim())
  );

  const retained = Array.isArray(previewData.retained_lines) ? previewData.retained_lines : [];
  retained.forEach((line) => {
    const articleId = line.article_id ? String(line.article_id) : "";
    const plu = line.article_plu ? String(line.article_plu).trim() : "";
    line.insufficient_stock = articleIds.has(articleId) || plus.has(plu);
  });
}

function hasInventoryAnomaly(line) {
  return !!(
    line
    && (
      line.stock_alert
      || line.anomaly_type
      || line.insufficient_stock
      || String(line.line_reason || "").trim()
    )
  );
}

function isInventoryProblemLine(line) {
  return !!(line && (line.stock_alert || line.anomaly_type || line.insufficient_stock));
}

function buildAnomaliesPayload() {
  const retained = Array.isArray(previewData.retained_lines) ? previewData.retained_lines : [];

  return retained
    .filter((line) => line.include === false && hasInventoryAnomaly(line))
    .map((line) => ({
      ...line,
      action_type: line.action_type || "reported",
      anomaly_type: line.anomaly_type || (line.stock_alert ? "stock_alert" : "inventory_anomaly"),
      reason: line.line_reason || null,
      raw_line: { ...line },
    }));
}

function formatInventoryStockError(details) {
  const lines = Array.isArray(details) ? details : [];

  if (!lines.length) {
    return "Validation impossible : stock insuffisant";
  }

  const formattedDetails = lines.map((detail) => {
    const unit = detail.unit || "kg";
    const plu = detail.plu || "-";
    const designation = detail.designation || "Article sans désignation";

    return [
      `- PLU ${plu} — ${designation}`,
      `  Demandé : ${formatNumber(detail.requested_quantity, 3)} ${unit}`,
      `  Disponible : ${formatNumber(detail.available_quantity, 3)} ${unit}`,
      `  Manquant : ${formatNumber(detail.missing_quantity, 3)} ${unit}`,
    ].join("\n");
  }).join("\n\n");

  return `Validation impossible : stock insuffisant\n\nArticles concernés :\n${formattedDetails}`;
}

function renderPreviewTable() {
  const retained = Array.isArray(previewData.retained_lines) ? previewData.retained_lines : [];

  if (!inventoryTableBody) return;

  if (!retained.length) {
    inventoryTableBody.innerHTML = `
      <tr>
        <td colspan="14">Aucun import chargé</td>
      </tr>
    `;
    return;
  }

  inventoryTableBody.innerHTML = retained.map((line, index) => {
    const saleUnit = normalizeSaleUnit(line.sale_unit || "kg");
    const soldQty = numOrZero(line.sold_quantity);
    const unitPriceTtc = numOrZero(line.unit_sale_price_ttc);
    const totalTtc = numOrZero(line.line_total_ttc || (soldQty * unitPriceTtc));
    const stockQty = numOrZero(line.stock_quantity);
    const remainingQty = line.remaining_quantity ?? Math.max(0, stockQty - soldQty).toFixed(3);

    return `
      <tr
  data-line-index="${index}"
  data-search="${[
    line.article_plu,
    line.article_label,
    line.pricing_mode,
    line.mode,
    line.sale_unit
  ].filter(Boolean).join(" ").toLowerCase()}"
  ${getStatusStyle(line)}
>
        <td>${line.source_row_number || index + 1}</td>
        <td><span class="status-badge">${getStatusLabel(line)}</span></td>
        <td>${line.sector_code || line.pricing_mode || line.mode || "-"}</td>
        <td>
          <input
            class="line-input inv-article-plu"
            type="text"
            value="${line.article_plu || ""}"
            placeholder="PLU"
          />
        </td>
        <td>
          <input
            class="line-input inv-article-label"
            type="text"
            value="${line.article_label || ""}"
            placeholder="Article"
            readonly
          />
        </td>
        <td>${formatNumber(stockQty, 3)}</td>
<td>
  <input
    class="line-input inv-remaining-quantity"
    type="number"
    step="0.001"
    value="${remainingQty}"
    placeholder="Restant"
  />
</td>
        <td>
  <input
    class="line-input inv-sold-quantity"
    type="number"
    step="0.001"
    value="${soldQty}"
    ${line.pricing_mode === "manual_remaining_stock" ? "readonly" : ""}
  />
</td>
        <td>
          <select class="line-input inv-sale-unit">
            <option value="kg" ${saleUnit === "kg" ? "selected" : ""}>kg</option>
            <option value="piece" ${saleUnit === "piece" ? "selected" : ""}>pièce</option>
            <option value="colis" ${saleUnit === "colis" ? "selected" : ""}>colis</option>
          </select>
        </td>
        <td>
          <input
            class="line-input inv-unit-price-ttc"
            type="number"
            step="0.0001"
            value="${unitPriceTtc}"
          />
        </td>
        <td>
          <input
            class="line-input inv-line-total-ttc"
            type="number"
            step="0.01"
            value="${totalTtc.toFixed(2)}"
            readonly
          />
        </td>
        <td>
          <input
            class="line-input inv-line-reason"
            type="text"
            value="${line.line_reason || ""}"
            placeholder="Motif justification"
          />
        </td>
        <td style="text-align:center;">
          <input
            class="inv-include-line"
            type="checkbox"
            ${line.include !== false ? "checked" : ""}
          />
        </td>
        <td style="text-align:center;">
          <button class="btn btn-sm btn-danger inv-delete-line" title="Supprimer cette ligne">
            🗑️
          </button>
        </td>
      </tr>
    `;
  }).join("");

  applyInventorySearchFilter();
}

function syncComputedLine(index) {
  const row = inventoryTableBody.querySelector(`tr[data-line-index="${index}"]`);
  if (!row) return;

  const line = previewData.retained_lines[index];
  if (!line) return;

  const qtyInput = row.querySelector(".inv-sold-quantity");
  const remainingInput = row.querySelector(".inv-remaining-quantity");
  const unitPriceInput = row.querySelector(".inv-unit-price-ttc");
  const totalInput = row.querySelector(".inv-line-total-ttc");
  const unitSelect = row.querySelector(".inv-sale-unit");
  const reasonInput = row.querySelector(".inv-line-reason");
  const includeInput = row.querySelector(".inv-include-line");
  const pluInput = row.querySelector(".inv-article-plu");

  let qty = numOrZero(qtyInput?.value);

  if (remainingInput && remainingInput.value !== "") {
    const remainingQty = Math.max(0, numOrZero(remainingInput.value));

    line.remaining_quantity = remainingQty;

    qty = Math.max(0, numOrZero(line.stock_quantity) - remainingQty);

    if (qtyInput) {
      qtyInput.value = qty.toFixed(3);
    }
  }

  const unitPrice = numOrZero(unitPriceInput?.value);
  const total = qty * unitPrice;

  if (totalInput) {
    totalInput.value = total.toFixed(2);
  }

  line.sold_quantity = qty;
  line.sale_unit = normalizeSaleUnit(unitSelect?.value || "kg");
  line.unit_sale_price_ttc = unitPrice;
  line.line_total_ttc = total;
  line.line_reason = reasonInput?.value?.trim() || null;

  if (line.pricing_mode === "manual_remaining_stock") {
    line.include = qty > 0;
    if (includeInput) {
      includeInput.checked = qty > 0;
    }
  } else {
    line.include = !!includeInput?.checked;
  }

  const previousPlu = String(line.article_plu || "").trim();
  const newPlu = String(pluInput?.value || "").trim();

  if (newPlu && newPlu !== previousPlu) {
    line.article_plu = newPlu;
    updateArticleFromPlu(index, newPlu);
  }

  updateLineResolution(index);
  renderStats();
}

async function updateArticleFromPlu(index, plu) {
  if (!plu) return;

  try {
    const currentDepartment = getSafeActiveDepartment();
    if (!currentDepartment?.id) return;

    const line = previewData.retained_lines[index];
    if (!line) return;

    const searchedPlu = String(plu || "").trim();

    const data = await apiFetch(`/api/articles/search?q=${encodeURIComponent(plu)}&department_id=${currentDepartment.id}`);
    const articles = Array.isArray(data)
      ? data
      : Array.isArray(data.articles)
        ? data.articles
        : Array.isArray(data.results)
          ? data.results
          : Array.isArray(data.items)
            ? data.items
            : [];

    if (articles.length > 0) {
      const article = articles[0];
      line.article_id = article.id;
      line.article_label = article.display_name || article.designation || "";
      line.article_plu = article.plu || searchedPlu;
      line.sale_unit = normalizeSaleUnit(article.sale_unit || "kg");
    } else {
      line.article_id = null;
      line.article_label = "Article introuvable";
    }
  } catch (error) {
    console.error("Erreur recherche article:", error);
  }
}

function updateLineResolution(index) {
  const line = previewData.retained_lines[index];
  if (!line) return;

  if (line.stock_alert || line.anomaly_type || line.insufficient_stock) {
    line.resolved = !!String(line.line_reason || "").trim();
    return;
  }

  // 1. Ligne exclue = OK
  if (line.include === false) {
    line.resolved = true;
    return;
  }

  // 2. Motif rempli = OK
  if (line.line_reason && line.line_reason.trim()) {
    line.resolved = true;
    return;
  }

  // 3. Si stock = 0 → DOIT rester en anomalie
  if (line.stock_alert) {
    line.resolved = false;
    return;
  }

  // 4. Ligne normale avec stock OK
  line.resolved = true;
}

function deleteLine(index) {
  if (index < 0 || index >= previewData.retained_lines.length) return;

  previewData.retained_lines.splice(index, 1);
  renderStats();
  renderPreviewTable();
}

async function loadManualInventoryPreview() {
  try {
    clearFeedback();

    showFeedback("⏳ Chargement du stock actuel...");

    const currentDepartment = getSafeActiveDepartment();

    if (!currentDepartment?.id) {
      showFeedback("Aucun rayon actif", true);
      return;
    }

    const data = await apiFetch(
      `/api/inventory/manual-preview?department_id=${currentDepartment.id}`
    );

    previewData = {
      total_input_lines: data.total_input_lines || 0,

      retained_lines: Array.isArray(data.retained_lines)
  ? data.retained_lines
      .map((line) => ({
        ...line,
        include: false,
        resolved: true,
        remaining_quantity: null,
        sold_quantity: 0,
      }))
      .sort((a, b) => {
        const order = { TRAD: 1, FE: 2, LS: 3, SCE: 4, EMB: 5 };

        const sectorA = String(a.sector_code || "").toUpperCase();
        const sectorB = String(b.sector_code || "").toUpperCase();

        const rankA = order[sectorA] || 99;
        const rankB = order[sectorB] || 99;

        if (rankA !== rankB) return rankA - rankB;

        return String(a.article_label || "").localeCompare(
          String(b.article_label || ""),
          "fr"
        );
      })
  : [],

      ignored_lines: [],
      anomaly_lines: [],
    };

    renderStats();
    renderPreviewTable();

    showFeedback(
      `✅ Inventaire manuel chargé (${previewData.retained_lines.length} lignes)`
    );

  } catch (error) {
    console.error(error);

    showFeedback(
      error.message || "Erreur chargement inventaire manuel",
      true
    );
  }
}

async function previewImport() {
  try {
    clearFeedback();
    showFeedback("⏳ Analyse du fichier en cours...");

    const file = fileInput.files[0];
    if (!file) {
      showFeedback("Sélectionne un fichier", true);
      return;
    }

    const inventoryDate = dateInput.value;
    if (!inventoryDate) {
      showFeedback("Renseigne la date inventaire", true);
      return;
    }

    const currentDepartment = getSafeActiveDepartment();
    if (!currentDepartment?.id) {
      showFeedback("Aucun rayon actif", true);
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("department_id", currentDepartment.id);
    formData.append("inventory_date", inventoryDate);
    formData.append("notes", notesInput.value?.trim() || "");

    const data = await apiFetch("/api/inventory/preview-import", {
      method: "POST",
      body: formData,
    });

    previewData = {
  total_input_lines: data.total_input_lines || 0,
  retained_lines: Array.isArray(data.retained_lines)
    ? data.retained_lines.map((line) => {
        const normalizedLine = {
          ...line,
          sale_unit: normalizeSaleUnit(line.sale_unit || "kg"),
          include: line.include !== false,
          resolved: false,
        };
        normalizedLine.remaining_quantity = Math.max(
          0,
          numOrZero(normalizedLine.stock_quantity) - numOrZero(normalizedLine.sold_quantity)
        );

        if (normalizedLine.stock_alert || normalizedLine.anomaly_type) {
          normalizedLine.include = false;
          normalizedLine.resolved = !!String(normalizedLine.line_reason || "").trim();
        } else if (normalizedLine.include === false) {
          normalizedLine.resolved = true;
        } else if (!normalizedLine.stock_alert) {
          normalizedLine.resolved = true;
        } else if (normalizedLine.line_reason && String(normalizedLine.line_reason).trim()) {
          normalizedLine.resolved = true;
        }

        return normalizedLine;
      })
    : [],
  ignored_lines: Array.isArray(data.ignored_lines) ? data.ignored_lines : [],
  anomaly_lines: [],
};

    renderStats();
    renderPreviewTable();

    showFeedback(`✅ Prévisualisation chargée (${previewData.retained_lines.length} lignes retenues)`);
  } catch (error) {
    console.error("Erreur preview inventaire :", error);
    resetPreviewData();
    renderStats();
    renderPreviewTable();
    showFeedback(error.message || "Erreur import inventaire", true);
  }
}

async function validateInventory() {
  try {
    clearFeedback();
    clearInsufficientStockHighlights();

    if (validateInventoryBtn) {
      validateInventoryBtn.disabled = true;
      validateInventoryBtn.textContent = "⏳ Validation en cours...";
    }

    showFeedback("⏳ Création de la vente inventaire...");

    const currentDepartment = getSafeActiveDepartment();
    if (!currentDepartment?.id) {
      showFeedback("Aucun rayon actif", true);
      return;
    }

    const retained = Array.isArray(previewData.retained_lines) ? previewData.retained_lines : [];
    const includedLines = retained.filter((line) => line.include !== false);
    const unresolvedIncluded = includedLines.filter((line) => !line.resolved);
    const anomaliesPayload = buildAnomaliesPayload();
    const anomaliesWithoutReason = anomaliesPayload.filter((line) => !String(line.reason || line.line_reason || "").trim());

    if (!includedLines.length && !anomaliesPayload.length) {
      showFeedback("Aucune ligne à valider", true);
      return;
    }

    if (anomaliesWithoutReason.length > 0) {
      showFeedback(
        `Motif obligatoire pour les anomalies exclues. (${anomaliesWithoutReason.length} ligne(s) Ã  complÃ©ter)`,
        true
      );
      return;
    }

    if (unresolvedIncluded.length > 0) {
      showFeedback(
        `Certaines lignes en anomalie doivent être corrigées, exclues ou supprimées avant validation. (${unresolvedIncluded.length} ligne(s) à traiter)`,
        true
      );
      return;
    }

    const payload = {
      department_id: currentDepartment.id,
      inventory_date: dateInput.value || null,
      notes: notesInput.value?.trim() || null,
      lines: includedLines,
      anomalies: anomaliesPayload,
    };

    const data = await apiFetch("/api/inventory/create-sale-document", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (data?.sale_id) {
      showFeedback("✅ Inventaire validé, ouverture de la vente...");
      window.location.href = `./sale-detail.html?id=${encodeURIComponent(data.sale_id)}`;
      return;
    }

    showFeedback("✅ Inventaire validé");
  } catch (error) {
    console.error("Erreur validation inventaire :", error);

    if (error.status === 409 && error.code === "INVENTORY_INSUFFICIENT_STOCK") {
      markInsufficientStockLines(error.details);
      renderPreviewTable();
      showFeedback(formatInventoryStockError(error.details), true);
      return;
    }

    showFeedback(error.message || "Erreur validation inventaire", true);
  } finally {
    renderStats();
    if (validateInventoryBtn) {
      validateInventoryBtn.textContent = "✅ Valider inventaire";
    }
  }
}

function validateInventoryAnomalies() {
  const retained = Array.isArray(previewData.retained_lines) ? previewData.retained_lines : [];
  let updatedCount = 0;

  retained.forEach((line, index) => {
    if (!isInventoryProblemLine(line)) return;
    if (line.include !== false) return;
    if (String(line.line_reason || "").trim()) {
      updateLineResolution(index);
      return;
    }

    line.line_reason = "Anomalie stock nul constatée à l'inventaire";
    updateLineResolution(index);
    updatedCount += 1;
  });

  renderStats();
  renderPreviewTable();

  if (updatedCount > 0) {
    showFeedback("Anomalies validées avec motif par défaut");
  } else {
    showFeedback("Aucune anomalie sans motif à valider");
  }
}

function clearPreview() {
  resetPreviewData();
  renderStats();
  renderPreviewTable();
  clearFeedback();

  if (validateInventoryBtn) {
    validateInventoryBtn.disabled = true;
  }
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

if (importBtn) {
  importBtn.addEventListener("click", previewImport);
}

if (manualInventoryBtn) {
  manualInventoryBtn.addEventListener("click", loadManualInventoryPreview);
}

if (validateInventoryBtn) {
  validateInventoryBtn.addEventListener("click", validateInventory);
}

if (validateAnomaliesBtn) {
  validateAnomaliesBtn.addEventListener("click", validateInventoryAnomalies);
}

if (clearPreviewBtn) {
  clearPreviewBtn.addEventListener("click", clearPreview);
}

if (inventorySearchInput) {
  inventorySearchInput.addEventListener("input", applyInventorySearchFilter);
}

if (inventoryTableBody) {
  inventoryTableBody.addEventListener("input", (event) => {
    const row = event.target.closest("tr[data-line-index]");
    if (!row) return;

    const index = Number(row.dataset.lineIndex);
    if (!Number.isFinite(index)) return;

   if (
  event.target.classList.contains("inv-sold-quantity") ||
  event.target.classList.contains("inv-remaining-quantity") ||
  event.target.classList.contains("inv-unit-price-ttc") ||
  event.target.classList.contains("inv-line-reason") ||
  event.target.classList.contains("inv-article-plu")
) {
  syncComputedLine(index);
}
  });

  inventoryTableBody.addEventListener("change", (event) => {
    const row = event.target.closest("tr[data-line-index]");
    if (!row) return;

    const index = Number(row.dataset.lineIndex);
    if (!Number.isFinite(index)) return;

    if (
      event.target.classList.contains("inv-sale-unit") ||
      event.target.classList.contains("inv-include-line")
    ) {
      syncComputedLine(index);
    }
  });

  inventoryTableBody.addEventListener("keydown", (event) => {
  const input = event.target;

  if (!input.classList.contains("inv-remaining-quantity")) return;
  if (!["Tab", "Enter"].includes(event.key)) return;
  if (event.shiftKey) return;

  event.preventDefault();

  const row = input.closest("tr[data-line-index]");
  if (!row) return;

  const index = Number(row.dataset.lineIndex);
  if (!Number.isFinite(index)) return;

  syncComputedLine(index);
  focusNextRemainingInput(input);
});

  inventoryTableBody.addEventListener("click", (event) => {
    const row = event.target.closest("tr[data-line-index]");
    if (!row) return;

    const index = Number(row.dataset.lineIndex);
    if (!Number.isFinite(index)) return;

    if (event.target.classList.contains("inv-delete-line")) {
      if (confirm("Supprimer cette ligne de l'inventaire ?")) {
        deleteLine(index);
      }
    }
  });
}

function applyInventorySearchFilter() {
  if (!inventoryTableBody || !inventorySearchInput) return;

  const term = (inventorySearchInput.value || "").trim().toLowerCase();
  const rows = inventoryTableBody.querySelectorAll("tr[data-line-index]");

  rows.forEach((row) => {
    const haystack = row.dataset.search || "";
    row.style.display = !term || haystack.includes(term) ? "" : "none";
  });
}

function getVisibleRemainingInputs() {
  return Array.from(document.querySelectorAll(".inv-remaining-quantity"))
    .filter((input) => {
      const row = input.closest("tr");
      return row && row.style.display !== "none";
    });
}

function focusNextRemainingInput(currentInput) {
  const inputs = getVisibleRemainingInputs();
  const currentIndex = inputs.indexOf(currentInput);

  if (currentIndex === -1) return;

  const nextInput = inputs[currentIndex + 1];

  if (nextInput) {
    nextInput.focus();
    nextInput.select();
  }
}

function initDefaultDate() {
  if (!dateInput) return;
  if (dateInput.value) return;

  const now = new Date();
  const iso = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);

  dateInput.value = iso;
}

function init() {
  renderTopbar();
  renderDepartmentSelector();
  initDefaultDate();
  resetPreviewData();
  renderStats();
  renderPreviewTable();
}

init();
