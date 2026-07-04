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
const syncBtn = document.getElementById("sync-btn");
const statusFilter = document.getElementById("status-filter");
const searchInput = document.getElementById("search-input");
const invoicesTableBody = document.getElementById("invoices-table-body");
const listFeedback = document.getElementById("list-feedback");
const detailFeedback = document.getElementById("detail-feedback");
const detailEmpty = document.getElementById("detail-empty");
const detailContent = document.getElementById("detail-content");
const invoiceSummary = document.getElementById("invoice-summary");
const linesTableBody = document.getElementById("lines-table-body");
const pdfLink = document.getElementById("pdf-link");
const analyzeBtn = document.getElementById("analyze-btn");
const legacyModuleLink = document.getElementById("legacy-module-link");

let invoices = [];
let selectedInvoiceId = null;

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

function formatNumber(value, decimals = 3) {
  if (value === undefined || value === null || value === "") return "-";
  return Number(value || 0).toLocaleString("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

function formatSignedCurrency(value) {
  if (value === undefined || value === null || value === "") return "-";
  const amount = Number(value || 0);
  const sign = amount > 0 ? "+" : "";
  return `${sign}${formatCurrency(amount)}`;
}

function altaStatusLabel(status) {
  const map = {
    nouvelle: "Nouvelle",
    a_rapprocher: "À rapprocher",
    analyse_automatique: "Analyse automatique",
    en_controle: "En contrôle",
    conforme: "Conforme",
    ecart_prix: "Écart prix",
    ecart_quantite: "Écart quantité",
    ecart_tva: "Écart TVA",
    bl_manquant: "BL manquant",
    article_inconnu: "Article inconnu",
    controle_manuel: "Contrôle manuel",
    litige: "Litige",
    refusee: "Refusée",
    validee_a_payer: "Validée à payer",
    payee: "Payée",
  };
  return map[status] || status || "-";
}

function matchStatusLabel(status) {
  const map = {
    conforme: "Montant proche",
    ecart_prix: "Écart montant",
    bl_manquant: "BL manquant",
    unmatched: "Non rapprochée",
  };
  return map[status] || status || "-";
}

function effectiveAltaStatus(invoice) {
  return invoice.display_alta_business_status || invoice.alta_business_status;
}

function effectiveMatchedCount(invoice) {
  if (invoice.display_auto_matched_count !== undefined && invoice.display_auto_matched_count !== null) {
    return invoice.display_auto_matched_count;
  }
  return invoice.auto_matched_lines_count || 0;
}

function effectiveAnomalyCount(invoice) {
  if (invoice.display_auto_anomaly_count !== undefined && invoice.display_auto_anomaly_count !== null) {
    return invoice.display_auto_anomaly_count;
  }
  return invoice.auto_anomaly_count || 0;
}

function pennylaneStatus(invoice) {
  const parts = [
    invoice.accounting_status,
    invoice.payment_status,
    invoice.e_invoice_status,
  ].filter(Boolean);

  if (invoice.paid === true && !parts.includes("paid")) parts.push("paid");
  return parts.join(" / ") || "-";
}

function rememberInvoice(invoice) {
  if (!invoice?.id) return;
  const index = invoices.findIndex((item) => item.id === invoice.id);
  if (index >= 0) invoices[index] = { ...invoices[index], ...invoice };
}

async function loadInvoices() {
  clearFeedback(listFeedback);
  const params = new URLSearchParams();
  params.set("status", statusFilter.value || "all");
  if (searchInput.value.trim()) params.set("search", searchInput.value.trim());
  const data = await apiFetch(`/api/integrations/pennylane/supplier-invoices?${params.toString()}`);
  invoices = data.invoices || [];
  renderInvoices();
}

function renderInvoices() {
  if (!invoices.length) {
    invoicesTableBody.innerHTML = `<tr><td colspan="14">Aucune facture fournisseur Pennylane synchronisée</td></tr>`;
    return;
  }

  invoicesTableBody.innerHTML = invoices.map((invoice) => {
    const status = effectiveAltaStatus(invoice);
    const anomalyCount = Number(effectiveAnomalyCount(invoice) || 0);
    return `
      <tr class="${invoice.id === selectedInvoiceId ? "is-selected" : ""}">
        <td>${escapeHtml(invoice.supplier_name || invoice.pennylane_supplier_id || "-")}</td>
        <td>${escapeHtml(invoice.invoice_number || "-")}</td>
        <td>${formatDate(invoice.invoice_date)}</td>
        <td>${formatDate(invoice.due_date)}</td>
        <td>${formatCurrency(invoice.amount_ex_vat || invoice.currency_amount_ex_vat)}</td>
        <td>${formatCurrency(invoice.amount_vat || invoice.currency_amount_vat)}</td>
        <td>${formatCurrency(invoice.amount_inc_vat || invoice.currency_amount_inc_vat)}</td>
        <td>${escapeHtml(pennylaneStatus(invoice))}</td>
        <td><span class="invoice-status status-${escapeHtml(status)}">${altaStatusLabel(status)}</span></td>
        <td>${formatNumber(invoice.auto_bl_count, 0)}</td>
        <td>${formatNumber(effectiveMatchedCount(invoice), 0)}</td>
        <td><span class="invoice-status ${anomalyCount > 0 ? "status-ecart_prix" : "status-conforme"}">${formatNumber(anomalyCount, 0)}</span></td>
        <td>${invoice.public_file_url ? `<a href="${escapeHtml(invoice.public_file_url)}" target="_blank" rel="noopener">PDF</a>` : "-"}</td>
        <td><button type="button" class="btn btn-secondary btn-sm" data-invoice-control-button data-id="${escapeHtml(invoice.id)}">Contrôle</button></td>
      </tr>
    `;
  }).join("");
}

async function openInvoice(invoiceId) {
  clearFeedback(detailFeedback);
  if (!invoiceId) {
    showFeedback(detailFeedback, "Identifiant de facture manquant", true);
    return;
  }

  selectedInvoiceId = invoiceId;
  const data = await apiFetch(`/api/integrations/pennylane/supplier-invoices/${encodeURIComponent(invoiceId)}`);
  rememberInvoice(data.invoice);
  renderInvoices();
  renderDetail(data);
  document.getElementById("detail-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderDetail(data) {
  const invoice = data.invoice;
  const matchResults = data.match_results || [];
  const status = effectiveAltaStatus(invoice);

  detailEmpty.classList.add("hidden");
  detailContent.classList.remove("hidden");

  invoiceSummary.innerHTML = `
    <div><span>Fournisseur ALTA</span><strong>${escapeHtml(invoice.supplier_name || "Non rapproché")}</strong></div>
    <div><span>Fournisseur Pennylane</span><strong>${escapeHtml(invoice.pennylane_supplier_id || "-")}</strong></div>
    <div><span>Facture</span><strong>${escapeHtml(invoice.invoice_number || "-")}</strong></div>
    <div><span>Date facture</span><strong>${formatDate(invoice.invoice_date)}</strong></div>
    <div><span>Échéance</span><strong>${formatDate(invoice.due_date)}</strong></div>
    <div><span>Statut Pennylane</span><strong>${escapeHtml(pennylaneStatus(invoice))}</strong></div>
    <div><span>Statut métier ALTA</span><strong>${altaStatusLabel(status)}</strong></div>
    <div><span>BL candidats</span><strong>${formatNumber(invoice.auto_bl_count, 0)}</strong></div>
    <div><span>Propositions globales</span><strong>${formatNumber(effectiveMatchedCount(invoice), 0)}</strong></div>
    <div><span>Anomalies montant</span><strong>${formatNumber(effectiveAnomalyCount(invoice), 0)}</strong></div>
    <div><span>Confiance</span><strong>${formatNumber(invoice.auto_conformity_score, 2)} %</strong></div>
    <div><span>Total HT</span><strong>${formatCurrency(invoice.amount_ex_vat || invoice.currency_amount_ex_vat)}</strong></div>
    <div><span>Total TVA</span><strong>${formatCurrency(invoice.amount_vat || invoice.currency_amount_vat)}</strong></div>
    <div><span>Total TTC</span><strong>${formatCurrency(invoice.amount_inc_vat || invoice.currency_amount_inc_vat)}</strong></div>
  `;

  pdfLink.href = invoice.public_file_url || "#";
  pdfLink.classList.toggle("disabled", !invoice.public_file_url);
  pdfLink.setAttribute("aria-disabled", invoice.public_file_url ? "false" : "true");

  if (legacyModuleLink) {
    legacyModuleLink.href = "#";
    legacyModuleLink.dataset.invoiceId = invoice.id || "";
    legacyModuleLink.classList.toggle("disabled", !invoice.id || !invoice.supplier_id);
    legacyModuleLink.setAttribute("aria-disabled", invoice.id && invoice.supplier_id ? "false" : "true");
  }

  if (!matchResults.length) {
    linesTableBody.innerHTML = `<tr><td colspan="8">Aucun BL candidat trouvé pour ce fournisseur et cette période</td></tr>`;
    return;
  }

  linesTableBody.innerHTML = matchResults.map((result, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>
        <strong>${escapeHtml(result.purchase_bl_number ? `BL ${result.purchase_bl_number}` : "Achat candidat")}</strong>
        <small>${escapeHtml(`Réception ${formatDate(result.purchase_receipt_date)}`)}</small>
      </td>
      <td>-</td>
      <td>-</td>
      <td>${formatCurrency(result.purchase_amount_ex_vat)}</td>
      <td>${formatCurrency(result.invoice_amount_ex_vat)}</td>
      <td>${formatSignedCurrency(result.amount_difference)}</td>
      <td><span class="invoice-status status-${escapeHtml(result.match_status || status)}">${matchStatusLabel(result.match_status)}</span></td>
    </tr>
  `).join("");
}

async function analyzeSelectedInvoice() {
  if (!selectedInvoiceId) return;
  clearFeedback(detailFeedback);
  analyzeBtn.disabled = true;
  analyzeBtn.textContent = "Analyse...";
  try {
    const result = await apiFetch(`/api/integrations/pennylane/supplier-invoices/${encodeURIComponent(selectedInvoiceId)}/analyze`, { method: "POST" });
    showFeedback(detailFeedback, `Analyse terminée : ${result.bl_count || 0} BL candidat(s), ${result.matched_lines || 0} proposition(s) proche(s), ${result.anomaly_count || 0} écart(s).`);
    await loadInvoices();
    await openInvoice(selectedInvoiceId);
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = "Relancer analyse";
  }
}

async function openInAltaModule(event) {
  event.preventDefault();
  if (!selectedInvoiceId || legacyModuleLink?.getAttribute("aria-disabled") === "true") return;
  clearFeedback(detailFeedback);
  const originalText = legacyModuleLink.textContent;
  legacyModuleLink.classList.add("disabled");
  legacyModuleLink.textContent = "Ouverture...";
  try {
    const result = await apiFetch(`/api/integrations/pennylane/supplier-invoices/${encodeURIComponent(selectedInvoiceId)}/open-alta`, { method: "POST" });
    window.location.href = result.redirect_url || `./supplier-invoices.html?invoice_id=${encodeURIComponent(result.supplier_invoice_id)}`;
  } finally {
    legacyModuleLink.textContent = originalText;
    legacyModuleLink.classList.remove("disabled");
  }
}

async function syncNow() {
  clearFeedback(listFeedback);
  syncBtn.disabled = true;
  syncBtn.textContent = "Synchronisation...";
  try {
    const result = await apiFetch("/api/integrations/pennylane/supplier-invoices/sync", { method: "POST" });
    const sync = result.sync || result;
    const matching = result.matching || {};
    showFeedback(
      listFeedback,
      `Synchronisation lancée : ${sync.succeeded || 0} facture(s), ${sync.deleted || 0} suppression(s), ${sync.failed || 0} erreur(s). Analyse : ${matching.succeeded || 0} facture(s), ${matching.failed || 0} erreur(s).`
    );
    await loadInvoices();
  } finally {
    syncBtn.disabled = false;
    syncBtn.textContent = "Synchroniser Pennylane";
  }
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
    await loadInvoices();
  } catch (error) {
    showFeedback(listFeedback, error.message || "Erreur chargement", true);
  }
}

backHomeBtn?.addEventListener("click", () => { window.location.href = "./home.html"; });
logoutBtn?.addEventListener("click", logout);
refreshBtn?.addEventListener("click", () => loadInvoices().catch((error) => showFeedback(listFeedback, error.message, true)));
syncBtn?.addEventListener("click", () => syncNow().catch((error) => showFeedback(listFeedback, error.message, true)));
analyzeBtn?.addEventListener("click", () => analyzeSelectedInvoice().catch((error) => showFeedback(detailFeedback, error.message, true)));
legacyModuleLink?.addEventListener("click", (event) => openInAltaModule(event).catch((error) => showFeedback(detailFeedback, error.message, true)));
statusFilter?.addEventListener("change", () => loadInvoices().catch((error) => showFeedback(listFeedback, error.message, true)));
searchInput?.addEventListener("input", () => {
  window.clearTimeout(searchInput._timer);
  searchInput._timer = window.setTimeout(() => {
    loadInvoices().catch((error) => showFeedback(listFeedback, error.message, true));
  }, 250);
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-invoice-control-button]");
  if (!button) return;
  event.preventDefault();
  openInvoice(button.dataset.id).catch((error) => showFeedback(detailFeedback, error.message, true));
});

pdfLink?.addEventListener("click", (event) => {
  if (!pdfLink.href || pdfLink.getAttribute("aria-disabled") === "true") {
    event.preventDefault();
  }
});

init();
