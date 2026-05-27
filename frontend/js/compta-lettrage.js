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

const supplierSelect = document.getElementById("supplier-select");
const invoiceDateInput = document.getElementById("invoice-date");
const invoiceNumberInput = document.getElementById("invoice-number");
const invoiceAmountInput = document.getElementById("invoice-amount-ht");
const invoiceRealAmountInput = document.getElementById("invoice-real-amount-ht");

const filterModeInput = document.getElementById("filter-mode");
const dateStartInput = document.getElementById("date-start");
const dateEndInput = document.getElementById("date-end");
const loadPurchasesBtn = document.getElementById("load-purchases-btn");

const purchasesBody = document.getElementById("purchases-body");

const sumInvoiceHt = document.getElementById("sum-invoice-ht");
const sumLinkedHt = document.getElementById("sum-linked-ht");
const sumGapHt = document.getElementById("sum-gap-ht");

const gapNoteInput = document.getElementById("gap-note");
const validateInvoiceBtn = document.getElementById("validate-invoice-btn");
const statusMessage = document.getElementById("status-message");

const linesModal = document.getElementById("lines-modal");
const linesModalTitle = document.getElementById("lines-modal-title");
const linesModalClose = document.getElementById("lines-modal-close");
const purchaseLinesBody = document.getElementById("purchase-lines-body");
const applyLinesBtn = document.getElementById("apply-lines-btn");

const backBtn = document.getElementById("back-compta-home-btn");
const logoutBtn = document.getElementById("logout-btn");

let purchasesCache = [];
let selection = new Map();
let currentPurchaseId = null;
let invoiceRealTouched = false;
let editingInvoiceId = null;

function toNum(value) {
  if (value == null) return 0;
  const n = Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

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

function refreshSummary() {
  const invoiceAmount = toNum(invoiceAmountInput.value);
  const linkedTotal = [...selection.values()].reduce(
    (sum, item) => sum + toNum(item.total_ht),
    0
  );

  if (!invoiceRealTouched) {
    invoiceRealAmountInput.value = invoiceAmount.toFixed(2);
  }

  const realAmount = toNum(invoiceRealAmountInput.value || invoiceAmount);
  const gap = realAmount - linkedTotal;

  sumInvoiceHt.textContent = formatMoney(invoiceAmount);
  sumLinkedHt.textContent = formatMoney(linkedTotal);
  sumGapHt.textContent = formatMoney(gap);
}

async function loadSuppliers() {
  if (!activeDepartment?.id) {
    alert("Rayon actif introuvable.");
    return;
  }

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
    `<option value="">-- Choisir --</option>` +
    (data.suppliers || [])
      .map((s) => `<option value="${s.id}">${s.code || ""} — ${s.name || ""}</option>`)
      .join("");
}

async function loadInvoiceForEdit() {
  const params = new URLSearchParams(window.location.search);
  const invoiceId = params.get("invoice_id");

  if (!invoiceId) return;

  editingInvoiceId = invoiceId;

  const res = await fetch(
    `${API_URL}/compta/supplier-invoices/${invoiceId}?department_id=${activeDepartment.id}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  const data = await res.json();

  if (!res.ok) {
    console.error(data);
    alert(data.error || "Erreur chargement facture à modifier.");
    return;
  }

  const invoice = data.invoice;

  supplierSelect.value = invoice.supplier_id;
  invoiceDateInput.value = String(invoice.invoice_date).slice(0, 10);
  invoiceNumberInput.value = invoice.invoice_number || "";
  invoiceAmountInput.value = Number(invoice.amount_ht || 0).toFixed(2);
  invoiceRealAmountInput.value = Number(invoice.validated_amount_ht || 0).toFixed(2);
  gapNoteInput.value = invoice.notes || "";

  invoiceRealTouched = true;

  statusMessage.textContent =
  "Facture chargée en modification. Les anciens liens seront remplacés à la validation.";

filterModeInput.value = "all";

await loadPurchases();
}

async function loadPurchases() {
  const supplierId = supplierSelect.value;

  if (!supplierId) {
    alert("Choisis un fournisseur.");
    return;
  }

  const params = new URLSearchParams({
  department_id: activeDepartment.id,
  supplier_id: supplierId,
  mode: filterModeInput.value,
  invoice_id: editingInvoiceId || "",
});

  if (dateStartInput.value) {
    params.set("start_date", dateStartInput.value);
  }

  if (dateEndInput.value) {
    params.set("end_date", dateEndInput.value);
  }

  purchasesBody.innerHTML = `
    <tr>
      <td colspan="6">Chargement…</td>
    </tr>
  `;

  const res = await fetch(`${API_URL}/compta/supplier-purchases?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await res.json();

  if (!res.ok) {
    console.error(data);
    alert(data.error || "Erreur chargement achats fournisseur.");
    return;
  }

  purchasesCache = data.purchases || [];
  selection.clear();
  renderPurchases();
  refreshSummary();
}

function renderPurchases() {
  if (!purchasesCache.length) {
    purchasesBody.innerHTML = `
      <tr>
        <td colspan="6">Aucun achat à afficher.</td>
      </tr>
    `;
    return;
  }

  purchasesBody.innerHTML = purchasesCache.map((p) => {
    const selected = selection.get(p.id)?.mode === "full";
    const disabled = p.already_linked ? "disabled" : "";

    return `
      <tr data-id="${p.id}">
        <td>${p.purchase_date?.slice(0, 10) || ""}</td>
        <td>${p.document_number || p.id}</td>
        <td>${formatMoney(p.total_amount_ex_vat)}</td>
        <td>
          <input type="checkbox" class="purchase-full-checkbox" ${selected ? "checked" : ""} ${disabled}>
        </td>
        <td>
          <button class="btn btn-secondary btn-lines" ${disabled}>Voir lignes</button>
        </td>
        <td>${p.already_linked ? "Oui" : "Non"}</td>
      </tr>
    `;
  }).join("");

  purchasesBody.querySelectorAll(".purchase-full-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", onToggleFullPurchase);
  });

  purchasesBody.querySelectorAll(".btn-lines").forEach((button) => {
    button.addEventListener("click", openPurchaseLines);
  });
}

function onToggleFullPurchase(event) {
  const row = event.target.closest("tr");
  const purchaseId = row.dataset.id;
  const purchase = purchasesCache.find((p) => p.id === purchaseId);

  if (!purchase) return;

  if (event.target.checked) {
    selection.set(purchaseId, {
      mode: "full",
      purchase_id: purchaseId,
      purchase_line_ids: [],
      total_ht: toNum(purchase.total_amount_ex_vat),
    });
  } else {
    selection.delete(purchaseId);
  }

  refreshSummary();
}

async function openPurchaseLines(event) {
  const row = event.target.closest("tr");
  currentPurchaseId = row.dataset.id;

  const purchase = purchasesCache.find((p) => p.id === currentPurchaseId);

  linesModalTitle.textContent = `Détail achat ${purchase?.document_number || currentPurchaseId}`;
  purchaseLinesBody.innerHTML = `
    <tr>
      <td colspan="5">Chargement…</td>
    </tr>
  `;
  linesModal.style.display = "flex";

  const res = await fetch(
    `${API_URL}/compta/purchase-lines/${currentPurchaseId}?department_id=${activeDepartment.id}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  const data = await res.json();

  if (!res.ok) {
    console.error(data);
    alert(data.error || "Erreur chargement lignes achat.");
    return;
  }

  const previous = selection.get(currentPurchaseId);
  const selectedLines = new Set(previous?.purchase_line_ids || []);

  purchaseLinesBody.innerHTML = (data.lines || []).map((line) => {
    const disabled = line.already_linked ? "disabled" : "";
    const checked = selectedLines.has(line.id) ? "checked" : "";

    return `
      <tr
        data-line-id="${line.id}"
        data-total-ht="${line.line_total_ex_vat || 0}"
      >
        <td>${line.article_label || ""}</td>
        <td>${line.received_quantity || line.ordered_quantity || 0}</td>
        <td>${formatMoney(line.unit_price_ex_vat)}</td>
        <td>${formatMoney(line.line_total_ex_vat)}</td>
        <td>
          <input type="checkbox" class="line-checkbox" ${checked} ${disabled}>
        </td>
      </tr>
    `;
  }).join("");
}

function applyLinesSelection() {
  if (!currentPurchaseId) return;

  const checkedRows = [...purchaseLinesBody.querySelectorAll("tr")]
    .filter((row) => row.querySelector(".line-checkbox")?.checked);

  if (!checkedRows.length) {
    selection.delete(currentPurchaseId);
  } else {
    const purchaseLineIds = checkedRows.map((row) => row.dataset.lineId);
    const totalHt = checkedRows.reduce(
      (sum, row) => sum + toNum(row.dataset.totalHt),
      0
    );

    selection.set(currentPurchaseId, {
      mode: "lines",
      purchase_id: currentPurchaseId,
      purchase_line_ids: purchaseLineIds,
      total_ht: totalHt,
    });
  }

  linesModal.style.display = "none";
  currentPurchaseId = null;

  renderPurchases();
  refreshSummary();
}

async function validateInvoice() {
  const supplierId = supplierSelect.value;
  const invoiceDate = invoiceDateInput.value;
  const invoiceNumber = invoiceNumberInput.value.trim();

  if (!supplierId) {
    alert("Choisis un fournisseur.");
    return;
  }

  if (!invoiceDate) {
    alert("Choisis une date de facture.");
    return;
  }

  if (!invoiceNumber) {
    alert("Saisis un numéro de facture.");
    return;
  }

  if (selection.size === 0) {
    alert("Aucun achat ou ligne pointé.");
    return;
  }

  const links = [];

  for (const item of selection.values()) {
    if (item.mode === "full") {
      links.push({
        purchase_id: item.purchase_id,
        purchase_line_id: null,
        linked_amount_ht: item.total_ht,
      });
    }

    if (item.mode === "lines") {
      const perLineTotal = item.total_ht / item.purchase_line_ids.length;

      item.purchase_line_ids.forEach((lineId) => {
        links.push({
          purchase_id: item.purchase_id,
          purchase_line_id: lineId,
          linked_amount_ht: perLineTotal,
        });
      });
    }
  }

  const body = {
    department_id: activeDepartment.id,
    supplier_id: supplierId,
    invoice_date: invoiceDate,
    invoice_number: invoiceNumber,
    amount_ht: toNum(invoiceAmountInput.value),
    validated_amount_ht: toNum(invoiceRealAmountInput.value || invoiceAmountInput.value),
    notes: gapNoteInput.value || null,
    links,
  };

  const method = editingInvoiceId ? "PUT" : "POST";
  const endpoint = editingInvoiceId
    ? `${API_URL}/compta/supplier-invoices/${editingInvoiceId}`
    : `${API_URL}/compta/supplier-invoices`;

  const res = await fetch(endpoint, {
    method: method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error(data);
    alert(data.error || "Erreur validation facture.");
    return;
  }

  const actionLabel = editingInvoiceId ? "modifiée" : "créée";
  statusMessage.textContent =
    `Facture ${actionLabel}. Total pointé : ${formatMoney(data.total_linked_ht)} — Écart : ${formatMoney(data.gap_ht)}`;

  alert(`Facture fournisseur ${actionLabel}.`);

  selection.clear();
  await loadPurchases();
}

if (invoiceAmountInput) {
  invoiceAmountInput.addEventListener("input", () => {
    if (!invoiceRealTouched) {
      invoiceRealAmountInput.value = toNum(invoiceAmountInput.value).toFixed(2);
    }

    refreshSummary();
  });
}

if (invoiceRealAmountInput) {
  invoiceRealAmountInput.addEventListener("input", () => {
    invoiceRealTouched = true;
    refreshSummary();
  });
}

if (loadPurchasesBtn) {
  loadPurchasesBtn.addEventListener("click", loadPurchases);
}

if (filterModeInput) {
  filterModeInput.addEventListener("change", loadPurchases);
}

if (dateStartInput) {
  dateStartInput.addEventListener("change", () => {
    if (supplierSelect.value) loadPurchases();
  });
}

if (dateEndInput) {
  dateEndInput.addEventListener("change", () => {
    if (supplierSelect.value) loadPurchases();
  });
}

if (validateInvoiceBtn) {
  validateInvoiceBtn.addEventListener("click", validateInvoice);
}

if (linesModalClose) {
  linesModalClose.addEventListener("click", () => {
    linesModal.style.display = "none";
    currentPurchaseId = null;
  });
}

if (applyLinesBtn) {
  applyLinesBtn.addEventListener("click", applyLinesSelection);
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

invoiceDateInput.value = todayString();
dateStartInput.value = monthStartString();
dateEndInput.value = todayString();

loadSuppliers().then(() => {
  loadInvoiceForEdit();
});

refreshSummary();