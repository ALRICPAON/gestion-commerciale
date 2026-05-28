const API_BASE_URL = window.APP_CONFIG.API_BASE_URL;

const sessionUser = JSON.parse(localStorage.getItem("gc_user") || localStorage.getItem("grv2_user") || "null");
const authToken = localStorage.getItem("gc_token") || localStorage.getItem("grv2_token");

if (!sessionUser || !authToken) {
  window.location.href = "./login.html";
}

const tbody = document.getElementById("clients-tbody");
const userNameEl = document.getElementById("user-name");
const backHomeBtn = document.getElementById("back-home-btn");
const logoutBtn = document.getElementById("logout-btn");
const addClientBtn = document.getElementById("add-client-btn");

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

function getClientTypeLabel(type) {
  const labels = {
    standard: "Standard",
    grossiste: "Grossiste",
    gms: "GMS",
    restaurant: "Restaurant",
    poissonnerie: "Poissonnerie",
    export: "Export",
    autre: "Autre",
  };

  return labels[type] || type || "";
}

function canEditClient() {
  return ["admin", "responsable", "commercial"].includes(sessionUser.role);
}

function canChangeStatus() {
  return ["admin", "responsable"].includes(sessionUser.role);
}

function buildQueryString() {
  const params = new URLSearchParams();

  const search = searchInput?.value.trim();
  const status = statusFilter?.value;
  const clientType = typeFilter?.value;

  if (search) params.set("search", search);
  if (status && status !== "all") params.set("status", status);
  if (clientType && clientType !== "all") params.set("client_type", clientType);

  const query = params.toString();
  return query ? `?${query}` : "";
}

function renderClients(clients) {
  if (!clients.length) {
    tbody.innerHTML = `<tr><td colspan="9">Aucun client trouvé</td></tr>`;
    return;
  }

  tbody.innerHTML = clients
    .map((client) => {
      const status = client.status || "active";

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
          <td>${escapeHtml(client.code)}</td>
          <td>
            <strong>${escapeHtml(client.name)}</strong>
            ${
              client.legal_name
                ? `<br><small>${escapeHtml(client.legal_name)}</small>`
                : ""
            }
          </td>
          <td>${escapeHtml(getClientTypeLabel(client.client_type))}</td>
          <td>${escapeHtml(client.contact_name)}</td>
          <td>${escapeHtml(client.phone || client.mobile)}</td>
          <td>${escapeHtml(client.email)}</td>
          <td>${escapeHtml(client.city)}</td>
          <td>
            <span class="${status === "active" ? "badge-ok" : "badge-warning"}">
              ${escapeHtml(getStatusLabel(status))}
            </span>
          </td>
          <td>
            <button
              type="button"
              class="btn btn-secondary btn-sm client-open-btn"
              data-id="${escapeHtml(client.id)}"
            >
              Ouvrir
            </button>

            ${
              canChangeStatus()
                ? `
                  <button
                    type="button"
                    class="btn btn-muted btn-sm client-status-btn"
                    data-id="${escapeHtml(client.id)}"
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

async function loadClients() {
  try {
    tbody.innerHTML = `<tr><td colspan="9">Chargement...</td></tr>`;

    const response = await fetch(`${API_BASE_URL}/api/clients${buildQueryString()}`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    if (response.status === 401) {
      logoutAndRedirect();
      return;
    }

    if (!response.ok) {
      throw new Error("Impossible de charger les clients");
    }

    const clients = await response.json();

    renderClients(clients);
  } catch (err) {
    console.error("Erreur chargement clients :", err);
    tbody.innerHTML = `<tr><td colspan="9">Erreur lors du chargement</td></tr>`;
    showFeedback(err.message || "Erreur lors du chargement", "error");
  }
}

async function updateClientStatus(id, status) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/clients/${id}/status`, {
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
      throw new Error(data.error || "Erreur mise à jour client");
    }

    showFeedback("Statut client mis à jour.");
    await loadClients();
  } catch (err) {
    console.error("Erreur statut client :", err);
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

  addClientBtn?.addEventListener("click", () => {
    if (!canEditClient()) {
      showFeedback("Vous n'avez pas le droit de créer un client.", "error");
      return;
    }

    window.location.href = "./client-detail.html";
  });

  searchInput?.addEventListener("input", () => {
    clearTimeout(searchTimeout);
    searchTimeout = window.setTimeout(loadClients, 300);
  });

  statusFilter?.addEventListener("change", loadClients);
  typeFilter?.addEventListener("change", loadClients);

  resetFiltersBtn?.addEventListener("click", () => {
    if (searchInput) searchInput.value = "";
    if (statusFilter) statusFilter.value = "all";
    if (typeFilter) typeFilter.value = "all";
    loadClients();
  });

  tbody?.addEventListener("click", (event) => {
    const openBtn = event.target.closest(".client-open-btn");
    if (openBtn) {
      window.location.href = `./client-detail.html?id=${encodeURIComponent(openBtn.dataset.id)}`;
      return;
    }

    const statusBtn = event.target.closest(".client-status-btn");
    if (statusBtn) {
      updateClientStatus(statusBtn.dataset.id, statusBtn.dataset.status);
    }
  });
}

bindEvents();
loadClients();