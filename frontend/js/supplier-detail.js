const API_BASE_URL = window.APP_CONFIG.API_BASE_URL;

const sessionUser = JSON.parse(localStorage.getItem("gc_user") || localStorage.getItem("grv2_user") || "null");
const authToken = localStorage.getItem("gc_token") || localStorage.getItem("grv2_token");

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
const supplierForm = document.getElementById("supplier-form");

const saveSupplierBtn = document.getElementById("save-supplier-btn");
const statusSupplierBtn = document.getElementById("status-supplier-btn");
const contactsBody = document.getElementById("contacts-table-body");
const contactForm = document.getElementById("contact-form");
const saveContactBtn = document.getElementById("save-contact-btn");

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
let contacts = [];

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

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${authToken}` },
  });
  if (response.status === 401) {
    logoutAndRedirect();
    return null;
  }
  return response;
}

function renderContacts() {
  if (!contactsBody) return;
  contactsBody.innerHTML = contacts.length ? contacts.map((contact) => {
    const usage = [
      contact.is_primary ? "Principal" : null,
      contact.receives_purchase_orders ? "Bons de commande" : null,
      contact.receives_price_requests ? "Demandes tarif" : null,
      contact.receives_delivery_claims ? "Réclamations BL" : null,
      contact.receives_accounting_documents ? "Comptabilité" : null,
    ].filter(Boolean).join(", ") || "-";
    return `<tr><td>${escapeHtml(contact.contact_name)}</td><td>${escapeHtml(contact.role || "")}</td><td>${escapeHtml(contact.email || "")}</td><td>${escapeHtml(contact.phone || contact.mobile || "")}</td><td>${escapeHtml(usage)}</td><td>${escapeHtml(contact.status || "active")}</td><td><button type="button" class="btn btn-secondary btn-sm" data-contact-action="edit" data-contact-id="${escapeHtml(contact.id)}">Modifier</button> <button type="button" class="btn btn-secondary btn-sm" data-contact-action="delete" data-contact-id="${escapeHtml(contact.id)}">Désactiver</button></td></tr>`;
  }).join("") : '<tr><td colspan="7">Aucun contact.</td></tr>';
}

async function loadContacts() {
  if (!supplierId) {
    contacts = [];
    renderContacts();
    return;
  }
  const response = await apiFetch(`${API_BASE_URL}/api/suppliers/${supplierId}/contacts`);
  if (!response) return;
  const data = await response.json().catch(() => []);
  if (!response.ok) {
    showFeedback(data.error || "Impossible de charger les contacts fournisseur", "error");
    return;
  }
  contacts = Array.isArray(data) ? data : [];
  renderContacts();
}

function contactPayload() {
  return {
    contact_name: document.getElementById("contact-form-name")?.value.trim() || null,
    role: document.getElementById("contact-form-role")?.value.trim() || null,
    email: document.getElementById("contact-form-email")?.value.trim() || null,
    phone: document.getElementById("contact-form-phone")?.value.trim() || null,
    mobile: document.getElementById("contact-form-mobile")?.value.trim() || null,
    status: document.getElementById("contact-form-status")?.value || "active",
    is_primary: document.getElementById("contact-form-primary")?.checked || false,
    receives_purchase_orders: document.getElementById("contact-form-purchase-orders")?.checked || false,
    receives_price_requests: document.getElementById("contact-form-price-requests")?.checked || false,
    receives_delivery_claims: document.getElementById("contact-form-delivery-claims")?.checked || false,
    receives_accounting_documents: document.getElementById("contact-form-accounting")?.checked || false,
    notes: document.getElementById("contact-form-notes")?.value.trim() || null,
  };
}

function resetContactForm() {
  contactForm?.reset();
  setFieldValue("contact-form-id", "");
  setFieldValue("contact-form-status", "active");
  contactForm?.classList.add("hidden");
}

function fillContactForm(contact) {
  setFieldValue("contact-form-id", contact.id);
  setFieldValue("contact-form-name", contact.contact_name);
  setFieldValue("contact-form-role", contact.role);
  setFieldValue("contact-form-email", contact.email);
  setFieldValue("contact-form-phone", contact.phone);
  setFieldValue("contact-form-mobile", contact.mobile);
  setFieldValue("contact-form-status", contact.status || "active");
  document.getElementById("contact-form-primary").checked = Boolean(contact.is_primary);
  document.getElementById("contact-form-purchase-orders").checked = Boolean(contact.receives_purchase_orders);
  document.getElementById("contact-form-price-requests").checked = Boolean(contact.receives_price_requests);
  document.getElementById("contact-form-delivery-claims").checked = Boolean(contact.receives_delivery_claims);
  document.getElementById("contact-form-accounting").checked = Boolean(contact.receives_accounting_documents);
  setFieldValue("contact-form-notes", contact.notes);
  contactForm?.classList.remove("hidden");
}

async function saveContact(event) {
  event.preventDefault();
  if (!supplierId) return showFeedback("Enregistre le fournisseur avant d'ajouter un contact.", "error");
  const payload = contactPayload();
  if (!payload.contact_name) return showFeedback("Le nom du contact est obligatoire.", "error");
  const contactId = document.getElementById("contact-form-id")?.value || null;
  const url = contactId ? `${API_BASE_URL}/api/suppliers/${supplierId}/contacts/${contactId}` : `${API_BASE_URL}/api/suppliers/${supplierId}/contacts`;
  if (saveContactBtn) saveContactBtn.disabled = true;
  const response = await apiFetch(url, {
    method: contactId ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (saveContactBtn) saveContactBtn.disabled = false;
  if (!response) return;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return showFeedback(data.error || "Erreur enregistrement contact", "error");
  resetContactForm();
  await loadContacts();
  showFeedback(contactId ? "Contact mis à jour." : "Contact créé.");
}

async function deleteContact(contactId) {
  if (!contactId) return;
  const response = await apiFetch(`${API_BASE_URL}/api/suppliers/${supplierId}/contacts/${contactId}`, { method: "DELETE" });
  if (!response) return;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return showFeedback(data.error || "Erreur désactivation contact", "error");
  await loadContacts();
  showFeedback("Contact désactivé.");
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

  supplierForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveSupplier();
  });

  statusSupplierBtn?.addEventListener("click", () => {
    const nextStatus = statusSupplierBtn.dataset.status || "inactive";
    changeSupplierStatus(nextStatus);
  });

  document.getElementById("add-contact-btn")?.addEventListener("click", () => {
    resetContactForm();
    contactForm?.classList.remove("hidden");
  });
  document.getElementById("cancel-contact-btn")?.addEventListener("click", resetContactForm);
  contactForm?.addEventListener("submit", saveContact);
  contactsBody?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-contact-action]");
    if (!button) return;
    const contact = contacts.find((item) => item.id === button.dataset.contactId);
    if (button.dataset.contactAction === "edit" && contact) fillContactForm(contact);
    if (button.dataset.contactAction === "delete") deleteContact(button.dataset.contactId);
  });
}

bindEvents();
loadSupplier().then(loadContacts);
