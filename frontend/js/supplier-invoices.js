const token = localStorage.getItem("gc_token") || localStorage.getItem("grv2_token");
const sessionUser = JSON.parse(localStorage.getItem("gc_user") || localStorage.getItem("grv2_user") || "null");

if (!token || !sessionUser) {
  window.location.href = "./login.html";
}

const API_BASE = window.APP_CONFIG.API_BASE_URL;

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
const invoiceDocumentLink = document.getElementById("invoice-document-link");
const autoMatchBtn = document.getElementById("auto-match-btn");
const validateBtn = document.getElementById("validate-btn");
const validateAdjustBtn = document.getElementById("validate-adjust-btn");
const payloadBtn = document.getElementById("payload-btn");
const payloadPreview = document.getElementById("payload-preview");

let suppliers = [];
let invoices = [];
let selectedInvoiceId = null;
let selectedInvoice = null;

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
    matched: "Rapprochée",
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
    unmatched: "Non rapprochée",
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
      <td>${invoice.supplier_name || "-"}</td>
      <td>${invoice.invoice_number || "-"}</td>
      <td><span class="invoice-status status-${invoice.status}">${statusLabel(invoice.status)}</span></td>
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
  showFeedback(createFeedback, "Facture fournisseur importée");
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

function renderDetail(data) {
  invoiceDetailEmpty.classList.add("hidden");
  invoiceDetail.classList.remove("hidden");
  payloadPreview.classList.add("hidden");
  payloadPreview.textContent = "";

  const invoice = data.invoice;
  invoiceSummary.innerHTML = `
    <div><span>Fournisseur</span><strong>${invoice.supplier_name || "-"}</strong></div>
    <div><span>Facture</span><strong>${invoice.invoice_number || "-"}</strong></div>
    <div><span>Statut</span><strong>${statusLabel(invoice.status)}</strong></div>
    <div><span>Rapprochement</span><strong>${matchLabel(invoice.match_status)}</strong></div>
    <div><span>Produits HT</span><strong>${formatCurrency(invoice.product_total_ex_vat)}</strong></div>
    <div><span>Prestations / taxes HT</span><strong>${formatCurrency(invoice.fees_ex_vat)}</strong></div>
    <div><span>TVA</span><strong>${formatCurrency(invoice.vat_amount)}</strong></div>
    <div><span>Total TTC</span><strong>${formatCurrency(invoice.total_inc_vat)}</strong></div>
  `;

  invoiceDocumentLink.href = invoice.document_url ? `${API_BASE}${invoice.document_url}` : "#";
  invoiceDocumentLink.classList.toggle("disabled", !invoice.document_url);

  if (!data.matches.length) {
    matchesTableBody.innerHTML = `<tr><td colspan="7">Aucun rapprochement lancé</td></tr>`;
  } else {
    matchesTableBody.innerHTML = data.matches.map((match) => `
      <tr>
        <td>${match.bl_number || match.purchase_id || "-"}</td>
        <td>${match.purchase_line_number || "-"}</td>
        <td>${match.article_plu || ""} ${match.article_name || ""}</td>
        <td>${match.match_status || "-"}</td>
        <td>${Number(match.quantity_difference || 0).toFixed(3)}</td>
        <td>${Number(match.price_difference || 0).toFixed(4)}</td>
        <td>${formatCurrency(match.amount_difference)}</td>
      </tr>
    `).join("");
  }
}

async function autoMatchSelected() {
  if (!selectedInvoiceId) return;
  clearFeedback(detailFeedback);
  const data = await apiFetch(`/api/supplier-invoices/${encodeURIComponent(selectedInvoiceId)}/auto-match`, {
    method: "POST",
    body: JSON.stringify({ date_window_days: 7 }),
  });
  showFeedback(detailFeedback, `Rapprochement terminé : ${data.matches} match(s), ${data.differences} écart(s)`);
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
autoMatchBtn?.addEventListener("click", () => autoMatchSelected().catch((error) => showFeedback(detailFeedback, error.message, true)));
validateBtn?.addEventListener("click", () => validateSelected(false).catch((error) => showFeedback(detailFeedback, error.message, true)));
validateAdjustBtn?.addEventListener("click", () => validateSelected(true).catch((error) => showFeedback(detailFeedback, error.message, true)));
payloadBtn?.addEventListener("click", () => showPayload().catch((error) => showFeedback(detailFeedback, error.message, true)));

invoicesTableBody?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action='open']");
  if (!button) return;
  openInvoice(button.dataset.id).catch((error) => showFeedback(detailFeedback, error.message, true));
});

init();
