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
    conforme: "Conforme",
    ecart_prix: "Écart prix",
    ecart_quantite: "Écart quantité",
    ecart_tva: "Écart TVA",
    bl_manquant: "BL manquant",
    article_inconnu: "Article inconnu",
    unmatched: "Non rapprochée",
  };
  return map[status] || status || "-";
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

  invoicesTableBody.innerHTML = invoices.map((invoice) => `
    <tr class="${invoice.id === selectedInvoiceId ? "is-selected" : ""}">
      <td>${escapeHtml(invoice.supplier_name || invoice.pennylane_supplier_id || "-")}</td>
      <td>${escapeHtml(invoice.invoice_number || "-")}</td>
      <td>${formatDate(invoice.invoice_date)}</td>
      <td>${formatDate(invoice.due_date)}</td>
      <td>${formatCurrency(invoice.amount_ex_vat || invoice.currency_amount_ex_vat)}</td>
      <td>${formatCurrency(invoice.amount_vat || invoice.currency_amount_vat)}</td>
      <td>${formatCurrency(invoice.amount_inc_vat || invoice.currency_amount_inc_vat)}</td>
      <td>${escapeHtml(pennylaneStatus(invoice))}</td>
      <td><span class="invoice-status status-${escapeHtml(invoice.alta_business_status)}">${altaStatusLabel(invoice.alta_business_status)}</span></td>
      <td>${formatNumber(invoice.auto_bl_count, 0)}</td>
      <td>${formatNumber(invoice.auto_matched_lines_count, 0)} / ${formatNumber(invoice.line_count, 0)}</td>
      <td><span class="invoice-status ${Number(invoice.auto_anomaly_count || 0) > 0 ? "status-ecart_prix" : "status-conforme"}">${formatNumber(invoice.auto_anomaly_count, 0)}</span></td>
      <td>${invoice.public_file_url ? `<a href="${escapeHtml(invoice.public_file_url)}" target="_blank" rel="noopener">PDF</a>` : "-"}</td>
      <td><button class="btn btn-secondary btn-sm" data-action="open" data-id="${invoice.id}">Voir / contrôler</button></td>
    </tr>
  `).join("");
}

async function openInvoice(invoiceId) {
  clearFeedback(detailFeedback);
  selectedInvoiceId = invoiceId;
  const data = await apiFetch(`/api/integrations/pennylane/supplier-invoices/${encodeURIComponent(invoiceId)}`);
  renderInvoices();
  renderDetail(data);
}

function renderDetail(data) {
  const invoice = data.invoice;
  const lines = data.lines || [];
  const matchResults = data.match_results || [];
  const resultByLineId = new Map(matchResults.map((result) => [result.supplier_invoice_line_id, result]));

  detailEmpty.classList.add("hidden");
  detailContent.classList.remove("hidden");

  invoiceSummary.innerHTML = `
    <div><span>Fournisseur ALTA</span><strong>${escapeHtml(invoice.supplier_name || "Non rapproché")}</strong></div>
    <div><span>Fournisseur Pennylane</span><strong>${escapeHtml(invoice.pennylane_supplier_id || "-")}</strong></div>
    <div><span>Facture</span><strong>${escapeHtml(invoice.invoice_number || "-")}</strong></div>
    <div><span>Échéance</span><strong>${formatDate(invoice.due_date)}</strong></div>
    <div><span>Statut Pennylane</span><strong>${escapeHtml(pennylaneStatus(invoice))}</strong></div>
    <div><span>Statut métier ALTA</span><strong>${altaStatusLabel(invoice.alta_business_status)}</strong></div>
    <div><span>BL trouvés</span><strong>${formatNumber(invoice.auto_bl_count, 0)}</strong></div>
    <div><span>Lignes rapprochées</span><strong>${formatNumber(invoice.auto_matched_lines_count, 0)} / ${formatNumber(lines.length, 0)}</strong></div>
    <div><span>Anomalies</span><strong>${formatNumber(invoice.auto_anomaly_count, 0)}</strong></div>
    <div><span>Conformité</span><strong>${formatNumber(invoice.auto_conformity_score, 2)} %</strong></div>
    <div><span>Total HT</span><strong>${formatCurrency(invoice.amount_ex_vat || invoice.currency_amount_ex_vat)}</strong></div>
    <div><span>Total TTC</span><strong>${formatCurrency(invoice.amount_inc_vat || invoice.currency_amount_inc_vat)}</strong></div>
  `;

  pdfLink.href = invoice.public_file_url || "#";
  pdfLink.classList.toggle("disabled", !invoice.public_file_url);
  pdfLink.setAttribute("aria-disabled", invoice.public_file_url ? "false" : "true");

  if (!lines.length) {
    linesTableBody.innerHTML = `<tr><td colspan="8">Aucune ligne récupérée depuis Pennylane</td></tr>`;
    return;
  }

  linesTableBody.innerHTML = lines.map((line) => {
    const result = resultByLineId.get(line.id) || {};
    const article = result.article_label || result.article_name || line.label || "-";
    return `
    <tr>
      <td>${escapeHtml(line.line_position || "-")}</td>
      <td>
        <strong>${escapeHtml(article)}</strong>
        <small>${escapeHtml(result.purchase_bl_number ? `BL ${result.purchase_bl_number}` : line.label || "")}</small>
      </td>
      <td>${formatNumber(result.invoice_quantity ?? line.quantity)}</td>
      <td>${formatNumber(result.received_quantity)}</td>
      <td>${formatCurrency(result.purchase_unit_price_ex_vat)}</td>
      <td>${formatCurrency(result.invoice_unit_price_ex_vat ?? line.raw_currency_unit_price)}</td>
      <td>${formatSignedCurrency(result.amount_difference ?? result.unit_price_difference)}</td>
      <td><span class="invoice-status status-${escapeHtml(result.match_status || invoice.alta_business_status)}">${matchStatusLabel(result.match_status)}</span></td>
    </tr>
  `;
  }).join("");
}

async function analyzeSelectedInvoice() {
  if (!selectedInvoiceId) return;
  clearFeedback(detailFeedback);
  analyzeBtn.disabled = true;
  analyzeBtn.textContent = "Analyse...";
  try {
    const result = await apiFetch(`/api/integrations/pennylane/supplier-invoices/${encodeURIComponent(selectedInvoiceId)}/analyze`, { method: "POST" });
    showFeedback(detailFeedback, `Analyse terminée : ${result.conform_lines || 0} conforme(s), ${result.anomaly_count || 0} anomalie(s).`);
    await loadInvoices();
    await openInvoice(selectedInvoiceId);
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = "Relancer analyse";
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
statusFilter?.addEventListener("change", () => loadInvoices().catch((error) => showFeedback(listFeedback, error.message, true)));
searchInput?.addEventListener("input", () => {
  window.clearTimeout(searchInput._timer);
  searchInput._timer = window.setTimeout(() => {
    loadInvoices().catch((error) => showFeedback(listFeedback, error.message, true));
  }, 250);
});

invoicesTableBody?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action='open']");
  if (!button) return;
  openInvoice(button.dataset.id).catch((error) => showFeedback(detailFeedback, error.message, true));
});

pdfLink?.addEventListener("click", (event) => {
  if (!pdfLink.href || pdfLink.getAttribute("aria-disabled") === "true") {
    event.preventDefault();
  }
});

init();
