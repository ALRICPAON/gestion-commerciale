const API_BASE_URL = window.APP_CONFIG.API_BASE_URL;

const sessionUser = JSON.parse(localStorage.getItem("gc_user") || localStorage.getItem("grv2_user") || "null");
const authToken = localStorage.getItem("gc_token") || localStorage.getItem("grv2_token");

if (!sessionUser || !authToken) {
  window.location.href = "./login.html";
}

const params = new URLSearchParams(window.location.search);
const clientId = params.get("id");

const userNameEl = document.getElementById("user-name");
const backListBtn = document.getElementById("back-list-btn");
const backHomeBtn = document.getElementById("back-home-btn");
const logoutBtn = document.getElementById("logout-btn");

const formTitle = document.getElementById("form-title");
const formDescription = document.getElementById("form-description");
const pageSubtitle = document.getElementById("page-subtitle");
const pageFeedback = document.getElementById("page-feedback");
const clientForm = document.getElementById("client-form");

const saveClientBtn = document.getElementById("save-client-btn");
const statusClientBtn = document.getElementById("status-client-btn");

const fields = [
  "code",
  "name",
  "legal_name",
  "client_type",
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

let currentClient = null;

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
  pageFeedback.className = `page-feedback ${type}`;

  window.setTimeout(() => {
    pageFeedback.className = "page-feedback hidden";
    pageFeedback.textContent = "";
  }, 3500);
}

function canEditClient() {
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

function fillForm(client) {
  fields.forEach((field) => {
    setFieldValue(field, client[field]);
  });

  if (!client.country) {
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

  if (!payload.client_type) {
    payload.client_type = "standard";
  }

  if (!payload.status) {
    payload.status = "active";
  }

  return payload;
}

function updateHeader() {
  if (!clientId) {
    formTitle.textContent = "Nouveau client";
    formDescription.textContent = "Crée une nouvelle fiche client.";
    pageSubtitle.textContent = "Nouveau client";
    statusClientBtn?.classList.add("hidden");
    return;
  }

  const name = currentClient?.name || "Client";

  formTitle.textContent = name;
  formDescription.textContent = "Consulte et modifie la fiche client.";
  pageSubtitle.textContent = name;

  if (canChangeStatus() && currentClient) {
    statusClientBtn?.classList.remove("hidden");

    if (currentClient.status === "active") {
      statusClientBtn.textContent = "Désactiver";
      statusClientBtn.dataset.status = "inactive";
    } else {
      statusClientBtn.textContent = "Réactiver";
      statusClientBtn.dataset.status = "active";
    }
  }
}

function lockFormIfNeeded() {
  if (canEditClient()) return;

  fields.forEach((field) => {
    const el = document.getElementById(field);
    if (el) el.disabled = true;
  });

  saveClientBtn.disabled = true;
}

async function loadClient() {
  if (!clientId) {
    updateHeader();
    lockFormIfNeeded();
    return;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/clients/${clientId}`, {
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
      throw new Error(data.error || "Impossible de charger le client");
    }

    currentClient = data;

    fillForm(data);
    updateHeader();
    lockFormIfNeeded();
  } catch (err) {
    console.error("Erreur chargement client :", err);
    showFeedback(err.message || "Erreur chargement client", "error");
  }
}

async function saveClient() {
  if (!canEditClient()) {
    showFeedback("Vous n'avez pas le droit de modifier cette fiche.", "error");
    return;
  }

  const payload = collectPayload();

  if (!payload.name) {
    showFeedback("Le nom client est obligatoire.", "error");
    return;
  }

  try {
    const url = clientId
      ? `${API_BASE_URL}/api/clients/${clientId}`
      : `${API_BASE_URL}/api/clients`;

    const method = clientId ? "PUT" : "POST";

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
      throw new Error(data.error || "Erreur enregistrement client");
    }

    currentClient = data;

    showFeedback("Client enregistré.");

    if (!clientId && data.id) {
      window.location.href = `./client-detail.html?id=${encodeURIComponent(data.id)}`;
    } else {
      fillForm(data);
      updateHeader();
    }
  } catch (err) {
    console.error("Erreur sauvegarde client :", err);
    showFeedback(err.message || "Erreur enregistrement client", "error");
  }
}

async function changeClientStatus(status) {
  if (!clientId || !canChangeStatus()) return;

  try {
    const response = await fetch(`${API_BASE_URL}/api/clients/${clientId}/status`, {
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
      throw new Error(data.error || "Erreur changement statut client");
    }

    currentClient.status = data.status;
    setFieldValue("status", data.status);
    updateHeader();

    showFeedback("Statut client mis à jour.");
  } catch (err) {
    console.error("Erreur statut client :", err);
    showFeedback(err.message || "Erreur changement statut", "error");
  }
}

function bindEvents() {
  if (userNameEl) {
    userNameEl.textContent = sessionUser.email || "Utilisateur";
  }

  backListBtn?.addEventListener("click", () => {
    window.location.href = "./clients.html";
  });

  backHomeBtn?.addEventListener("click", () => {
    window.location.href = "./home.html";
  });

  logoutBtn?.addEventListener("click", logoutAndRedirect);

  saveClientBtn?.addEventListener("click", saveClient);

  clientForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveClient();
  });

  statusClientBtn?.addEventListener("click", () => {
    const nextStatus = statusClientBtn.dataset.status || "inactive";
    changeClientStatus(nextStatus);
  });
}

bindEvents();
loadClient();