const token = localStorage.getItem("gc_token");
const sessionUser = JSON.parse(localStorage.getItem("gc_user") || "null");
const activeDepartment = JSON.parse(localStorage.getItem("gc_active_department") || "null");

if (!token || !sessionUser) {
  window.location.href = "./login.html";
}

const API_BASE = window.APP_CONFIG.API_BASE_URL;
const FRONT_BASE = window.APP_CONFIG.FRONT_BASE_URL;
const params = new URLSearchParams(window.location.search);
const purchaseId = params.get("id");

if (!purchaseId) {
  window.location.href = "./purchases.html";
}

const userNameEl = document.getElementById("user-name");
const logoutBtn = document.getElementById("logout-btn");
const backPurchasesBtn = document.getElementById("back-purchases-btn");
const departmentSelect = document.getElementById("topbar-department-select");
const currentDepartmentNameEl = document.getElementById("current-department-name");

const savePurchaseBtn = document.getElementById("save-purchase-btn");
const validateReceptionBtn = document.getElementById("validate-reception-btn");
const addLineBtn = document.getElementById("add-line-btn");

const openQrModalBtn = document.getElementById("open-qr-modal-btn");
const qrModal = document.getElementById("qr-modal");
const closeQrModalBtn = document.getElementById("close-qr-modal-btn");
const printQrBtn = document.getElementById("print-qr-btn");
const copyQrLinkBtn = document.getElementById("copy-qr-link-btn");
const qrSupplierNameEl = document.getElementById("qr-supplier-name");
const qrBlNumberEl = document.getElementById("qr-bl-number");
const qrTargetUrlInput = document.getElementById("qr-target-url");
const purchaseQrCodeEl = document.getElementById("purchase-qr-code");

const purchaseHeaderFeedback = document.getElementById("purchase-header-feedback");
const purchaseLinesFeedback = document.getElementById("purchase-lines-feedback");

const purchaseOrderDateInput = document.getElementById("purchase-order-date");
const purchaseReceiptDateInput = document.getElementById("purchase-receipt-date");
const purchaseSupplierNameInput = document.getElementById("purchase-supplier-name");
const purchaseTypeInput = document.getElementById("purchase-type");
const purchaseStatusInput = document.getElementById("purchase-status");
const purchaseBlNumberInput = document.getElementById("purchase-bl-number");
const purchaseInvoiceNumberInput = document.getElementById("purchase-invoice-number");
const purchaseNotesInput = document.getElementById("purchase-notes");
const purchaseTotalHTEl = document.getElementById("purchase-total-ht");
const MANUAL_HEADER_STATUSES = ["ordered", "cancelled"];
const SYSTEM_STATUSES = ["received", "closed"];

const purchaseLinesTableBody = document.getElementById("purchase-lines-table-body");
const linesModeLabel = document.getElementById("lines-mode-label");

const articleModal = document.getElementById("article-modal");
const closeArticleModalBtn = document.getElementById("close-article-modal-btn");
const articleSearchInput = document.getElementById("article-search-input");
const articleSectorFilter = document.getElementById("article-sector-filter");
const articleActiveFilter = document.getElementById("article-active-filter");
const refreshArticleModalBtn = document.getElementById("refresh-article-modal-btn");
const articleModalTableBody = document.getElementById("article-modal-table-body");

const lineSheetModal = document.getElementById("line-sheet-modal");
const closeLineSheetModalBtn = document.getElementById("close-line-sheet-modal-btn");
const saveLineSheetBtn = document.getElementById("save-line-sheet-btn");
const lineSheetFeedback = document.getElementById("line-sheet-feedback");

const sheetLinePluInput = document.getElementById("sheet-line-plu");
const sheetLineArticleInput = document.getElementById("sheet-line-article");
const sheetLineDlcInput = document.getElementById("sheet-line-dlc");
const sheetLineLotNumberInput = document.getElementById("sheet-line-lot-number");
const sheetLineLatinNameInput = document.getElementById("sheet-line-latin-name");
const sheetLineFaoZoneInput = document.getElementById("sheet-line-fao-zone");
const sheetLineSousZoneInput = document.getElementById("sheet-line-sous-zone");
const sheetLineFishingGearInput = document.getElementById("sheet-line-fishing-gear");
const sheetLineOriginLabelInput = document.getElementById("sheet-line-origin-label");
const sheetLineAllergensInput = document.getElementById("sheet-line-allergens");
const sheetLinePhotoUrlInput = document.getElementById("sheet-line-photo-url");
const sheetLineNotesInput = document.getElementById("sheet-line-notes");
const sheetLinePhotoPreviewWrap = document.getElementById("sheet-line-photo-preview-wrap");
const sheetLinePhotoPreview = document.getElementById("sheet-line-photo-preview");
const sheetLinePhotoEmpty = document.getElementById("sheet-line-photo-empty");
const sheetLinePhotoCount = document.getElementById("sheet-line-photo-count");
const sheetLinePhotoGallery = document.getElementById("sheet-line-photo-gallery");

let purchase = null;
let lines = [];
let articleModalItems = [];
let currentEditingLineId = null;
let currentSheetLineId = null;
let currentSheetLinePhotoUrlsRaw = '[]';

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

function parseSanitaryPhotoUrls(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.filter(Boolean).map(String);
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(Boolean).map(String);
      }
    } catch (error) {
      // fallback to string value
    }
    return raw ? [raw] : [];
  }
  return [];
}

function getSanitaryPhotoUrlsForLine(row) {
  const urls = parseSanitaryPhotoUrls(row.dataset.sanitaryPhotoUrls || '[]');
  const primaryUrl = row.dataset.sanitaryPhotoUrl || '';
  if (primaryUrl) {
    urls.unshift(primaryUrl);
  }
  return urls.filter(Boolean).reduce((acc, url) => {
    if (!acc.includes(url)) acc.push(url);
    return acc;
  }, []);
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

function numOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function apiQuantityFieldBase() {
  const realStatus = purchase?.status || "ordered";
  if (realStatus === "received" || realStatus === "closed") {
    return "received";
  }
  return "ordered";
}

function getModeLabel() {
  const realStatus = purchase?.status || "ordered";

  if (realStatus === "received") {
  return "Achat réceptionné : correction encore autorisée tant que l'achat n'est pas clôturé.";
}

  if (realStatus === "closed") {
    return "Achat clôturé : aucune modification autorisée.";
  }

  if (realStatus === "cancelled") {
    return "Achat annulé : aucune modification autorisée.";
  }

  return "Mode commande : tu modifies les quantités commandées.";
}

function getDisplayedHeaderStatus(realStatus) {
  if (realStatus === "received" || realStatus === "closed") {
    return "ordered";
  }

  if (realStatus === "cancelled") {
    return "cancelled";
  }

  return "ordered";
}

function isPurchaseLocked() {
  return purchase?.status === "closed" || purchase?.status === "cancelled";
}

function syncHeaderStatusUi() {
  const realStatus = purchase?.status || "ordered";
  purchaseStatusInput.value = getDisplayedHeaderStatus(realStatus);

  const locked = isPurchaseLocked();

  purchaseStatusInput.disabled = realStatus === "received" || realStatus === "closed";
  purchaseTypeInput.disabled = locked;
  purchaseOrderDateInput.disabled = locked;
  purchaseReceiptDateInput.disabled = realStatus === "closed";
  purchaseBlNumberInput.disabled = locked;
  purchaseInvoiceNumberInput.disabled = locked;
  purchaseNotesInput.disabled = locked;

  savePurchaseBtn.disabled = locked;
  addLineBtn.disabled = locked;
  validateReceptionBtn.disabled = realStatus !== "ordered";

  if (realStatus === "received") {
  linesModeLabel.textContent = "Achat réceptionné : correction encore autorisée tant que l'achat n'est pas clôturé.";
}else if (realStatus === "closed") {
    linesModeLabel.textContent = "Achat clôturé : aucune modification autorisée.";
  } else if (realStatus === "cancelled") {
    linesModeLabel.textContent = "Achat annulé : aucune modification autorisée.";
  } else {
    linesModeLabel.textContent = "Mode commande : tu modifies les quantités commandées.";
  }
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

function getSanitaryPhotoUrl(path) {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${API_BASE}${path}`;
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

async function loadPurchase() {
  clearFeedback(purchaseHeaderFeedback);
  clearFeedback(purchaseLinesFeedback);

  const data = await apiFetch(`/api/purchases/${purchaseId}`);
  purchase = data.purchase;
  lines = Array.isArray(data.lines) ? data.lines : [];

  renderPurchaseHeader();
  renderLinesTable();
  refreshDisplayedPurchaseTotal();
}

function renderPurchaseHeader() {
  purchaseOrderDateInput.value = formatDateForInput(purchase.order_date);
  purchaseReceiptDateInput.value = formatDateForInput(purchase.receipt_date);
  purchaseSupplierNameInput.value = purchase.supplier_name || "";
  purchaseTypeInput.value = purchase.purchase_type || "order";
  purchaseBlNumberInput.value = purchase.bl_number || "";
  purchaseInvoiceNumberInput.value = purchase.invoice_number || "";
  purchaseNotesInput.value = purchase.notes || "";

  const totalValue = purchase.total_amount_ex_vat ?? lines.reduce((sum, line) => sum + Number(line.line_amount_ex_vat || 0), 0);
  if (purchaseTotalHTEl) {
    purchaseTotalHTEl.textContent = formatCurrency(totalValue);
  }

  syncHeaderStatusUi();
}

function getPhotoBlMobileUrl() {
  return `${FRONT_BASE}/photo-bl.html?purchaseId=${encodeURIComponent(purchaseId)}`;
}

function buildQrLabelSupplier() {
  return purchase?.supplier_name || "Fournisseur inconnu";
}

function buildQrLabelBl() {
  return `BL ${purchase?.bl_number || "-"}`;
}

function openQrModal() {
  if (!purchase) return;

  const targetUrl = getPhotoBlMobileUrl();

  qrSupplierNameEl.textContent = buildQrLabelSupplier();
  qrBlNumberEl.textContent = buildQrLabelBl();
  qrTargetUrlInput.value = targetUrl;

  purchaseQrCodeEl.innerHTML = "";

  new QRCode(purchaseQrCodeEl, {
    text: targetUrl,
    width: 320,
    height: 320,
  });

  qrModal.classList.remove("hidden");
}

function closeQrModal() {
  qrModal.classList.add("hidden");
}

async function copyQrLink() {
  try {
    await navigator.clipboard.writeText(qrTargetUrlInput.value || "");
    showFeedback(purchaseHeaderFeedback, "Lien photo BL copié");
  } catch (error) {
    console.error("Erreur copie lien QR :", error);
    showFeedback(purchaseHeaderFeedback, "Impossible de copier le lien", true);
  }
}

function printQr() {
  window.print();
}

function getDisplayValue(line, orderedKey, receivedKey) {
  const mode = apiQuantityFieldBase();

  if (mode === "received") {
    if (line[receivedKey] !== null && line[receivedKey] !== undefined) return line[receivedKey];
    if (line[orderedKey] !== null && line[orderedKey] !== undefined) return line[orderedKey];
    return "";
  }

  return line[orderedKey] ?? "";
}

function renderLinesTable() {
  if (!lines.length) {
    purchaseLinesTableBody.innerHTML = `
      <tr>
        <td colspan="11">Aucune ligne</td>
      </tr>
    `;
    refreshDisplayedPurchaseTotal();
    return;
  }

  const locked = isPurchaseLocked();
const receivedView = purchase?.status === "closed";
const metadataReadonly = purchase?.status === "closed" || purchase?.status === "cancelled";

  purchaseLinesTableBody.innerHTML = lines.map((line) => {
    const qtyColis = getDisplayValue(line, "ordered_colis", "received_colis");
    const qtyPieces = getDisplayValue(line, "ordered_pieces", "received_pieces");
    const qtyPoids = getDisplayValue(line, "ordered_quantity", "received_quantity");

    return `
      <tr
  data-line-id="${line.id}"
  data-latin-name="${line.latin_name || ""}"
  data-fao-zone="${line.fao_zone || ""}"
  data-sous-zone="${line.sous_zone || ""}"
  data-fishing-gear="${line.fishing_gear || ""}"
  data-origin-label="${line.origin_label || ""}"
  data-allergens="${line.allergens || ""}"
  data-dlc="${formatDateForInput(line.dlc)}"
  data-supplier-lot-number="${line.supplier_lot_number || ""}"
  data-sanitary-photo-url="${line.sanitary_photo_url || ""}"
  data-sanitary-photo-urls='${JSON.stringify(line.sanitary_photo_urls || [])}'
  data-metadata-notes="${line.metadata_notes || ""}"
  data-selected-article-id="${line.article_id || ""}"
>
        <td>
          <input class="line-input line-plu" type="text" value="${line.article_plu || line.article_code || line.plu || ""}" ${metadataReadonly ? "disabled" : ""} />
        </td>
        <td>
          <input class="line-input line-article-label" type="text" value="${line.article_name || ""}" readonly />
        </td>
        <td>
          <input class="line-input line-qty-colis" type="number" step="0.001" value="${qtyColis ?? ""}" ${metadataReadonly ? "disabled" : ""} />
        </td>
        <td>
          <input class="line-input line-qty-pieces" type="number" step="0.001" value="${qtyPieces ?? ""}" ${metadataReadonly ? "disabled" : ""} />
        </td>
        <td>
          <input class="line-input line-qty-weight" type="number" step="0.001" value="${qtyPoids ?? ""}" ${metadataReadonly ? "disabled" : ""} />
        </td>
        <td>
          <input class="line-input line-total-weight" type="number" step="0.001" readonly />
        </td>
        <td>
          <input class="line-input line-unit-price" type="number" step="0.0001" value="${line.unit_price_ex_vat ?? ""}" ${metadataReadonly ? "disabled" : ""} />
        </td>
        <td>
          <input class="line-input line-line-total" type="number" step="0.0001" value="${line.line_amount_ex_vat ?? ""}" readonly />
        </td>
        <td>
          <select class="line-input line-price-unit" ${metadataReadonly ? "disabled" : ""}>
            <option value="kg" ${line.price_unit === "kg" ? "selected" : ""}>kg</option>
            <option value="piece" ${line.price_unit === "piece" ? "selected" : ""}>pièce</option>
            <option value="colis" ${line.price_unit === "colis" ? "selected" : ""}>colis</option>
          </select>
        </td>
        <td>${line.line_status || "-"}</td>
        <td>
  <div class="page-actions-right">
    <button class="btn btn-secondary btn-sm" data-action="open-line-sheet" data-id="${line.id}">📄</button>
    ${metadataReadonly ? "" : `<button class="btn btn-secondary btn-sm" data-action="search-article" data-id="${line.id}">F9</button>`}
    ${metadataReadonly ? "" : `<button class="btn btn-secondary btn-sm" data-action="save-line" data-id="${line.id}">💾</button>`}
    ${metadataReadonly ? "" : `<button class="btn btn-danger btn-sm" data-action="delete-line" data-id="${line.id}">🗑️</button>`}
  </div>
</td>
      </tr>
    `;
  }).join("");

  const rows = purchaseLinesTableBody.querySelectorAll("tr[data-line-id]");
  rows.forEach((row) => {
    updateLineTotalWeight(row);
    updateLineTotal(row);
  });
  refreshDisplayedPurchaseTotal();
}

async function savePurchaseHeader() {
  clearFeedback(purchaseHeaderFeedback);

  const selectedStatus = purchaseStatusInput.value;
const currentRealStatus = purchase?.status || "ordered";

let finalStatus = currentRealStatus;

if (selectedStatus === "cancelled") {
  finalStatus = "cancelled";
} else if (currentRealStatus === "ordered") {
  finalStatus = "ordered";
}

const payload = {
  order_date: purchaseOrderDateInput.value || null,
  receipt_date: purchaseReceiptDateInput.value || null,
  purchase_type: purchaseTypeInput.value || null,
  status: finalStatus,
  bl_number: purchaseBlNumberInput.value.trim() || null,
  invoice_number: purchaseInvoiceNumberInput.value.trim() || null,
  notes: purchaseNotesInput.value.trim() || null,
};

  await apiFetch(`/api/purchases/${purchaseId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });

  showFeedback(purchaseHeaderFeedback, "En-tête achat enregistré");
  await loadPurchase();
}

async function addLine() {
  clearFeedback(purchaseLinesFeedback);

  if (isPurchaseLocked()) {
  showFeedback(purchaseLinesFeedback, "Ajout impossible sur cet achat", true);
  return;
}

  const payload = {
    article_id: null,
    article_plu: null,
    supplier_ref: null,
    supplier_label: null,
    ordered_colis: null,
    ordered_pieces: null,
    ordered_quantity: null,
    received_colis: null,
    received_pieces: null,
    received_quantity: null,
    unit_price_ex_vat: 0,
    price_unit: "kg",
  };

  await apiFetch(`/api/purchases/${purchaseId}/lines`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  showFeedback(purchaseLinesFeedback, "Ligne ajoutée");
  await loadPurchase();
}

function openArticleModal(lineId) {
  currentEditingLineId = lineId;
  articleModal.classList.remove("hidden");
  articleSearchInput.focus();
  loadArticleModalItems();
}

function closeArticleModal() {
  articleModal.classList.add("hidden");
}

function openLineSheet(lineId) {
  clearFeedback(lineSheetFeedback);

  const row = purchaseLinesTableBody.querySelector(`tr[data-line-id="${lineId}"]`);
  if (!row) return;

  currentSheetLineId = lineId;

  sheetLinePluInput.value = row.querySelector(".line-plu")?.value || "";
  sheetLineArticleInput.value = row.querySelector(".line-article-label")?.value || "";
  sheetLineDlcInput.value = row.dataset.dlc || "";
  sheetLineLotNumberInput.value = row.dataset.supplierLotNumber || "";
  sheetLineLatinNameInput.value = row.dataset.latinName || "";
  sheetLineFaoZoneInput.value = row.dataset.faoZone || "";
  sheetLineSousZoneInput.value = row.dataset.sousZone || "";
  sheetLineFishingGearInput.value = row.dataset.fishingGear || "";
  sheetLineOriginLabelInput.value = row.dataset.originLabel || "";
  sheetLineAllergensInput.value = row.dataset.allergens || "";
  sheetLinePhotoUrlInput.value = row.dataset.sanitaryPhotoUrl || "";
  currentSheetLinePhotoUrlsRaw = row.dataset.sanitaryPhotoUrls || '[]';
  sheetLineNotesInput.value = row.dataset.metadataNotes || "";
    refreshLineSheetPhotoPreview();

  const metadataLocked = purchase?.status === "closed" || purchase?.status === "cancelled";
  sheetLineDlcInput.disabled = metadataLocked;
  sheetLineLotNumberInput.disabled = metadataLocked;
  sheetLineLatinNameInput.disabled = metadataLocked;
  sheetLineFaoZoneInput.disabled = metadataLocked;
  sheetLineSousZoneInput.disabled = metadataLocked;
  sheetLineFishingGearInput.disabled = metadataLocked;
  sheetLineOriginLabelInput.disabled = metadataLocked;
  sheetLineAllergensInput.disabled = metadataLocked;
  sheetLinePhotoUrlInput.disabled = metadataLocked;
  sheetLineNotesInput.disabled = metadataLocked;
  saveLineSheetBtn.disabled = metadataLocked;

  lineSheetModal.classList.remove("hidden");
}

function closeLineSheet() {
  currentSheetLineId = null;
  lineSheetModal.classList.add("hidden");
}

function refreshLineSheetPhotoPreview() {
  const rawUrl = (sheetLinePhotoUrlInput?.value || "").trim();
  const urls = parseSanitaryPhotoUrls(currentSheetLinePhotoUrlsRaw);
  if (rawUrl) {
    if (!urls.includes(rawUrl)) {
      urls.unshift(rawUrl);
    } else {
      urls.unshift(rawUrl, ...urls.filter((url) => url !== rawUrl));
    }
  }

  const finalUrls = urls.filter(Boolean).reduce((acc, url) => {
    if (!acc.includes(url)) acc.push(url);
    return acc;
  }, []);

  if (finalUrls.length === 0) {
    sheetLinePhotoPreviewWrap?.classList.add("hidden");
    sheetLinePhotoEmpty?.classList.remove("hidden");
    if (sheetLinePhotoPreview) sheetLinePhotoPreview.src = "";
    if (sheetLinePhotoCount) sheetLinePhotoCount.classList.add("hidden");
    if (sheetLinePhotoGallery) sheetLinePhotoGallery.classList.add("hidden");
    return;
  }

  const firstUrl = getSanitaryPhotoUrl(finalUrls[0]);
  if (!firstUrl) {
    sheetLinePhotoPreviewWrap?.classList.add("hidden");
    sheetLinePhotoEmpty?.classList.remove("hidden");
    if (sheetLinePhotoPreview) sheetLinePhotoPreview.src = "";
    if (sheetLinePhotoCount) sheetLinePhotoCount.classList.add("hidden");
    if (sheetLinePhotoGallery) sheetLinePhotoGallery.classList.add("hidden");
    return;
  }

  if (sheetLinePhotoPreview) {
    sheetLinePhotoPreview.src = firstUrl;
    sheetLinePhotoPreview.classList.remove("line-sheet-large-photo-zoomed");
  }

  if (sheetLinePhotoCount) {
    sheetLinePhotoCount.textContent = `${finalUrls.length} photo(s)`;
    sheetLinePhotoCount.classList.remove("hidden");
  }

  if (sheetLinePhotoGallery) {
    sheetLinePhotoGallery.innerHTML = finalUrls
      .map(
        (photoUrl) => `
          <img
  src="${getSanitaryPhotoUrl(photoUrl)}"
  alt="Photo sanitaire"
  class="line-photo-thumb"
  data-photo-url="${getSanitaryPhotoUrl(photoUrl)}"
/>
        `
      )
      .join("");
    sheetLinePhotoGallery.classList.remove("hidden");
  }

  sheetLinePhotoPreviewWrap?.classList.remove("hidden");
  sheetLinePhotoEmpty?.classList.add("hidden");
}

async function saveLineSheet() {
  clearFeedback(lineSheetFeedback);

  if (!currentSheetLineId) return;

  const row = purchaseLinesTableBody.querySelector(`tr[data-line-id="${currentSheetLineId}"]`);
  if (!row) return;

  row.dataset.dlc = sheetLineDlcInput.value || "";
  row.dataset.supplierLotNumber = sheetLineLotNumberInput.value.trim() || "";
  row.dataset.latinName = sheetLineLatinNameInput.value.trim() || "";
  row.dataset.faoZone = sheetLineFaoZoneInput.value.trim() || "";
  row.dataset.sousZone = sheetLineSousZoneInput.value.trim() || "";
  row.dataset.fishingGear = sheetLineFishingGearInput.value.trim() || "";
  row.dataset.originLabel = sheetLineOriginLabelInput.value.trim() || "";
  row.dataset.allergens = sheetLineAllergensInput.value.trim() || "";
  row.dataset.sanitaryPhotoUrl = sheetLinePhotoUrlInput.value.trim() || "";
  row.dataset.metadataNotes = sheetLineNotesInput.value.trim() || "";

  try {
    await saveLine(currentSheetLineId);
    showFeedback(lineSheetFeedback, "Fiche ligne enregistrée");
    await loadPurchase();
    openLineSheet(currentSheetLineId);
  } catch (error) {
    console.error("Erreur saveLineSheet :", error);
    showFeedback(lineSheetFeedback, error.message || "Erreur enregistrement fiche", true);
  }
}

async function loadArticleModalItems() {
  const currentDepartment = getSafeActiveDepartment();
  const params = new URLSearchParams();

  params.set("limit", "200");
  if (articleSearchInput.value.trim()) params.set("search", articleSearchInput.value.trim());
  if (articleSectorFilter.value) params.set("sector", articleSectorFilter.value);
  if (articleActiveFilter.value !== "") params.set("active", articleActiveFilter.value);
  if (currentDepartment?.id) params.set("department_id", currentDepartment.id);

  articleModalItems = await apiFetch(`/api/articles?${params.toString()}`);
  renderArticleModalTable();
}

function renderArticleModalTable() {
  if (!Array.isArray(articleModalItems) || articleModalItems.length === 0) {
    articleModalTableBody.innerHTML = `<tr><td colspan="5">Aucun article trouvé</td></tr>`;
    return;
  }

  articleModalTableBody.innerHTML = articleModalItems.map((article) => `
    <tr data-article-id="${article.id}">
      <td>${article.plu || "-"}</td>
      <td>${article.designation || "-"}</td>
      <td>${article.department_name || "-"}</td>
      <td>${article.sector_code || "-"}</td>
      <td>${article.unit || "-"}</td>
    </tr>
  `).join("");
}

function normalizePriceUnitFromArticle(article) {
  const raw =
    String(
      article?.purchase_unit ||
      article?.unit ||
      ""
    )
      .trim()
      .toLowerCase();

  if (!raw) return "kg";

  if (["piece", "pièce", "pieces", "pièces", "pcs", "pc", "unite", "unité"].includes(raw)) {
    return "piece";
  }

  if (["colis", "box", "carton", "cartons"].includes(raw)) {
    return "colis";
  }

  return "kg";
}

function selectArticle(article) {
  if (!currentEditingLineId) return;

  const row = purchaseLinesTableBody.querySelector(`tr[data-line-id="${currentEditingLineId}"]`);
  if (!row) return;

  row.querySelector(".line-plu").value = article.plu || "";
  row.querySelector(".line-article-label").value = article.designation || "";

  const unitSelect = row.querySelector(".line-price-unit");
if (unitSelect) {
  unitSelect.value = normalizePriceUnitFromArticle(article);
}

  row.dataset.latinName = article.latin_name || "";
  row.dataset.faoZone = article.fao_zone || "";
  row.dataset.sousZone = article.sous_zone || "";
  row.dataset.fishingGear = article.engin || "";
  row.dataset.originLabel = article.category || "";
  row.dataset.allergens = article.allergenes || "";
  row.dataset.selectedArticleId = article.id;

  updateLineTotal(row);

  closeArticleModal();
}

async function resolveArticleByPlu(row) {
  const articlePlu = row.querySelector(".line-plu").value.trim();
  const labelInput = row.querySelector(".line-article-label");

  if (!articlePlu) {
    row.dataset.selectedArticleId = "";
    labelInput.value = "";
    row.dataset.latinName = "";
    row.dataset.faoZone = "";
    row.dataset.sousZone = "";
    row.dataset.fishingGear = "";
    row.dataset.originLabel = "";
    row.dataset.allergens = "";
    return;
  }

  try {
    const currentDepartment = getSafeActiveDepartment();
    const params = new URLSearchParams();
    params.set("search", articlePlu);
    params.set("limit", "50");

    if (currentDepartment?.id) {
      params.set("department_id", currentDepartment.id);
    }

    const results = await apiFetch(`/api/articles?${params.toString()}`);

    const exact = Array.isArray(results)
      ? results.find((article) => String(article.plu || "").trim() === articlePlu)
      : null;

    if (exact) {
      row.dataset.selectedArticleId = exact.id;
      row.querySelector(".line-plu").value = exact.plu || articlePlu;
      labelInput.value = exact.designation || "";

      const unitSelect = row.querySelector(".line-price-unit");
if (unitSelect) {
  unitSelect.value = normalizePriceUnitFromArticle(exact);
}

      row.dataset.latinName = exact.latin_name || "";
      row.dataset.faoZone = exact.fao_zone || "";
      row.dataset.sousZone = exact.sous_zone || "";
      row.dataset.fishingGear = exact.engin || "";
      row.dataset.originLabel = exact.category || "";
      row.dataset.allergens = exact.allergenes || "";

      updateLineTotal(row);
    } else {
      row.dataset.selectedArticleId = "";
      labelInput.value = "";
      row.dataset.latinName = "";
      row.dataset.faoZone = "";
      row.dataset.sousZone = "";
      row.dataset.fishingGear = "";
      row.dataset.originLabel = "";
      row.dataset.allergens = "";
    }
  } catch (error) {
    console.error("Erreur recherche PLU :", error);
    row.dataset.selectedArticleId = "";
    labelInput.value = "";
  }
}

function updateLineTotal(row) {
  updateLineTotalWeight(row);

  const qtyColis = Number(row.querySelector(".line-qty-colis")?.value || 0);
  const qtyPieces = Number(row.querySelector(".line-qty-pieces")?.value || 0);
  const qtyWeight = Number(row.querySelector(".line-qty-weight")?.value || 0);
  const unitPrice = Number(row.querySelector(".line-unit-price")?.value || 0);
  const priceUnit = row.querySelector(".line-price-unit")?.value || "kg";
  const totalInput = row.querySelector(".line-line-total");

  if (!totalInput) return;

  let baseQty = 0;

  if (priceUnit === "piece") {
    baseQty = qtyColis > 0 && qtyPieces > 0 ? qtyColis * qtyPieces : qtyPieces;
  } else if (priceUnit === "colis") {
    baseQty = qtyColis;
  } else {
    baseQty = qtyColis > 0 && qtyWeight > 0 ? qtyColis * qtyWeight : qtyWeight;
  }

  const total = baseQty * unitPrice;
  totalInput.value = total ? total.toFixed(4) : "";
  refreshDisplayedPurchaseTotal();
}

function updateLineTotalWeight(row) {
  const qtyColis = Number(row.querySelector(".line-qty-colis")?.value || 0);
  const qtyPieces = Number(row.querySelector(".line-qty-pieces")?.value || 0);
  const qtyWeight = Number(row.querySelector(".line-qty-weight")?.value || 0);
  const priceUnit = row.querySelector(".line-price-unit")?.value || "kg";
  const totalInput = row.querySelector(".line-total-weight");

  if (!totalInput) return;

  let totalWeight = 0;

  if (priceUnit === "piece") {
    totalWeight = qtyColis > 0 && qtyPieces > 0 ? qtyColis * qtyPieces : qtyPieces;
  } else if (priceUnit === "colis") {
    totalWeight = qtyColis;
  } else {
    totalWeight = qtyColis > 0 && qtyWeight > 0 ? qtyColis * qtyWeight : qtyWeight;
  }

  totalInput.value = totalWeight ? totalWeight.toFixed(3) : "";
}

function refreshDisplayedPurchaseTotal() {
  if (!purchaseTotalHTEl) return;

  const total = Array.from(purchaseLinesTableBody.querySelectorAll(".line-line-total"))
    .reduce((sum, input) => sum + Number(input.value || 0), 0);

  purchaseTotalHTEl.textContent = formatCurrency(total);
}

async function saveLine(lineId) {
  clearFeedback(purchaseLinesFeedback);

  if (isPurchaseLocked()) {
    showFeedback(purchaseLinesFeedback, "Achat verrouillé", true);
    return;
  }

  if (purchase?.status === "closed" || purchase?.status === "cancelled") {
  showFeedback(purchaseLinesFeedback, "Achat verrouillé", true);
  return;
}

  const row = purchaseLinesTableBody.querySelector(`tr[data-line-id="${lineId}"]`);
  if (!row) return;

  const articleId = row.dataset.selectedArticleId || null;
  const articlePlu = row.querySelector(".line-plu").value.trim() || null;

  if (!articleId && !articlePlu) {
    showFeedback(purchaseLinesFeedback, "Saisis un PLU ou utilise F9", true);
    return;
  }

  const qtyColis = numOrNull(row.querySelector(".line-qty-colis").value);
  const qtyPieces = numOrNull(row.querySelector(".line-qty-pieces").value);
  const qtyWeight = numOrNull(row.querySelector(".line-qty-weight").value);

  const payload = {
  article_id: articleId,
  article_plu: !articleId ? articlePlu : null,

  unit_price_ex_vat: numOrNull(row.querySelector(".line-unit-price").value) ?? 0,
  price_unit: row.querySelector(".line-price-unit").value || "kg",
  line_amount_ex_vat: numOrNull(row.querySelector(".line-line-total").value) ?? 0,

  latin_name: row.dataset.latinName || null,
  fao_zone: row.dataset.faoZone || null,
  sous_zone: row.dataset.sousZone || null,
  fishing_gear: row.dataset.fishingGear || null,
  origin_label: row.dataset.originLabel || null,
  allergens: row.dataset.allergens || null,
  dlc: row.dataset.dlc || null,
  supplier_lot_number: row.dataset.supplierLotNumber || null,
  sanitary_photo_url: row.dataset.sanitaryPhotoUrl || null,
  metadata_notes: row.dataset.metadataNotes || null,
};

  if (apiQuantityFieldBase() === "received") {
    payload.received_colis = qtyColis;
    payload.received_pieces = qtyPieces;
    payload.received_quantity = qtyWeight;
  } else {
    payload.ordered_colis = qtyColis;
    payload.ordered_pieces = qtyPieces;
    payload.ordered_quantity = qtyWeight;
  }

  const data = await apiFetch(`/api/purchase-lines/${lineId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });

  if (data?.article) {
    row.querySelector(".line-article-label").value = data.article.designation || "";
    row.querySelector(".line-plu").value = data.article.plu || articlePlu || "";
    row.dataset.selectedArticleId = data.article.id;
    row.dataset.latinName = data.article.latin_name || row.dataset.latinName || "";
    row.dataset.faoZone = data.article.fao_zone || row.dataset.faoZone || "";
    row.dataset.sousZone = data.article.sous_zone || row.dataset.sousZone || "";
    row.dataset.fishingGear = data.article.engin || row.dataset.fishingGear || "";
    row.dataset.originLabel = data.article.category || row.dataset.originLabel || "";
    row.dataset.allergens = data.article.allergenes || row.dataset.allergens || "";
  }

  showFeedback(purchaseLinesFeedback, "Ligne enregistrée");
  await loadPurchase();
}

async function deleteLine(lineId) {
  clearFeedback(purchaseLinesFeedback);

  if (isPurchaseLocked()) {
  showFeedback(purchaseLinesFeedback, "Suppression impossible sur cet achat", true);
  return;
}

  if (!confirm("Supprimer cette ligne ?")) return;

  await apiFetch(`/api/purchase-lines/${lineId}`, {
    method: "DELETE",
  });
  await loadPurchase();

  showFeedback(purchaseLinesFeedback, "Ligne supprimée");
}

async function saveLineAndCreateNext(lineId) {
  if (isPurchaseLocked()) {
  showFeedback(purchaseLinesFeedback, "Action impossible sur cet achat", true);
  return;
}

  await saveLine(lineId);
  await addLine();

  const rows = purchaseLinesTableBody.querySelectorAll("tr[data-line-id]");
  const lastRow = rows[rows.length - 1];
  if (!lastRow) return;

  const pluInput = lastRow.querySelector(".line-plu");
  if (pluInput) {
    pluInput.focus();
    pluInput.select();
  }
}

async function validateReception() {
  clearFeedback(purchaseLinesFeedback);

  if (purchase?.status !== "ordered") {
    showFeedback(
      purchaseLinesFeedback,
      "Seul un achat en statut Commandé peut être réceptionné.",
      true
    );
    return;
  }

  if (!confirm("Confirmer la validation de la réception ?")) {
    return;
  }

  const originalButtonText = validateReceptionBtn?.textContent;
  if (validateReceptionBtn) {
    validateReceptionBtn.disabled = true;
    validateReceptionBtn.textContent = "Validation réception en cours...";
  }
  showFeedback(purchaseLinesFeedback, "Validation réception en cours...");

  try {
    for (const line of lines) {
      await saveLine(line.id);
    }

    const data = await apiFetch(`/api/purchases/${purchaseId}/validate-reception`, {
      method: "POST",
      body: JSON.stringify({
        receipt_date: purchaseReceiptDateInput.value || null
      }),
    });

    showFeedback(
      purchaseLinesFeedback,
      data?.message || "Réception validée",
      false
    );

    await loadPurchase();
  } catch (error) {
    console.error("Erreur validation réception :", error);
    showFeedback(
      purchaseLinesFeedback,
      error.message || "Erreur validation réception",
      true
    );
  } finally {
    if (validateReceptionBtn) {
      validateReceptionBtn.disabled = false;
      if (originalButtonText !== undefined) {
        validateReceptionBtn.textContent = originalButtonText;
      }
    }
  }
}

function handleF9(event) {
  if (event.key !== "F9") return;

  const row = event.target.closest("tr[data-line-id]");
  if (!row) return;

  event.preventDefault();
  openArticleModal(row.dataset.lineId);
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", () => {
    localStorage.removeItem("gc_token");
    localStorage.removeItem("gc_user");
    localStorage.removeItem("gc_active_department");
    window.location.href = "./login.html";
  });
}

if (sheetLinePhotoUrlInput) {
  sheetLinePhotoUrlInput.addEventListener("input", refreshLineSheetPhotoPreview);
}

if (backPurchasesBtn) {
  backPurchasesBtn.addEventListener("click", () => {
    window.location.href = "./purchases.html";
  });
}

if (savePurchaseBtn) {
  savePurchaseBtn.addEventListener("click", savePurchaseHeader);
}

if (validateReceptionBtn) {
  validateReceptionBtn.addEventListener("click", validateReception);
}

if (addLineBtn) {
  addLineBtn.addEventListener("click", addLine);
}

if (closeArticleModalBtn) {
  closeArticleModalBtn.addEventListener("click", closeArticleModal);
}

if (articleSearchInput) {
  articleSearchInput.addEventListener("input", loadArticleModalItems);
}

if (articleSectorFilter) {
  articleSectorFilter.addEventListener("change", loadArticleModalItems);
}

if (articleActiveFilter) {
  articleActiveFilter.addEventListener("change", loadArticleModalItems);
}

if (refreshArticleModalBtn) {
  refreshArticleModalBtn.addEventListener("click", loadArticleModalItems);
}

if (articleModalTableBody) {
  articleModalTableBody.addEventListener("dblclick", (event) => {
    const row = event.target.closest("tr[data-article-id]");
    if (!row) return;

    const article = articleModalItems.find((item) => item.id === row.dataset.articleId);
    if (!article) return;

    selectArticle(article);
  });
}

if (purchaseLinesTableBody) {
  purchaseLinesTableBody.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;

    const action = button.dataset.action;
    const lineId = button.dataset.id;

    if (action === "open-line-sheet") {
  openLineSheet(lineId);
  return;
}

    if (action === "search-article") {
      openArticleModal(lineId);
      return;
    }

    if (action === "save-line") {
      await saveLine(lineId);
      return;
    }

    if (action === "delete-line") {
      await deleteLine(lineId);
    }
  });
}

if (purchaseLinesTableBody) {
  purchaseLinesTableBody.addEventListener(
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

if (sheetLinePhotoGallery) {
  sheetLinePhotoGallery.addEventListener("click", (event) => {
    const thumb = event.target.closest(".line-photo-thumb");
    if (!thumb || !sheetLinePhotoPreview) return;

    sheetLinePhotoPreview.src = thumb.dataset.photoUrl || thumb.src;
    sheetLinePhotoPreview.classList.remove("line-sheet-large-photo-zoomed");
  });
}

if (sheetLinePhotoPreview) {
  sheetLinePhotoPreview.addEventListener("click", () => {
    sheetLinePhotoPreview.classList.toggle("line-sheet-large-photo-zoomed");
  });
}

if (closeLineSheetModalBtn) {
  closeLineSheetModalBtn.addEventListener("click", closeLineSheet);
}

if (saveLineSheetBtn) {
  saveLineSheetBtn.addEventListener("click", saveLineSheet);
}

if (purchaseLinesTableBody) {
  purchaseLinesTableBody.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;

    const row = event.target.closest("tr[data-line-id]");
    if (!row) return;

    event.preventDefault();
    await saveLineAndCreateNext(row.dataset.lineId);
  });
}

if (purchaseLinesTableBody) {
  purchaseLinesTableBody.addEventListener("input", (event) => {
    const row = event.target.closest("tr[data-line-id]");
    if (!row) return;

    if (
      event.target.classList.contains("line-qty-colis") ||
      event.target.classList.contains("line-qty-pieces") ||
      event.target.classList.contains("line-qty-weight") ||
      event.target.classList.contains("line-unit-price") ||
      event.target.classList.contains("line-price-unit")
    ) {
      updateLineTotal(row);
    }
  });
}

if (openQrModalBtn) {
  openQrModalBtn.addEventListener("click", openQrModal);
}

if (closeQrModalBtn) {
  closeQrModalBtn.addEventListener("click", closeQrModal);
}

if (printQrBtn) {
  printQrBtn.addEventListener("click", printQr);
}

if (copyQrLinkBtn) {
  copyQrLinkBtn.addEventListener("click", copyQrLink);
}

if (qrModal) {
  qrModal.addEventListener("click", (event) => {
    if (event.target === qrModal) {
      closeQrModal();
    }
  });
}

if (purchaseStatusInput) {
  purchaseStatusInput.addEventListener("change", () => {
    const selectedStatus = purchaseStatusInput.value;

    if (selectedStatus === "cancelled" && purchase?.status === "received") {
      purchaseStatusInput.value = "ordered";
      showFeedback(
        purchaseHeaderFeedback,
        "Un achat déjà reçu ne peut pas être annulé manuellement.",
        true
      );
      return;
    }

    if (linesModeLabel) {
      linesModeLabel.textContent = getModeLabel();
    }
  });
}

document.addEventListener("keydown", handleF9);

async function init() {
  try {
    renderTopbar();
    renderDepartmentSelector();
    await loadPurchase();
  } catch (error) {
    console.error("Erreur init détail achat :", error);
    showFeedback(purchaseLinesFeedback, error.message || "Erreur chargement achat", true);
  }
}

init();
