const API_BASE_URL = window.APP_CONFIG.API_BASE_URL;
const sessionUser = JSON.parse(localStorage.getItem("gc_user") || localStorage.getItem("grv2_user") || "null");
const authToken = localStorage.getItem("gc_token") || localStorage.getItem("grv2_token");

if (!sessionUser || !authToken) {
  window.location.href = "./login.html";
}

const invoicesTbody = document.getElementById("invoices-tbody");
const pageFeedback = document.getElementById("page-feedback");
const refreshBtn = document.getElementById("refresh-btn");
const filters = {
  clientSearch: document.getElementById("client-search"),
  fromDate: document.getElementById("from-date"),
  toDate: document.getElementById("to-date"),
  payment: document.getElementById("payment-filter"),
  sync: document.getElementById("sync-filter"),
  overdue: document.getElementById("overdue-filter"),
};

let invoices = [];

function logoutAndRedirect() {
  ["gc_token", "gc_user", "gc_active_department", "grv2_token", "grv2_user", "grv2_active_department"].forEach((key) => localStorage.removeItem(key));
  window.location.href = "./login.html";
}

function showFeedback(message, type = "success") {
  if (!pageFeedback) return;
  pageFeedback.textContent = message;
  pageFeedback.className = `page-feedback ${type}`;
  window.setTimeout(() => {
    pageFeedback.textContent = "";
    pageFeedback.className = "page-feedback hidden";
  }, 3500);
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("fr-FR").format(new Date(value));
}

function formatMoney(value) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(amount);
}

function labelPaymentStatus(value) {
  const labels = {
    paid: "Payée",
    partially_paid: "Partiellement payée",
    unpaid: "Non payée",
    overdue: "En retard",
  };
  return labels[value] || value || "-";
}

function filteredInvoices() {
  const search = String(filters.clientSearch?.value || "").trim().toLowerCase();
  return invoices.filter((invoice) => {
    if (!search) return true;
    return [invoice.client_name, invoice.client_code, invoice.reference_number]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(search));
  });
}

function renderInvoices() {
  const rows = filteredInvoices();

  if (!rows.length) {
    invoicesTbody.innerHTML = '<tr><td colspan="13">Aucune facture client.</td></tr>';
    return;
  }

  invoicesTbody.innerHTML = rows.map((invoice) => {
    const syncStatus = invoice.pennylane_sync_status || "pending";
    const paymentStatus = invoice.pennylane_payment_status || "unpaid";
    return `
      <tr>
        <td>${invoice.reference_number || "-"}</td>
        <td>${invoice.pennylane_invoice_number || invoice.pennylane_invoice_id || "-"}</td>
        <td>${invoice.client_name || "-"}</td>
        <td>${formatDate(invoice.document_date)}</td>
        <td>${formatDate(invoice.deadline)}</td>
        <td>${formatMoney(invoice.total_amount_inc_vat)}</td>
        <td>${invoice.alta_status || "-"}</td>
        <td>${syncStatus}</td>
        <td>${labelPaymentStatus(paymentStatus)}</td>
        <td>${formatMoney(invoice.pennylane_paid_amount)}</td>
        <td>${formatMoney(invoice.pennylane_remaining_amount)}</td>
        <td>${invoice.is_overdue ? "Oui" : "Non"}</td>
        <td>
          <button type="button" class="btn btn-secondary" data-pdf="${invoice.id}">PDF ALTA</button>
          <button type="button" class="btn btn-secondary" data-sync="${invoice.id}">Synchroniser Pennylane</button>
        </td>
      </tr>
    `;
  }).join("");
}

function buildQuery() {
  const query = new URLSearchParams();
  if (filters.fromDate?.value) query.set("from", filters.fromDate.value);
  if (filters.toDate?.value) query.set("to", filters.toDate.value);
  if (filters.payment?.value && filters.payment.value !== "all") query.set("payment_status", filters.payment.value);
  if (filters.sync?.value && filters.sync.value !== "all") query.set("sync_status", filters.sync.value);
  if (filters.overdue?.value === "true") query.set("overdue", "true");
  return query.toString();
}

async function loadInvoices() {
  try {
    const query = buildQuery();
    const response = await fetch(`${API_BASE_URL}/api/integrations/pennylane/customer-invoices${query ? `?${query}` : ""}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    if (response.status === 401) {
      logoutAndRedirect();
      return;
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Impossible de charger les factures clients");

    invoices = Array.isArray(data.invoices) ? data.invoices : [];
    renderInvoices();
  } catch (err) {
    console.error("Erreur chargement factures clients :", err);
    invoicesTbody.innerHTML = '<tr><td colspan="13">Erreur de chargement.</td></tr>';
    showFeedback(err.message || "Erreur chargement factures clients", "error");
  }
}

async function syncInvoice(invoiceId, button) {
  if (!window.enqueuePennylaneManualSync) return;
  await window.enqueuePennylaneManualSync({ type: "customer_invoice", id: invoiceId }, button);
  await loadInvoices();
}

function bindEvents() {
  document.getElementById("user-name").textContent = sessionUser.email || "Utilisateur";
  document.getElementById("back-home-btn")?.addEventListener("click", () => { window.location.href = "./home.html"; });
  document.getElementById("logout-btn")?.addEventListener("click", logoutAndRedirect);
  refreshBtn?.addEventListener("click", loadInvoices);

  Object.values(filters).forEach((filter) => {
    filter?.addEventListener("change", loadInvoices);
    filter?.addEventListener("input", renderInvoices);
  });

  invoicesTbody?.addEventListener("click", (event) => {
    const pdfId = event.target?.dataset?.pdf;
    const syncId = event.target?.dataset?.sync;
    if (pdfId) window.open(`${API_BASE_URL}/api/invoices/${encodeURIComponent(pdfId)}/pdf`, "_blank", "noopener");
    if (syncId) syncInvoice(syncId, event.target);
  });
}

bindEvents();
loadInvoices();
