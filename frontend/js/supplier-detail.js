const API_BASE_URL = window.APP_CONFIG.API_BASE_URL;

const sessionUser = JSON.parse(localStorage.getItem("grv2_user") || "null");
const authToken = localStorage.getItem("grv2_token");

if (!sessionUser || !authToken) {
  window.location.href = "./login.html";
}

const params = new URLSearchParams(window.location.search);
const supplierId = params.get("id");

const userNameEl = document.getElementById("user-name");
const backListBtn = document.getElementById("back-list-btn");
const backHomeBtn = document.getElementById("back-home-btn");
const logoutBtn = document.getElementById("logout-btn");

const formTitle = document.getElementById("form-title");
const formDescription = document.getElementById("form-description");
const pageSubtitle = document.getElementById("page-subtitle");
const pageFeedback = document.getElementById("page-feedback");

const saveSupplierBtn = document.getElementById("save-supplier-btn");
const statusSupplierBtn = document.getElementById("status-supplier-btn");

const fields = [
  "code",
  "name",
  "legal_name",
  "supplier_type",
  "status",
  "contact_name",
  "phone",
  "mobile",
  "email",
  "address_line1",
  "address_line2",
  "postal_code",
  "city",
  "country",
  "vat_number",
  "siret",
  "payment_terms",
  "delivery_terms",
  "notes",
];

let currentSupplier = null;

function logoutAndRedirect() {
  localStorage.removeItem("grv2_token");
  localStorage.removeItem("grv2_user");
  localStorage.removeItem("grv2_active_department");
  window.location.href = "./login.html";
}

function showFeedback(message, type = "success") {
  if (!pageFeedback) return;

  pageFeedback.textContent = message;
  pageFeedback.className = `page-feedback ${type}`;

  window.setTimeout(() => {
    pageFeedback.className = "page-feedback hidden";
    pageFeedback.textContent = "";
  }, 3500);
}

function canEditSupplier() {
  return ["admin", "responsable", "commercial"].includes(sessionUser.role);
}

function canChangeStatus() {
  return ["admin", "responsable"].includes(sessionUser.role);
}

function setFieldValue(id, value) {
  const el = document.getElementById(id);
  if (!el) return;

  el.value = value ?? "";
}

function getFieldValue(id) {
  const el = document.getElementById(id);
  if (!el) return null;

  const value = el.value.trim();
  return value === "" ? null : value;
}

function fillForm(supplier) {
  fields.forEach((field) => {
    setFieldValue(field, supplier[field]);
  });

  if (!supplier.country) {
    setFieldValue("country", "France");
  }
}

function collectPayload() {
  const payload = {};

  fields.forEach((field) => {
    payload[field] = getFieldValue(field);
  });

  if (!payload.country) {
    payload.country = "France";
  }

  if (!payload.supplier_type) {
    payload.supplier_type = "standard";
  }

  if (!payload.status) {
    payload.status = "active";
  }

  return payload;
}

function updateHeader() {
  if (!supplierId) {
    formTitle.textContent = "Nouveau fournisseur";
    formDescription.textContent = "Crée une nouvelle fiche fournisseur.";
    pageSubtitle.textContent = "Nouveau fournisseur";
    statusSupplierBtn?.classList.add("hidden");
    return;
  }

  const name = currentSupplier?.name || "Fournisseur";

  formTitle.textContent = name;
  formDescription.textContent = "Consulte et modifie la fiche fournisseur.";
  pageSubtitle.textContent = name;

  if (canChangeStatus() && currentSupplier) {
    statusSupplierBtn?.classList.remove("hidden");

    if (currentSupplier.status === "active") {
      statusSupplierBtn.textContent = "Désactiver";
      statusSupplierBtn.dataset.status = "inactive";
    } else {
      statusSupplierBtn.textContent = "Réactiver";
      statusSupplierBtn.dataset.status = "active";
    }
  }
}

function lockFormIfNeeded() {
  if (canEditSupplier()) return;

  fields.forEach((field) => {
    const el = document.getElementById(field);
    if (el) el.disabled = true;
  });

  saveSupplierBtn.disabled = true;
}

async function loadSupplier() {
  if (!supplierId) {
    updateHeader();
    lockFormIfNeeded();
    return;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/suppliers/${supplierId}`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    if (response.status === 401) {
      logoutAndRedirect();
      return;
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "Impossible de charger le fournisseur");
    }

    currentSupplier = data;

    fillForm(data);
    updateHeader();
    lockFormIfNeeded();
  } catch (err) {
    console.error("Erreur chargement fournisseur :", err);
    showFeedback(err.message || "Erreur chargement fournisseur", "error");
  }
}

async function saveSupplier() {
  if (!canEditSupplier()) {
    showFeedback("Vous n’avez pas le droit de modifier cette fiche.", "error");
    return;
  }

  const payload = collectPayload();

  if (!payload.name) {
    showFeedback("Le nom fournisseur est obligatoire.", "error");
    return;
  }

  try {
    const url = supplierId
      ? `${API_BASE_URL}/api/suppliers/${supplierId}`
      : `${API_BASE_URL}/api/suppliers`;

    const method = supplierId ? "PUT" : "POST";

    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (response.status === 401) {
      logoutAndRedirect();
      return;
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "Erreur enregistrement fournisseur");
    }

    currentSupplier = data;

    showFeedback("Fournisseur enregistré.");

    if (!supplierId && data.id) {
      window.location.href = `./supplier-detail.html?id=${encodeURIComponent(data.id)}`;
    } else {
      fillForm(data);
      updateHeader();
    }
  } catch (err) {
    console.error("Erreur sauvegarde fournisseur :", err);
    showFeedback(err.message || "Erreur enregistrement fournisseur", "error");
  }
}

async function changeSupplierStatus(status) {
  if (!supplierId || !canChangeStatus()) return;

  try {
    const response = await fetch(`${API_BASE_URL}/api/suppliers/${supplierId}/status`, {
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
      throw new Error(data.error || "Erreur changement statut fournisseur");
    }

    currentSupplier.status = data.status;
    setFieldValue("status", data.status);
    updateHeader();

    showFeedback("Statut fournisseur mis à jour.");
  } catch (err) {
    console.error("Erreur statut fournisseur :", err);
    showFeedback(err.message || "Erreur changement statut", "error");
  }
}

function bindEvents() {
  if (userNameEl) {
    userNameEl.textContent = sessionUser.email || "Utilisateur";
  }

  backListBtn?.addEventListener("click", () => {
    window.location.href = "./suppliers.html";
  });

  backHomeBtn?.addEventListener("click", () => {
    window.location.href = "./home.html";
  });

  logoutBtn?.addEventListener("click", logoutAndRedirect);

  saveSupplierBtn?.addEventListener("click", saveSupplier);

  statusSupplierBtn?.addEventListener("click", () => {
    const nextStatus = statusSupplierBtn.dataset.status || "inactive";
    changeSupplierStatus(nextStatus);
  });
}

bindEvents();
loadSupplier();