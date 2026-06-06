(function initPurchasesInitGuard() {
  const INIT_CHECK_DELAY_MS = 900;

  function getToken() {
    return localStorage.getItem("gc_token") || localStorage.getItem("grv2_token") || "";
  }

  function tableStillLoading() {
    const tableBody = document.getElementById("purchases-table-body");
    if (!tableBody) return false;
    const text = String(tableBody.textContent || "").trim().toLowerCase();
    return !text || text.includes("chargement");
  }

  function formatDateInput(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function ensureCurrentMonthFilters() {
    const fromInput = document.getElementById("purchase-date-from-filter");
    const toInput = document.getElementById("purchase-date-to-filter");
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);

    if (fromInput && !fromInput.value) fromInput.value = formatDateInput(firstDay);
    if (toInput && !toInput.value) toInput.value = formatDateInput(today);
  }

  async function fetchJson(path) {
    const API_BASE = window.APP_CONFIG?.API_BASE_URL;
    const token = getToken();

    if (!API_BASE) throw new Error("APP_CONFIG.API_BASE_URL manquant");
    if (!token) throw new Error("Token utilisateur manquant");

    const response = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Erreur API ${response.status}`);
    return data;
  }

  function formatDate(value) {
    if (!value) return "-";
    try {
      return new Date(value).toLocaleDateString("fr-FR");
    } catch (error) {
      return value;
    }
  }

  function formatCurrency(value) {
    return Number(value || 0).toLocaleString("fr-FR", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function formatPurchaseType(type) {
    return {
      order: "Commande",
      direct_bl: "BL direct",
      invoice_only: "Facture seule",
    }[type] || type || "-";
  }

  function formatPurchaseStatus(status) {
    return {
      draft: "Brouillon",
      ordered: "Commande",
      receiving: "Reception en cours",
      received: "Recu",
      received_pending_invoice: "Recu - facture attendue",
      invoice_matched: "Facture rapprochee",
      invoice_difference: "Ecart facture",
      invoice_validated: "Facture validee",
      cost_adjusted: "Cout ajuste",
      sent_pennylane: "Envoye Pennylane",
      closed: "Cloture",
      cancelled: "Annule",
    }[status] || status || "-";
  }

  function renderSuppliersFallback(suppliers) {
    const select = document.getElementById("purchase-supplier-filter");
    if (!select) return;
    select.innerHTML = `<option value="">Tous</option>`;
    suppliers.forEach((supplier) => {
      const option = document.createElement("option");
      option.value = supplier.id;
      option.textContent = `${supplier.code || ""} - ${supplier.name || ""}`.trim();
      select.appendChild(option);
    });
  }

  function renderPurchasesFallback(purchases) {
    const tableBody = document.getElementById("purchases-table-body");
    if (!tableBody) return;

    if (!Array.isArray(purchases) || purchases.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="8">Aucun achat trouve</td></tr>`;
      return;
    }

    tableBody.innerHTML = purchases.map((purchase) => `
      <tr>
        <td>${formatDate(purchase.order_date)}</td>
        <td>${purchase.supplier_name || "-"}</td>
        <td>${formatPurchaseType(purchase.purchase_type)}</td>
        <td><span class="purchase-status-badge status-${purchase.status || ""}">${formatPurchaseStatus(purchase.status)}</span></td>
        <td>${purchase.bl_number || "-"}</td>
        <td class="purchases-total-cell"><strong>${formatCurrency(purchase.total_amount_ex_vat)}</strong></td>
        <td>${purchase.line_count || 0}</td>
        <td>
          <div class="page-actions-right">
            <button class="btn btn-secondary btn-sm" data-action="open-purchase" data-id="${purchase.id}">Ouvrir</button>
          </div>
        </td>
      </tr>
    `).join("");
  }

  function purchaseQueryString() {
    const params = new URLSearchParams();
    const status = document.getElementById("purchase-status-filter")?.value;
    const supplierId = document.getElementById("purchase-supplier-filter")?.value;
    const dateFrom = document.getElementById("purchase-date-from-filter")?.value;
    const dateTo = document.getElementById("purchase-date-to-filter")?.value;

    if (status) params.set("status", status);
    if (supplierId) params.set("supplier_id", supplierId);
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);

    const query = params.toString();
    return query ? `?${query}` : "";
  }

  async function fallbackLoadPurchasesPage() {
    ensureCurrentMonthFilters();
    const suppliers = await fetchJson("/api/suppliers");
    renderSuppliersFallback(Array.isArray(suppliers) ? suppliers : []);
    const purchases = await fetchJson(`/api/purchases${purchaseQueryString()}`);
    renderPurchasesFallback(Array.isArray(purchases) ? purchases : []);
  }

  async function retryNativeInit() {
    if (typeof window.loadSuppliers !== "function" || typeof window.loadPurchases !== "function") {
      return false;
    }

    try {
      await window.loadSuppliers();
      if (typeof window.setCurrentMonthPurchaseDates === "function") {
        window.setCurrentMonthPurchaseDates();
      } else {
        ensureCurrentMonthFilters();
      }
      await window.loadPurchases();
      return true;
    } catch (error) {
      console.error("[Achats] Erreur relance init native purchases.js :", error);
      return false;
    }
  }

  async function ensurePurchasesInitialized() {
    if (!tableStillLoading()) return;

    console.warn("[Achats] La liste est encore en chargement, relance de l'initialisation achats.");
    const nativeOk = await retryNativeInit();
    if (nativeOk || !tableStillLoading()) return;

    try {
      await fallbackLoadPurchasesPage();
    } catch (error) {
      console.error("[Achats] Initialisation achats impossible :", error);
      const feedback = document.getElementById("purchases-feedback");
      if (feedback) {
        feedback.textContent = error.message || "Erreur chargement achats";
        feedback.classList.remove("hidden");
        feedback.classList.add("error");
        feedback.classList.remove("success");
      }
    }
  }

  function scheduleCheck() {
    window.setTimeout(() => {
      ensurePurchasesInitialized().catch((error) => {
        console.error("[Achats] Erreur inattendue garde init :", error);
      });
    }, INIT_CHECK_DELAY_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleCheck, { once: true });
  } else {
    scheduleCheck();
  }
})();
