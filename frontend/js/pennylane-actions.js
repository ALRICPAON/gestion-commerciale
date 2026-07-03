(function () {
  const config = window.APP_CONFIG || {};
  const API_BASE_URL = config.API_BASE_URL || "";
  const authToken = localStorage.getItem("gc_token") || localStorage.getItem("grv2_token");
  const params = new URLSearchParams(window.location.search);
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  const entityAliases = {
    client: ["client", "clients", "customer", "customers"],
    supplier: ["supplier", "suppliers", "fournisseur", "fournisseurs"],
    customer_invoice: ["customer_invoice", "customer-invoice", "customer_invoices", "customer-invoices", "invoice", "invoices", "facture_client", "facture-client"],
    supplier_invoice: ["supplier_invoice", "supplier-invoice", "supplier_invoices", "supplier-invoices", "facture_fournisseur", "facture-fournisseur"],
  };

  const idParamNames = {
    client: ["client_id", "clientId", "customer_id", "customerId", "client_uuid", "clientUuid", "uuid", "id"],
    supplier: ["supplier_id", "supplierId", "fournisseur_id", "fournisseurId", "supplier_uuid", "supplierUuid", "uuid", "id"],
    customer_invoice: ["invoice_id", "invoiceId", "customer_invoice_id", "customerInvoiceId", "sales_document_id", "salesDocumentId", "document_id", "documentId", "uuid", "id"],
    supplier_invoice: ["invoice_id", "invoiceId", "supplier_invoice_id", "supplierInvoiceId", "purchase_invoice_id", "purchaseInvoiceId", "document_id", "documentId", "uuid", "id"],
  };

  function normalizeEntityType(type) {
    const normalized = String(type || "").trim().toLowerCase().replace(/\s+/g, "_");
    if (!normalized) return null;

    return Object.keys(entityAliases).find((entityType) => entityAliases[entityType].includes(normalized)) || null;
  }

  function getParamValue(names) {
    const values = names.map((name) => params.get(name)).filter(Boolean);
    return values.find((value) => uuidPattern.test(value)) || values[0] || null;
  }

  function getEntityId(type) {
    return getParamValue(idParamNames[type] || ["id"]);
  }

  function normalizeContext(context) {
    if (!context) return null;

    const type = normalizeEntityType(context.type || context.entityType || context.entity_type);
    if (!type) return null;

    const id = context.id || context.entityId || context.entity_id || getEntityId(type);
    if (!id) return null;

    return { ...context, type, id: String(id) };
  }

  function getEntityContext() {
    const pathname = window.location.pathname;
    const explicitType = normalizeEntityType(params.get("pennylane_type") || params.get("entity_type") || params.get("type"));
    if (explicitType) {
      const id = getEntityId(explicitType);
      if (id) return { type: explicitType, id, mountSelector: ".page-actions-right" };
    }

    if ((pathname.endsWith("/client-detail.html") || pathname.endsWith("/clients-detail.html")) && getEntityId("client")) {
      const id = getEntityId("client");
      return { type: "client", id, mountSelector: ".page-actions-right" };
    }

    if ((pathname.endsWith("/supplier-detail.html") || pathname.endsWith("/suppliers-detail.html")) && getEntityId("supplier")) {
      const id = getEntityId("supplier");
      return { type: "supplier", id, mountSelector: ".page-actions-right" };
    }

    if ((pathname.endsWith("/customer-invoice-detail.html") || pathname.endsWith("/invoice-detail.html")) && getEntityId("customer_invoice")) {
      const id = getEntityId("customer_invoice");
      return { type: "customer_invoice", id, mountSelector: ".page-actions-right" };
    }

    if (pathname.endsWith("/supplier-invoice-detail.html") && getEntityId("supplier_invoice")) {
      const id = getEntityId("supplier_invoice");
      return { type: "supplier_invoice", id, mountSelector: ".page-actions-right" };
    }

    return null;
  }

  function showFeedback(message, type) {
    const feedback = document.getElementById("page-feedback");
    if (!feedback) return;

    feedback.textContent = message;
    feedback.className = `page-feedback ${type || "success"}`;
    window.setTimeout(() => {
      feedback.textContent = "";
      feedback.className = "page-feedback hidden";
    }, 3500);
  }

  async function enqueueManualSync(context, button) {
    if (!authToken) return;

    const syncContext = normalizeContext(context);
    if (!syncContext) {
      showFeedback("Demande de synchronisation Pennylane invalide", "error");
      return;
    }

    button.disabled = true;
    const initialLabel = button.textContent;
    button.textContent = "Mise en queue...";

    try {
      const response = await fetch(`${API_BASE_URL}/api/integrations/pennylane/sync/${encodeURIComponent(syncContext.type)}/${encodeURIComponent(syncContext.id)}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
      });

      if (response.status === 401) {
        window.location.href = "./login.html";
        return;
      }

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Synchronisation Pennylane impossible");

      showFeedback(data.reused ? "Job Pennylane relance dans la queue." : "Job Pennylane ajoute a la queue.");
    } catch (err) {
      console.error("Erreur synchronisation manuelle Pennylane :", err);
      showFeedback(err.message || "Erreur synchronisation Pennylane", "error");
    } finally {
      button.disabled = false;
      button.textContent = initialLabel;
    }
  }

  function mountDetailButton() {
    const context = getEntityContext();
    if (!context || !authToken) return;

    const mount = document.querySelector(context.mountSelector);
    if (!mount || document.getElementById("pennylane-manual-sync-btn")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.id = "pennylane-manual-sync-btn";
    button.className = "btn btn-secondary";
    button.textContent = "Synchroniser avec Pennylane";
    button.addEventListener("click", () => enqueueManualSync(context, button));
    mount.prepend(button);
  }

  function mountCustomerInvoicesEntry() {
    if (!window.location.pathname.endsWith("/home.html")) return;
    if (document.querySelector('[data-module="customer-invoices"]')) return;

    const commerceGrid = document.querySelector('[data-module="sales"]')?.parentElement;
    if (!commerceGrid) return;

    const link = document.createElement("a");
    link.className = "module-card";
    link.href = "./customer-invoices.html";
    link.dataset.module = "customer-invoices";
    link.innerHTML = `
      <span class="module-icon" aria-hidden="true">FAC</span>
      <h3>Factures clients</h3>
      <p>Suivi paiement, synchro Pennylane et alertes commerciales.</p>
    `;
    commerceGrid.appendChild(link);
  }

  function mountPennylaneUi() {
    mountDetailButton();
    mountCustomerInvoicesEntry();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountPennylaneUi);
  } else {
    mountPennylaneUi();
  }

  window.enqueuePennylaneManualSync = enqueueManualSync;
})();
