const API_BASE_URL = window.APP_CONFIG.API_BASE_URL;

const sessionUser = JSON.parse(localStorage.getItem("gc_user") || localStorage.getItem("grv2_user") || "null");
const authToken = localStorage.getItem("gc_token") || localStorage.getItem("grv2_token");

if (!sessionUser || !authToken) {
  window.location.href = "./login.html";
}

const tbody = document.getElementById("suppliers-tbody");
const userNameEl = document.getElementById("user-name");
const backHomeBtn = document.getElementById("back-home-btn");
const logoutBtn = document.getElementById("logout-btn");
const addSupplierBtn = document.getElementById("add-supplier-btn");

const searchInput = document.getElementById("search-input");
const statusFilter = document.getElementById("status-filter");
const typeFilter = document.getElementById("type-filter");
const resetFiltersBtn = document.getElementById("reset-filters-btn");
const pageFeedback = document.getElementById("page-feedback");

let searchTimeout = null;

function escapeHtml(value) {
  if (value === null || value === undefined) return "";

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function logoutAndRedirect() {
  localStorage.removeItem("gc_token");
  localStorage.removeItem("gc_user");
  localStorage.removeItem("gc_active_department");
  localStorage.removeItem("grv2_token");
  localStorage.removeItem("grv2_user");
  localStorage.removeItem("grv2_active_department");
  window.location.href = "./login.html";
}

function showFeedback(message, type = "success") {
  if (!pageFeedback) return;

  pageFeedback.textContent = message;
  pageFeedback.className = `feedback-box ${type}`;

  window.setTimeout(() => {
    pageFeedback.className = "feedback-box hidden";
    pageFeedback.textContent = "";
  }, 3500);
}

function getStatusLabel(status) {
  if (status === "active") return "Actif";
  if (status === "inactive") return "Inactif";
  if (status === "blocked") return "Bloqué";
  return status || "";
}

function getSupplierTypeLabel(type) {
  const labels = {
    standard: "Standard",
    mareyeur: "Mareyeur",
    criee: "Criée",
    importateur: "Importateur",
    transporteur: "Transporteur",
    emballage: "Emballage",
    autre: "Autre",
  };

  return labels[type] || type || "";
}

function canEditSupplier() {
  return ["admin", "responsable", "commercial"].includes(sessionUser.role);
}

function canChangeStatus() {
  return ["admin", "responsable"].includes(sessionUser.role);
}

function buildQueryString() {
  const params = new URLSearchParams();

  const search = searchInput?.value.trim();
  const status = statusFilter?.value;
  const supplierType = typeFilter?.value;

  if (search) params.set("search", search);
  if (status && status !== "all") params.set("status", status);
  if (supplierType && supplierType !== "all") params.set("supplier_type", supplierType);

  const query = params.toString();
  return query ? `?${query}` : "";
}

function renderSuppliers(suppliers) {
  if (!suppliers.length) {
    tbody.innerHTML = `<tr><td colspan="9">Aucun fournisseur trouvé</td></tr>`;
    return;
  }

  tbody.innerHTML = suppliers
    .map((supplier) => {
      const status = supplier.status || "active";

      let nextStatus = "inactive";
      let actionLabel = "Désactiver";

      if (status === "inactive") {
        nextStatus = "active";
        actionLabel = "Réactiver";
      }

      if (status === "blocked") {
        nextStatus = "active";
        actionLabel = "Débloquer";
      }

      return `
        <tr>
          <td>${escapeHtml(supplier.code)}</td>
          <td>
            <strong>${escapeHtml(supplier.name)}</strong>
            ${
              supplier.legal_name
                ? `<br><small>${escapeHtml(supplier.legal_name)}</small>`
                : ""
            }
          </td>
          <td>${escapeHtml(getSupplierTypeLabel(supplier.supplier_type))}</td>
          <td>${escapeHtml(supplier.contact_name)}</td>
          <td>${escapeHtml(supplier.phone || supplier.mobile)}</td>
          <td>${escapeHtml(supplier.email)}</td>
          <td>${escapeHtml(supplier.city)}</td>
          <td>
            <span class="${status === "active" ? "badge-ok" : "badge-warning"}">
              ${escapeHtml(getStatusLabel(status))}
            </span>
          </td>
          <td>
            <button
              type="button"
              class="btn btn-secondary btn-sm supplier-open-btn"
              data-id="${escapeHtml(supplier.id)}"
            >
              Ouvrir
            </button>

            ${
              canChangeStatus()
                ? `
                  <button
                    type="button"
                    class="btn btn-muted btn-sm supplier-status-btn"
                    data-id="${escapeHtml(supplier.id)}"
                    data-status="${escapeHtml(nextStatus)}"
                  >
                    ${actionLabel}
                  </button>
                `
                : ""
            }
          </td>
        </tr>
      `;
    })
    .join("");
}

async function loadSuppliers() {
  try {
    tbody.innerHTML = `<tr><td colspan="9">Chargement...</td></tr>`;

    const response = await fetch(`${API_BASE_URL}/api/suppliers${buildQueryString()}`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    if (response.status === 401) {
      logoutAndRedirect();
      return;
    }

    if (!response.ok) {
      throw new Error("Impossible de charger les fournisseurs");
    }

    const suppliers = await response.json();

    renderSuppliers(suppliers);
  } catch (err) {
    console.error("Erreur chargement fournisseurs :", err);
    tbody.innerHTML = `<tr><td colspan="9">Erreur lors du chargement</td></tr>`;
    showFeedback(err.message || "Erreur lors du chargement", "error");
  }
}

async function updateSupplierStatus(id, status) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/suppliers/${id}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ status }),
    });

    if (response.status === 401) {
      logoutAndRedirect();
      return;
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "Erreur mise à jour fournisseur");
    }

    showFeedback("Statut fournisseur mis à jour.");
    await loadSuppliers();
  } catch (err) {
    console.error("Erreur statut fournisseur :", err);
    showFeedback(err.message || "Erreur mise à jour", "error");
  }
}

function bindEvents() {
  if (userNameEl) {
    userNameEl.textContent = sessionUser.email || "Utilisateur";
  }

  backHomeBtn?.addEventListener("click", () => {
    window.location.href = "./home.html";
  });

  logoutBtn?.addEventListener("click", logoutAndRedirect);

  addSupplierBtn?.addEventListener("click", () => {
    if (!canEditSupplier()) {
      showFeedback("Vous n’avez pas le droit de créer un fournisseur.", "error");
      return;
    }

    window.location.href = "./supplier-detail.html";
  });

  searchInput?.addEventListener("input", () => {
    clearTimeout(searchTimeout);
    searchTimeout = window.setTimeout(loadSuppliers, 300);
  });

  statusFilter?.addEventListener("change", loadSuppliers);
  typeFilter?.addEventListener("change", loadSuppliers);

  resetFiltersBtn?.addEventListener("click", () => {
    if (searchInput) searchInput.value = "";
    if (statusFilter) statusFilter.value = "all";
    if (typeFilter) typeFilter.value = "all";
    loadSuppliers();
  });

  tbody?.addEventListener("click", (event) => {
    const openBtn = event.target.closest(".supplier-open-btn");
    if (openBtn) {
      window.location.href = `./supplier-detail.html?id=${encodeURIComponent(openBtn.dataset.id)}`;
      return;
    }

    const statusBtn = event.target.closest(".supplier-status-btn");
    if (statusBtn) {
      updateSupplierStatus(statusBtn.dataset.id, statusBtn.dataset.status);
    }
  });
}

bindEvents();
loadSuppliers();