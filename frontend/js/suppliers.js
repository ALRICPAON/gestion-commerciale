const API_BASE_URL = window.APP_CONFIG.API_BASE_URL;

const sessionUser = JSON.parse(localStorage.getItem("grv2_user") || "null");
const authToken = localStorage.getItem("grv2_token");

if (!sessionUser || !authToken) {
  window.location.href = "./login.html";
}

const tbody = document.getElementById("suppliers-tbody");
const userNameEl = document.getElementById("user-name");
const backHomeBtn = document.getElementById("back-home-btn");
const logoutBtn = document.getElementById("logout-btn");

const addBtn = document.getElementById("add-supplier-btn");
const modal = document.getElementById("supplier-modal");
const saveBtn = document.getElementById("save-supplier-btn");
const closeBtn = document.getElementById("close-modal-btn");

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
  localStorage.removeItem("grv2_token");
  localStorage.removeItem("grv2_user");
  localStorage.removeItem("grv2_active_department");
  window.location.href = "./login.html";
}

function openModal() {
  modal?.classList.remove("hidden");
}

function closeModal() {
  modal?.classList.add("hidden");
}

function resetForm() {
  document.getElementById("sup-code").value = "";
  document.getElementById("sup-name").value = "";
  document.getElementById("sup-contact").value = "";
  document.getElementById("sup-phone").value = "";
  document.getElementById("sup-email").value = "";
  document.getElementById("sup-address").value = "";
}

function renderSuppliers(suppliers) {
  if (!suppliers.length) {
    tbody.innerHTML = `<tr><td colspan="7">Aucun fournisseur</td></tr>`;
    return;
  }

  tbody.innerHTML = suppliers
    .map((s) => {
      const statusLabel = s.is_active ? "Actif" : "Inactif";
      const actionLabel = s.is_active ? "Désactiver" : "Activer";

      return `
        <tr>
          <td>${escapeHtml(s.code)}</td>
          <td>${escapeHtml(s.name)}</td>
          <td>${escapeHtml(s.contact_name)}</td>
          <td>${escapeHtml(s.phone)}</td>
          <td>${escapeHtml(s.email)}</td>
          <td>${statusLabel}</td>
          <td>
            <button
              class="btn btn-secondary supplier-toggle-btn"
              data-id="${s.id}"
              data-active="${s.is_active}"
            >
              ${actionLabel}
            </button>
          </td>
        </tr>
      `;
    })
    .join("");
}

async function loadSuppliers() {
  try {
    tbody.innerHTML = `<tr><td colspan="7">Chargement...</td></tr>`;

    const response = await fetch(`${API_BASE_URL}/api/suppliers`, {
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
    tbody.innerHTML = `<tr><td colspan="7">Erreur lors du chargement</td></tr>`;
  }
}

async function createSupplier() {
  const body = {
    code: document.getElementById("sup-code").value.trim(),
    name: document.getElementById("sup-name").value.trim(),
    contact_name: document.getElementById("sup-contact").value.trim(),
    phone: document.getElementById("sup-phone").value.trim(),
    email: document.getElementById("sup-email").value.trim(),
    address: document.getElementById("sup-address").value.trim(),
  };

  if (!body.code || !body.name) {
    alert("Le code et le nom sont obligatoires.");
    return;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/suppliers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(body),
    });

    if (response.status === 401) {
      logoutAndRedirect();
      return;
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Erreur création fournisseur");
    }

    closeModal();
    resetForm();
    await loadSuppliers();
  } catch (err) {
    console.error("Erreur création fournisseur :", err);
    alert(err.message || "Erreur création fournisseur");
  }
}

async function toggleSupplier(id, currentStatus) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/suppliers/${id}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ is_active: !currentStatus }),
    });

    if (response.status === 401) {
      logoutAndRedirect();
      return;
    }

    if (!response.ok) {
      throw new Error("Erreur mise à jour fournisseur");
    }

    await loadSuppliers();
  } catch (err) {
    console.error("Erreur mise à jour fournisseur :", err);
    alert("Erreur mise à jour");
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

  addBtn?.addEventListener("click", openModal);
  closeBtn?.addEventListener("click", closeModal);
  saveBtn?.addEventListener("click", createSupplier);

  tbody?.addEventListener("click", (event) => {
    const button = event.target.closest(".supplier-toggle-btn");
    if (!button) return;

    const supplierId = button.dataset.id;
    const currentStatus = button.dataset.active === "true";

    toggleSupplier(supplierId, currentStatus);
  });
}

bindEvents();
loadSuppliers();