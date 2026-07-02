(function () {
  const config = window.APP_CONFIG || {};
  const API_BASE_URL = config.API_BASE_URL || "";
  const authToken = localStorage.getItem("gc_token") || localStorage.getItem("grv2_token");
  const params = new URLSearchParams(window.location.search);

  function getEntityContext() {
    const pathname = window.location.pathname;
    const id = params.get("id");

    if (pathname.endsWith("/client-detail.html") && id) {
      return { type: "client", id, mountSelector: ".page-actions-right" };
    }

    if (pathname.endsWith("/supplier-detail.html") && id) {
      return { type: "supplier", id, mountSelector: ".page-actions-right" };
    }

    if ((pathname.endsWith("/customer-invoice-detail.html") || pathname.endsWith("/invoice-detail.html")) && id) {
      return { type: "customer_invoice", id, mountSelector: ".page-actions-right" };
    }

    if (pathname.endsWith("/supplier-invoice-detail.html") && id) {
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

    button.disabled = true;
    const initialLabel = button.textContent;
    button.textContent = "Mise en queue...";

    try {
      const response = await fetch(`${API_BASE_URL}/api/integrations/pennylane/sync/${context.type}/${context.id}`, {
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
