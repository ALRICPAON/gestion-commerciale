const token = localStorage.getItem("gc_token") || localStorage.getItem("grv2_token");
const sessionUser = JSON.parse(localStorage.getItem("gc_user") || localStorage.getItem("grv2_user") || "null");

if (!token || !sessionUser) {
  window.location.href = "./login.html";
}

const API_BASE = window.APP_CONFIG.API_BASE_URL;
const MIME_EXTENSIONS = {
  "application/pdf": ".pdf",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "text/csv": ".csv",
};

const userNameEl = document.getElementById("user-name");
const backHomeBtn = document.getElementById("back-home-btn");
const logoutBtn = document.getElementById("logout-btn");
const refreshBtn = document.getElementById("refresh-btn");
const supplierSelect = document.getElementById("supplier-select");
const invoiceNumberInput = document.getElementById("invoice-number-input");
const invoiceDateInput = document.getElementById("invoice-date-input");
const dueDateInput = document.getElementById("due-date-input");
const productTotalInput = document.getElementById("product-total-input");
const feesInput = document.getElementById("fees-input");
const vatInput = document.getElementById("vat-input");
const totalIncInput = document.getElementById("total-inc-input");
const invoiceDocumentInput = document.getElementById("invoice-document-input");
const notesInput = document.getElementById("notes-input");
const createManualBtn = document.getElementById("create-manual-btn");
const importInvoiceBtn = document.getElementById("import-invoice-btn");
const statusFilter = document.getElementById("status-filter");
const searchInput = document.getElementById("search-input");
const invoicesTableBody = document.getElementById("invoices-table-body");
const createFeedback = document.getElementById("create-feedback");
const listFeedback = document.getElementById("list-feedback");
const detailFeedback = document.getElementById("detail-feedback");
const invoiceDetailEmpty = document.getElementById("invoice-detail-empty");
const invoiceDetail = document.getElementById("invoice-detail");
const invoiceSummary = document.getElementById("invoice-summary");
const matchesTableBody = document.getElementById("matches-table-body");
const manualMatchBtn = document.getElementById("manual-match-btn");
const manualMatchPanel = document.getElementById("manual-match-panel");
const reloadManualCandidatesBtn = document.getElementById("reload-manual-candidates-btn");
const manualMatchFeedback = document.getElementById("manual-match-feedback");
const manualInvoiceTotal = document.getElementById("manual-invoice-total");
const manualSelectedTotal = document.getElementById("manual-selected-total");
const manualDifferenceTotal = document.getElementById("manual-difference-total");
const manualCandidatesBody = document.getElementById("manual-candidates-body");
const confirmManualMatchBtn = document.getElementById("confirm-manual-match-btn");
const invoiceDocumentLink = document.getElementById("invoice-document-link");
const autoMatchBtn = document.getElementById("auto-match-btn");
const confirmMatchBtn = document.getElementById("confirm-match-btn");
const validateBtn = document.getElementById("validate-btn");
const validateAdjustBtn = document.getElementById("validate-adjust-btn");
const payloadBtn = document.getElementById("payload-btn");
const deleteInvoiceBtn = document.getElementById("delete-invoice-btn");
const payloadPreview = document.getElementById("payload-preview");

let suppliers = [];
let invoices = [];
let selectedInvoiceId = null;
let selectedInvoice = null;
let manualInvoice = null;
let manualCandidates = [];
let selectedManualPurchaseIds = new Set();

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
  if (!(options.body instanceof FormData)) headers["Content-Type"] = "application/json";

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Erreur API");
  return data;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function filenameFromContentDisposition(header) {
  if (!header) return "facture-fournisseur";
  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1]);
  const classicMatch = header.match(/filename="?([^";]+)"?/i);
  return classicMatch?.[1] || "facture-fournisseur";
}

function extensionFromMime(contentType) {
  const mime = String(contentType || "").split(";")[0].trim().toLowerCase();
  return MIME_EXTENSIONS[mime] || "";
}

function ensureFilenameExtension(fileName, contentType) {
  const cleanName = fileName || "facture-fournisseur";
  if (/\.[a-z0-9]{2,5}$/i.test(cleanName)) return cleanName;
  return `${cleanName}${extensionFromMime(contentType) || ".pdf"}`;
}

function revokeLater(url) {
  window.setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("fr-FR");
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function statusLabel(status) {
  const map = {
    draft: "Brouillon",
    received: "Réceptionné",
    received_pending_invoice: "Attente facture",
    matched: "Rapprochée",
    invoice_matched: "Facture rapprochée",
    invoice_difference: "Écart",
    invoice_validated: "Validée",
    cost_adjusted: "Coût ajusté",
    ready_to_send: "Prête Pennylane",
    sent_to_pennylane: "Envoyée Pennylane",
    pennylane_error: "Erreur Pennylane",
    cancelled: "Annulée",
  };
  return map[status] || status || "-";
}

function matchLabel(status) {
  const map = {
    unmatched: "À contrôler",
    partial: "Partiel",
    matched: "OK",
    discrepancy: "Écart",
  };
  return map[status] || status || "-";
}

function totalExVatValue() {
  return Number(productTotalInput.value || 0) + Number(feesInput.value || 0);
}

async function loadSuppliers() {
  suppliers = await apiFetch("/api/suppliers");
  supplierSelect.innerHTML = `<option value="">Choisir fournisseur</option>`;
  suppliers.forEach((supplier) => {
    const option = document.createElement("option");
    option.value = supplier.id;
    option.textContent = `${supplier.code || ""} ${supplier.name || ""}`.trim();
    supplierSelect.appendChild(option);
  });
}

async function loadInvoices() {
  clearFeedback(listFeedback);
  const params = new URLSearchParams();
  if (statusFilter.value) params.set("status", statusFilter.value);
  if (searchInput.value.trim()) params.set("search", searchInput.value.trim());
  invoices = await apiFetch(`/api/supplier-invoices?${params.toString()}`);
  renderInvoices();
}

function renderInvoices() {
  if (!invoices.length) {
    invoicesTableBody.innerHTML = `<tr><td colspan="8">Aucune facture fournisseur</td></tr>`;
    return;
  }

  invoicesTableBody.innerHTML = invoices.map((invoice) => `
    <tr data-id="${invoice.id}" class="${invoice.id === selectedInvoiceId ? "is-selected" : ""}">
      <td>${formatDate(invoice.invoice_date)}</td>
      <td>${escapeHtml(invoice.supplier_name || "-")}</td>
      <td>${escapeHtml(invoice.invoice_number || "-")}</td>
      <td><span class="invoice-status status-${escapeHtml(invoice.status)}">${statusLabel(invoice.status)}</span></td>
      <td>${matchLabel(invoice.match_status)}</td>
      <td>${formatCurrency(invoice.total_ex_vat)}</td>
      <td>${formatCurrency(invoice.total_inc_vat)}</td>
      <td><button class="btn btn-secondary btn-sm" data-action="open" data-id="${invoice.id}">Ouvrir</button></td>
    </tr>
  `).join("");
}

function formPayload() {
  return {
    supplier_id: supplierSelect.value,
    invoice_number: invoiceNumberInput.value.trim(),
    invoice_date: invoiceDateInput.value || null,
    due_date: dueDateInput.value || null,
    product_total_ex_vat: Number(productTotalInput.value || 0),
    fees_ex_vat: Number(feesInput.value || 0),
    total_ex_vat: totalExVatValue(),
    vat_amount: Number(vatInput.value || 0),
    total_inc_vat: Number(totalIncInput.value || 0),
    notes: notesInput.value.trim() || null,
  };
}

async function createManualInvoice() {
  clearFeedback(createFeedback);
  const payload = formPayload();
  if (!payload.supplier_id || !payload.invoice_number) {
    showFeedback(createFeedback, "Fournisseur et numéro facture obligatoires", true);
    return;
  }
  const data = await apiFetch("/api/supplier-invoices", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  showFeedback(createFeedback, "Facture fournisseur créée");
  await loadInvoices();
  await openInvoice(data.invoice.id);
}

function importSuccessMessage(data) {
  const messages = [];
  if (data.parser?.detected) {
    messages.push(data.parser.message || "Facture Distrimer lue automatiquement");
  } else {
    messages.push(data.parser?.message || "Document importé mais aucun parser disponible");
  }
  if (data.auto_match?.matches > 0) {
    messages.push(`Proposition de rapprochement : ${data.auto_match.matches} match(s), ${data.auto_match.differences || 0} écart(s)`);
  } else {
    messages.push("Facture importée mais aucun BL proposé automatiquement");
  }
  return messages.join(". ");
}

async function importInvoice() {
  clearFeedback(createFeedback);
  const payload = formPayload();
  const file = invoiceDocumentInput.files?.[0];
  if (!payload.supplier_id || !file) {
    showFeedback(createFeedback, "Fournisseur et document facture obligatoires", true);
    return;
  }
  const form = new FormData();
  Object.entries(payload).forEach(([key, value]) => {
    if (value !== null && value !== undefined) form.append(key, value);
  });
  form.append("document", file);
  const data = await apiFetch("/api/supplier-invoices/import", {
    method: "POST",
    body: form,
  });
  showFeedback(createFeedback, importSuccessMessage(data));
  await loadInvoices();
  await openInvoice(data.invoice.id);
}

async function openInvoice(invoiceId) {
  clearFeedback(detailFeedback);
  selectedInvoiceId = invoiceId;
  const data = await apiFetch(`/api/supplier-invoices/${encodeURIComponent(invoiceId)}`);
  selectedInvoice = data.invoice;
  renderInvoices();
  renderDetail(data);
}

function resetManualMatchPanel(hide = true) {
  manualInvoice = null;
  manualCandidates = [];
  selectedManualPurchaseIds = new Set();
  if (hide) manualMatchPanel?.classList.add("hidden");
  clearFeedback(manualMatchFeedback);
  if (manualCandidatesBody) manualCandidatesBody.innerHTML = `<tr><td colspan="7">Clique sur “Rapprocher manuellement”.</td></tr>`;
  if (manualInvoiceTotal) manualInvoiceTotal.textContent = "-";
  if (manualSelectedTotal) manualSelectedTotal.textContent = "-";
  if (manualDifferenceTotal) {
    manualDifferenceTotal.textContent = "-";
    manualDifferenceTotal.classList.remove("is-difference");
  }
  if (confirmManualMatchBtn) confirmManualMatchBtn.disabled = true;
}

function resetDetailPanel() {
  selectedInvoiceId = null;
  selectedInvoice = null;
  invoiceDetail.classList.add("hidden");
  invoiceDetailEmpty.classList.remove("hidden");
  matchesTableBody.innerHTML = "";
  invoiceSummary.innerHTML = "";
  payloadPreview.classList.add("hidden");
  payloadPreview.textContent = "";
  resetManualMatchPanel(true);
}

function renderDetail(data) {
  invoiceDetailEmpty.classList.add("hidden");
  invoiceDetail.classList.remove("hidden");
  payloadPreview.classList.add("hidden");
  payloadPreview.textContent = "";
  resetManualMatchPanel(true);

  const invoice = data.invoice;
  invoiceSummary.innerHTML = `
    <div><span>Fournisseur</span><strong>${escapeHtml(invoice.supplier_name || "-")}</strong></div>
    <div><span>Facture</span><strong>${escapeHtml(invoice.invoice_number || "-")}</strong></div>
    <div><span>Statut</span><strong>${statusLabel(invoice.status)}</strong></div>
    <div><span>Rapprochement</span><strong>${matchLabel(invoice.match_status)}</strong></div>
    <div><span>Produits HT</span><strong>${formatCurrency(invoice.product_total_ex_vat)}</strong></div>
    <div><span>Prestations / taxes HT</span><strong>${formatCurrency(invoice.fees_ex_vat)}</strong></div>
    <div><span>TVA</span><strong>${formatCurrency(invoice.vat_amount)}</strong></div>
    <div><span>Total TTC</span><strong>${formatCurrency(invoice.total_inc_vat)}</strong></div>
  `;

  invoiceDocumentLink.href = "#";
  invoiceDocumentLink.dataset.documentUrl = invoice.document_url || "";
  invoiceDocumentLink.classList.toggle("disabled", !invoice.document_url);
  invoiceDocumentLink.setAttribute("aria-disabled", invoice.document_url ? "false" : "true");

  if (!data.matches.length) {
    matchesTableBody.innerHTML = `<tr><td colspan="7">Aucun rapprochement lancé</td></tr>`;
  } else {
    matchesTableBody.innerHTML = data.matches.map((match) => `
      <tr>
        <td>${escapeHtml(match.bl_number || match.purchase_id || "-")}</td>
        <td>${escapeHtml(match.purchase_line_number || "-")}</td>
        <td>${escapeHtml(`${match.article_plu || ""} ${match.article_name || ""}`.trim())}</td>
        <td>${escapeHtml(match.match_status || "-")}</td>
        <td>${Number(match.quantity_difference || 0).toFixed(3)}</td>
        <td>${Number(match.price_difference || 0).toFixed(4)}</td>
        <td>${formatCurrency(match.amount_difference)}</td>
      </tr>
    `).join("");
  }
}

function manualInvoiceComparableTotal() {
  return Number(manualInvoice?.comparable_total_ex_vat || selectedInvoice?.product_total_ex_vat || selectedInvoice?.total_ex_vat || 0);
}

function selectedManualTotalValue() {
  return manualCandidates
    .filter((candidate) => selectedManualPurchaseIds.has(String(candidate.purchase_id)))
    .reduce((sum, candidate) => sum + Number(candidate.total_ex_vat || 0), 0);
}

function renderManualTotals() {
  const invoiceTotal = manualInvoiceComparableTotal();
  const selectedTotal = selectedManualTotalValue();
  const difference = Number((invoiceTotal - selectedTotal).toFixed(4));
  manualInvoiceTotal.textContent = formatCurrency(invoiceTotal);
  manualSelectedTotal.textContent = formatCurrency(selectedTotal);
  manualDifferenceTotal.textContent = formatCurrency(difference);
  manualDifferenceTotal.classList.toggle("is-difference", Math.abs(difference) > 0.05);
  confirmManualMatchBtn.disabled = selectedManualPurchaseIds.size === 0;
}

function renderManualLines(candidate) {
  if (!candidate.lines?.length) return `<div class="manual-lines-list"><div class="manual-line-item"><span>Aucune ligne BL disponible</span></div></div>`;
  return `
    <div class="manual-lines-list">
      ${candidate.lines.map((line) => `
        <div class="manual-line-item">
          <span>Ligne ${escapeHtml(line.line_number || "-")}</span>
          <span>${escapeHtml(line.supplier_label || line.article_name || line.supplier_reference || "-")}</span>
          <span>${Number(line.quantity || 0).toLocaleString("fr-FR")} ${escapeHtml(line.price_unit || "kg")}</span>
          <span>${formatCurrency(line.unit_price_ex_vat)}</span>
          <span>${formatCurrency(line.line_amount_ex_vat)}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function renderManualCandidates() {
  if (!manualCandidates.length) {
    manualCandidatesBody.innerHTML = `<tr><td colspan="7">Aucun BL candidat pour ce fournisseur.</td></tr>`;
    renderManualTotals();
    return;
  }

  manualCandidatesBody.innerHTML = manualCandidates.map((candidate) => {
    const id = String(candidate.purchase_id);
    const checked = selectedManualPurchaseIds.has(id) ? "checked" : "";
    const blLabel = candidate.bl_number || candidate.source_document_original_name || candidate.purchase_id;
    return `
      <tr>
        <td><input class="manual-candidate-checkbox" type="checkbox" data-action="toggle-manual-purchase" data-id="${escapeHtml(id)}" ${checked} /></td>
        <td>${formatDate(candidate.receipt_date)}</td>
        <td>${escapeHtml(blLabel || "-")}</td>
        <td>${formatCurrency(candidate.total_ex_vat)}</td>
        <td>${statusLabel(candidate.status)}</td>
        <td>${formatCurrency(candidate.amount_difference)}</td>
        <td><button class="btn btn-secondary btn-sm" data-action="toggle-manual-lines" data-id="${escapeHtml(id)}">Voir lignes</button></td>
      </tr>
      <tr class="manual-lines-row hidden" data-lines-for="${escapeHtml(id)}">
        <td colspan="7">${renderManualLines(candidate)}</td>
      </tr>
    `;
  }).join("");
  renderManualTotals();
}

async function loadManualCandidates() {
  if (!selectedInvoiceId) return;
  clearFeedback(manualMatchFeedback);
  manualMatchPanel.classList.remove("hidden");
  manualCandidatesBody.innerHTML = `<tr><td colspan="7">Chargement des BL candidats...</td></tr>`;
  confirmManualMatchBtn.disabled = true;
  const data = await apiFetch(`/api/supplier-invoices/${encodeURIComponent(selectedInvoiceId)}/manual-match-candidates?date_window_days=30`);
  manualInvoice = data.invoice;
  manualCandidates = data.candidates || [];
  selectedManualPurchaseIds = new Set();
  renderManualCandidates();
  showFeedback(manualMatchFeedback, `${manualCandidates.length} BL candidat(s) trouvé(s). Sélectionne un ou plusieurs BL puis confirme.`);
}

function toggleManualPurchase(purchaseId, checked) {
  if (checked) selectedManualPurchaseIds.add(String(purchaseId));
  else selectedManualPurchaseIds.delete(String(purchaseId));
  renderManualTotals();
}

function toggleManualLines(purchaseId) {
  const row = manualCandidatesBody.querySelector(`[data-lines-for="${CSS.escape(String(purchaseId))}"]`);
  row?.classList.toggle("hidden");
}

async function confirmManualMatchSelected() {
  if (!selectedInvoiceId || !selectedManualPurchaseIds.size) return;
  clearFeedback(manualMatchFeedback);
  const selectedTotal = selectedManualTotalValue();
  const difference = Number((manualInvoiceComparableTotal() - selectedTotal).toFixed(4));
  const confirmed = confirm(`Confirmer le rapprochement manuel avec ${selectedManualPurchaseIds.size} BL sélectionné(s) ?\n\nTotal BL : ${formatCurrency(selectedTotal)}\nÉcart facture / BL : ${formatCurrency(difference)}`);
  if (!confirmed) return;

  const data = await apiFetch(`/api/supplier-invoices/${encodeURIComponent(selectedInvoiceId)}/manual-match`, {
    method: "POST",
    body: JSON.stringify({ purchase_ids: Array.from(selectedManualPurchaseIds) }),
  });
  showFeedback(detailFeedback, `Rapprochement manuel confirmé : ${matchLabel(data.match_status)}, écart ${formatCurrency(data.amount_difference)}`);
  await loadInvoices();
  await openInvoice(selectedInvoiceId);
}

async function openInvoiceDocument(event) {
  event?.preventDefault();
  const documentUrl = invoiceDocumentLink?.dataset.documentUrl;
  if (!documentUrl) return;

  if (/^https?:\/\//i.test(documentUrl)) {
    window.open(documentUrl, "_blank", "noopener");
    return;
  }

  const blankWindow = window.open("about:blank", "_blank", "noopener");
  invoiceDocumentLink.classList.add("disabled");

  try {
    const response = await fetch(`${API_BASE}${documentUrl}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Document facture indisponible");
    }

    const contentType = response.headers.get("Content-Type") || "application/octet-stream";
    const fileName = ensureFilenameExtension(
      filenameFromContentDisposition(response.headers.get("Content-Disposition")),
      contentType
    );
    const rawBlob = await response.blob();
    const typedBlob = rawBlob.type === contentType ? rawBlob : new Blob([rawBlob], { type: contentType });
    const blobUrl = URL.createObjectURL(typedBlob);

    if (blankWindow) {
      blankWindow.document.title = fileName;
      blankWindow.location.href = blobUrl;
    } else {
      const link = document.createElement("a");
      link.href = blobUrl;
      link.target = "_blank";
      link.rel = "noopener";
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }

    revokeLater(blobUrl);
  } catch (error) {
    if (blankWindow) blankWindow.close();
    showFeedback(detailFeedback, error.message || "Document facture indisponible", true);
  } finally {
    invoiceDocumentLink.classList.toggle("disabled", !invoiceDocumentLink.dataset.documentUrl);
  }
}

async function autoMatchSelected() {
  if (!selectedInvoiceId) return;
  clearFeedback(detailFeedback);
  const data = await apiFetch(`/api/supplier-invoices/${encodeURIComponent(selectedInvoiceId)}/auto-match`, {
    method: "POST",
    body: JSON.stringify({ date_window_days: 7 }),
  });
  if (data.skipped && data.reason === "zero_total") {
    showFeedback(detailFeedback, "Rapprochement ignoré : total facture à 0", true);
  } else {
    const confidence = data.confidence ? `, confiance ${data.confidence}` : "";
    showFeedback(detailFeedback, `Proposition de rapprochement : ${data.matches} match(s), ${data.differences} écart(s)${confidence}. Confirme le rapprochement avant validation.`);
  }
  await loadInvoices();
  await openInvoice(selectedInvoiceId);
}

async function confirmMatchSelected() {
  if (!selectedInvoiceId || !selectedInvoice) return;
  clearFeedback(detailFeedback);
  const confirmed = confirm("Confirmer le rapprochement proposé pour cette facture fournisseur ?");
  if (!confirmed) return;

  const data = await apiFetch(`/api/supplier-invoices/${encodeURIComponent(selectedInvoiceId)}/confirm-match`, {
    method: "POST",
    body: JSON.stringify({ confirm_difference: true }),
  });
  showFeedback(detailFeedback, `Rapprochement confirmé : ${matchLabel(data.match_status)}`);
  await loadInvoices();
  await openInvoice(selectedInvoiceId);
}

async function validateSelected(adjustCosts = false) {
  if (!selectedInvoiceId || !selectedInvoice) return;
  clearFeedback(detailFeedback);
  const confirmDifference = selectedInvoice.match_status === "discrepancy"
    ? confirm("Des écarts existent. Confirmer la validation manuelle ?")
    : false;
  const data = await apiFetch(`/api/supplier-invoices/${encodeURIComponent(selectedInvoiceId)}/validate`, {
    method: "POST",
    body: JSON.stringify({ confirm_difference: confirmDifference, adjust_costs: adjustCosts }),
  });
  showFeedback(detailFeedback, `Facture validée : ${statusLabel(data.status)}${data.adjusted_lots ? `, ${data.adjusted_lots} lot(s) ajusté(s)` : ""}`);
  await loadInvoices();
  await openInvoice(selectedInvoiceId);
}

async function deleteSelectedInvoice() {
  if (!selectedInvoiceId || !selectedInvoice) return;
  clearFeedback(detailFeedback);
  const label = selectedInvoice.invoice_number || "cette facture";
  const confirmed = confirm(`Supprimer définitivement la facture fournisseur ${label} ?\n\nLes rapprochements et lignes facture seront supprimés, et les achats liés repasseront en attente facture si nécessaire.`);
  if (!confirmed) return;

  await apiFetch(`/api/supplier-invoices/${encodeURIComponent(selectedInvoiceId)}`, { method: "DELETE" });
  resetDetailPanel();
  await loadInvoices();
  showFeedback(listFeedback, "Facture fournisseur supprimée");
}

async function showPayload() {
  if (!selectedInvoiceId) return;
  const payload = await apiFetch(`/api/supplier-invoices/${encodeURIComponent(selectedInvoiceId)}/pennylane-payload`);
  payloadPreview.textContent = JSON.stringify(payload, null, 2);
  payloadPreview.classList.remove("hidden");
}

function logout() {
  localStorage.removeItem("gc_token");
  localStorage.removeItem("gc_user");
  localStorage.removeItem("gc_active_department");
  localStorage.removeItem("grv2_token");
  localStorage.removeItem("grv2_user");
  localStorage.removeItem("grv2_active_department");
  window.location.href = "./login.html";
}

async function init() {
  try {
    userNameEl.textContent = sessionUser.email || "Utilisateur";
    await loadSuppliers();
    await loadInvoices();
    const params = new URLSearchParams(window.location.search);
    const invoiceId = params.get("invoice_id") || params.get("open");
    if (invoiceId) await openInvoice(invoiceId);
  } catch (error) {
    showFeedback(listFeedback, error.message || "Erreur chargement", true);
  }
}

backHomeBtn?.addEventListener("click", () => { window.location.href = "./home.html"; });
logoutBtn?.addEventListener("click", logout);
refreshBtn?.addEventListener("click", loadInvoices);
statusFilter?.addEventListener("change", loadInvoices);
searchInput?.addEventListener("input", () => { window.clearTimeout(searchInput._timer); searchInput._timer = window.setTimeout(loadInvoices, 250); });
createManualBtn?.addEventListener("click", () => createManualInvoice().catch((error) => showFeedback(createFeedback, error.message, true)));
importInvoiceBtn?.addEventListener("click", () => importInvoice().catch((error) => showFeedback(createFeedback, error.message, true)));
invoiceDocumentLink?.addEventListener("click", (event) => openInvoiceDocument(event));
manualMatchBtn?.addEventListener("click", () => loadManualCandidates().catch((error) => showFeedback(manualMatchFeedback || detailFeedback, error.message, true)));
reloadManualCandidatesBtn?.addEventListener("click", () => loadManualCandidates().catch((error) => showFeedback(manualMatchFeedback || detailFeedback, error.message, true)));
confirmManualMatchBtn?.addEventListener("click", () => confirmManualMatchSelected().catch((error) => showFeedback(manualMatchFeedback || detailFeedback, error.message, true)));
autoMatchBtn?.addEventListener("click", () => autoMatchSelected().catch((error) => showFeedback(detailFeedback, error.message, true)));
confirmMatchBtn?.addEventListener("click", () => confirmMatchSelected().catch((error) => showFeedback(detailFeedback, error.message, true)));
validateBtn?.addEventListener("click", () => validateSelected(false).catch((error) => showFeedback(detailFeedback, error.message, true)));
validateAdjustBtn?.addEventListener("click", () => validateSelected(true).catch((error) => showFeedback(detailFeedback, error.message, true)));
payloadBtn?.addEventListener("click", () => showPayload().catch((error) => showFeedback(detailFeedback, error.message, true)));
deleteInvoiceBtn?.addEventListener("click", () => deleteSelectedInvoice().catch((error) => showFeedback(detailFeedback, error.message, true)));

manualCandidatesBody?.addEventListener("click", (event) => {
  const lineButton = event.target.closest("[data-action='toggle-manual-lines']");
  if (lineButton) toggleManualLines(lineButton.dataset.id);
});

manualCandidatesBody?.addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-action='toggle-manual-purchase']");
  if (!checkbox) return;
  toggleManualPurchase(checkbox.dataset.id, checkbox.checked);
});

invoicesTableBody?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action='open']");
  if (!button) return;
  openInvoice(button.dataset.id).catch((error) => showFeedback(detailFeedback, error.message, true));
});

init();
