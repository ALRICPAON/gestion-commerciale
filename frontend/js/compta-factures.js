const API_URL = `${window.APP_CONFIG.API_BASE_URL}/api`;

const token = localStorage.getItem("grv2_token");
const sessionUser = JSON.parse(localStorage.getItem("grv2_user") || "null");
const activeDepartment = JSON.parse(localStorage.getItem("grv2_active_department") || "null");

if (!token || !sessionUser) {
  window.location.href = "./login.html";
}

if (!["admin", "responsable"].includes(sessionUser.role)) {
  alert("Accès réservé aux responsables et administrateurs.");
  window.location.href = "./home.html";
}

const dateStartInput = document.getElementById("date-start");
const dateEndInput = document.getElementById("date-end");
const supplierSelect = document.getElementById("supplier-select");
const statusSelect = document.getElementById("status-select");
const searchInput = document.getElementById("search-invoice");
const loadInvoicesBtn = document.getElementById("load-invoices-btn");

const invoicesBody = document.getElementById("invoices-body");
const statusMessage = document.getElementById("status-message");

const modal = document.getElementById("invoice-modal");
const modalTitle = document.getElementById("modal-title");
const modalSubtitle = document.getElementById("modal-subtitle");
const modalMeta = document.getElementById("modal-meta");
const modalLinksBody = document.getElementById("modal-links-body");
const modalCloseBtn = document.getElementById("modal-close-btn");
const goLettrageBtn = document.getElementById("go-lettrage-btn");

const backBtn = document.getElementById("back-compta-home-btn");
const logoutBtn = document.getElementById("logout-btn");

let currentInvoiceId = null;

function formatMoney(value) {
  return Number(value || 0).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + " €";
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartString() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function formatDate(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function statusLabel(status) {
  const map = {
    draft: "Brouillon",
    validated: "Validée",
    cancelled: "Annulée",
  };

  return map[status] || status || "";
}

async function loadSuppliers() {
  const res = await fetch(
    `${API_URL}/compta/suppliers?department_id=${activeDepartment.id}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  const data = await res.json();

  if (!res.ok) {
    console.error(data);
    alert(data.error || "Erreur chargement fournisseurs.");
    return;
  }

  supplierSelect.innerHTML =
    `<option value="">Tous</option>` +
    (data.suppliers || [])
      .map((s) => `<option value="${s.id}">${s.code || ""} — ${s.name || ""}</option>`)
      .join("");
}

async function loadInvoices() {
  if (!activeDepartment?.id) {
    alert("Rayon actif introuvable.");
    return;
  }

  const params = new URLSearchParams({
    department_id: activeDepartment.id,
    start_date: dateStartInput.value,
    end_date: dateEndInput.value,
  });

  if (supplierSelect.value) {
    params.set("supplier_id", supplierSelect.value);
  }

  if (statusSelect.value) {
    params.set("status", statusSelect.value);
  }

  if (searchInput.value.trim()) {
    params.set("search", searchInput.value.trim());
  }

  invoicesBody.innerHTML = `
    <tr>
      <td colspan="9">Chargement…</td>
    </tr>
  `;

  const res = await fetch(`${API_URL}/compta/supplier-invoices?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await res.json();

  if (!res.ok) {
    console.error(data);
    alert(data.error || "Erreur chargement factures.");
    return;
  }

  const invoices = data.invoices || [];

  statusMessage.textContent = `${invoices.length} facture(s)`;

  if (!invoices.length) {
    invoicesBody.innerHTML = `
      <tr>
        <td colspan="9">Aucune facture trouvée.</td>
      </tr>
    `;
    return;
  }

  invoicesBody.innerHTML = invoices.map((invoice) => `
    <tr data-id="${invoice.id}">
      <td>${formatDate(invoice.invoice_date)}</td>
      <td>${invoice.invoice_number || ""}</td>
      <td>${invoice.supplier_code || ""} — ${invoice.supplier_name || ""}</td>
      <td>${formatMoney(invoice.amount_ht)}</td>
      <td>${formatMoney(invoice.validated_amount_ht)}</td>
      <td>${formatMoney(invoice.gap_ht)}</td>
      <td>${statusLabel(invoice.status)}</td>
      <td>${invoice.notes || ""}</td>
      <td>
        <button class="btn btn-secondary btn-details">Voir</button>
      </td>
    </tr>
  `).join("");

  invoicesBody.querySelectorAll(".btn-details").forEach((button) => {
    button.addEventListener("click", openInvoiceDetails);
  });
}

async function openInvoiceDetails(event) {
  const row = event.target.closest("tr");
  currentInvoiceId = row.dataset.id;

  const res = await fetch(
    `${API_URL}/compta/supplier-invoices/${currentInvoiceId}?department_id=${activeDepartment.id}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  const data = await res.json();

  if (!res.ok) {
    console.error(data);
    alert(data.error || "Erreur détail facture.");
    return;
  }

  const invoice = data.invoice;
  const links = data.links || [];

  modalTitle.textContent = `Facture ${invoice.invoice_number || ""}`;
  modalSubtitle.textContent = `${invoice.supplier_code || ""} — ${invoice.supplier_name || ""}`;

  modalMeta.innerHTML = `
    <div><strong>Date :</strong> ${formatDate(invoice.invoice_date)}</div>
    <div><strong>Montant facture HT :</strong> ${formatMoney(invoice.amount_ht)}</div>
    <div><strong>Montant validé HT :</strong> ${formatMoney(invoice.validated_amount_ht)}</div>
    <div><strong>Écart HT :</strong> ${formatMoney(invoice.gap_ht)}</div>
    <div><strong>Statut :</strong> ${statusLabel(invoice.status)}</div>
    <div><strong>Note :</strong> ${invoice.notes || "—"}</div>
  `;

  if (!links.length) {
    modalLinksBody.innerHTML = `
      <tr>
        <td colspan="5">Aucun détail enregistré.</td>
      </tr>
    `;
  } else {
    modalLinksBody.innerHTML = links.map((link) => {
      const mode = link.purchase_line_id ? "Ligne" : "Achat complet";

      return `
        <tr>
          <td>${link.document_number || link.purchase_id || ""}</td>
          <td>${formatDate(link.purchase_date)}</td>
          <td>${mode}</td>
          <td>${link.supplier_label || ""}</td>
          <td>${formatMoney(link.linked_amount_ht)}</td>
        </tr>
      `;
    }).join("");
  }

  modal.style.display = "flex";
}

if (modalCloseBtn) {
  modalCloseBtn.addEventListener("click", () => {
    modal.style.display = "none";
    currentInvoiceId = null;
  });
}

if (goLettrageBtn) {
  goLettrageBtn.addEventListener("click", () => {
    if (!currentInvoiceId) return;

    window.location.href =
      `./compta-lettrage.html?invoice_id=${encodeURIComponent(currentInvoiceId)}`;
  });
}

if (loadInvoicesBtn) {
  loadInvoicesBtn.addEventListener("click", loadInvoices);
}

if (searchInput) {
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      loadInvoices();
    }
  });
}

if (backBtn) {
  backBtn.addEventListener("click", () => {
    window.location.href = "./compta-home.html";
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", () => {
    localStorage.removeItem("grv2_token");
    localStorage.removeItem("grv2_user");
    localStorage.removeItem("grv2_active_department");
    window.location.href = "./login.html";
  });
}

dateStartInput.value = monthStartString();
dateEndInput.value = todayString();

loadSuppliers();
loadInvoices();