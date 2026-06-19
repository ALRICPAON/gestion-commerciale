const API_BASE_URL = window.APP_CONFIG?.API_BASE_URL || '';
const sessionUser = JSON.parse(localStorage.getItem("gc_user") || localStorage.getItem("grv2_user") || "null");
const authToken = localStorage.getItem("gc_token") || localStorage.getItem("grv2_token");
const activeDepartment = JSON.parse(
  localStorage.getItem("gc_active_department") || localStorage.getItem("grv2_active_department") || "null"
);

if (!sessionUser) {
  window.location.href = "./login.html";
}

const storeNameEl = document.getElementById("store-name");
const userNameEl = document.getElementById("user-name");
const usersBtn = document.getElementById("users-btn");
const usersCard = document.getElementById("users-card");
const settingsCard = document.getElementById("settings-card");
const logoutBtn = document.getElementById("logout-btn");
const departmentSelect = document.getElementById("topbar-department-select");
const currentDepartmentNameEl = document.getElementById("current-department-name");
const communicationButtons = document.querySelectorAll("[data-communication-open]");
const whatsappTestBtn = document.getElementById("whatsapp-test-btn");
const whatsappTestFeedback = document.getElementById("whatsapp-test-feedback");
const refreshHomeKpisBtn = document.getElementById("refresh-home-kpis-btn");
const homeKpiFeedback = document.getElementById("home-kpi-feedback");
const homeKpiEls = {
  todayRevenue: document.getElementById("home-kpi-today-revenue"),
  todayRevenueNote: document.getElementById("home-kpi-today-revenue-note"),
  todayMargin: document.getElementById("home-kpi-today-margin"),
  todayMarginNote: document.getElementById("home-kpi-today-margin-note"),
  todayRate: document.getElementById("home-kpi-today-rate"),
  todayRateNote: document.getElementById("home-kpi-today-rate-note"),
  yesterdayRevenue: document.getElementById("home-kpi-yesterday-revenue"),
  yesterdayRate: document.getElementById("home-kpi-yesterday-rate"),
};

const communicationLinks = {
  webmail: "https://mail.altamaree.fr",
  calendar: "https://mail.altamaree.fr",
  whatsapp: "https://web.whatsapp.com",
};

function getUserDepartments() {
  return Array.isArray(sessionUser.departments) ? sessionUser.departments : [];
}

function getSafeActiveDepartment() {
  const departments = getUserDepartments();

  if (activeDepartment && departments.some((dep) => dep.id === activeDepartment.id)) {
    return activeDepartment;
  }

  const defaultDepartment = departments.find((dep) => dep.is_default);
  return defaultDepartment || departments[0] || null;
}

function saveActiveDepartment(department) {
  if (department) {
    localStorage.setItem("gc_active_department", JSON.stringify(department));
    localStorage.setItem("grv2_active_department", JSON.stringify(department));
  }
}

function openUsers() {
  window.location.href = "./users.html";
}

function canManageSettings() {
  return ["admin", "responsable"].includes(sessionUser.role);
}

function renderTopbar() {
  if (storeNameEl) {
    storeNameEl.textContent = "Espace de gestion";
  }

  if (userNameEl) {
    userNameEl.textContent = sessionUser.email || "Utilisateur";
  }

  const canManageUsers = sessionUser.role === "admin";

  if (usersBtn) {
    usersBtn.style.display = canManageUsers ? "inline-block" : "none";
    if (canManageUsers) {
      usersBtn.addEventListener("click", openUsers);
    }
  }

  if (usersCard) {
    usersCard.style.display = canManageUsers ? "flex" : "none";
  }

  if (settingsCard) {
    settingsCard.style.display = canManageSettings() ? "flex" : "none";
  }
}

function renderDepartmentSelector() {
  if (!departmentSelect) return;

  const departments = getUserDepartments();
  const currentDepartment = getSafeActiveDepartment();

  departmentSelect.innerHTML = "";

  if (departments.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Aucun service";
    departmentSelect.appendChild(option);
    departmentSelect.disabled = true;

    if (currentDepartmentNameEl) {
      currentDepartmentNameEl.textContent = "Aucun service";
    }
    return;
  }

  departments.forEach((department) => {
    const option = document.createElement("option");
    option.value = department.id;
    option.textContent = `${department.name} (${department.code})`;
    departmentSelect.appendChild(option);
  });

  if (currentDepartment) {
    departmentSelect.value = currentDepartment.id;
    saveActiveDepartment(currentDepartment);

    if (currentDepartmentNameEl) {
      currentDepartmentNameEl.textContent = currentDepartment.name || "-";
    }
  }

  departmentSelect.disabled = departments.length === 1;

  departmentSelect.addEventListener("change", () => {
    const selectedDepartment = departments.find((dep) => dep.id === departmentSelect.value);
    if (!selectedDepartment) return;

    saveActiveDepartment(selectedDepartment);
    window.location.reload();
  });
}

function authHeaders() {
  return { Authorization: `Bearer ${authToken}` };
}

function money(value) {
  if (value === null || value === undefined) return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return number.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

function percent(value) {
  if (value === null || value === undefined) return "-";
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `${number.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

async function getDashboardKpis(query) {
  const response = await fetch(`${API_BASE_URL}/api/dashboard?${query}`, { headers: authHeaders() });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Erreur KPI Home");
  return data;
}

function renderKpiBlock(today = {}, yesterday = {}) {
  const todayKpis = today.kpis || {};
  const yesterdayKpis = yesterday.kpis || {};
  const todayRevenue = Number(todayKpis.ca_ht || 0);
  const noSaleToday = todayRevenue === 0;
  const todaySnapshotsMissing = today.snapshots?.available === false;
  const yesterdaySnapshotsMissing = yesterday.snapshots?.available === false;

  homeKpiEls.todayRevenue.textContent = money(todayKpis.ca_ht || 0);
  homeKpiEls.todayRevenueNote.textContent = noSaleToday ? "Aucune vente aujourd'hui" : "CA HT validé";
  homeKpiEls.todayMargin.textContent = money(todayKpis.gross_margin_ht);
  homeKpiEls.todayMarginNote.textContent = todaySnapshotsMissing ? "Capture stock requise" : "Marge brute";
  homeKpiEls.todayRate.textContent = percent(todayKpis.margin_rate);
  homeKpiEls.todayRateNote.textContent = todaySnapshotsMissing ? "Marge non calculable" : "Taux de marge";
  homeKpiEls.yesterdayRevenue.textContent = money(yesterdayKpis.ca_ht || 0);
  homeKpiEls.yesterdayRate.textContent = `Marge veille : ${percent(yesterdayKpis.margin_rate)}${yesterdaySnapshotsMissing ? " · capture requise" : ""}`;

  if (homeKpiFeedback) {
    homeKpiFeedback.textContent = "Données du jour et de la veille issues du tableau de bord.";
    homeKpiFeedback.className = "";
  }
}

async function loadHomeKpis() {
  if (!authToken || !homeKpiEls.todayRevenue) return;
  if (homeKpiFeedback) {
    homeKpiFeedback.textContent = "Chargement des KPI...";
    homeKpiFeedback.className = "";
  }

  const yesterday = isoDate(addDays(new Date(), -1));
  const yesterdayQuery = new URLSearchParams({ period: "custom", from: yesterday, to: yesterday }).toString();

  try {
    const [todayData, yesterdayData] = await Promise.all([
      getDashboardKpis("period=day"),
      getDashboardKpis(yesterdayQuery),
    ]);
    renderKpiBlock(todayData, yesterdayData);
  } catch (error) {
    if (homeKpiFeedback) {
      homeKpiFeedback.textContent = error.message || "KPI indisponibles";
      homeKpiFeedback.className = "home-kpi-error";
    }
  }
}

async function loadCommunicationSettings() {
  if (!authToken) return;

  try {
    const response = await fetch(`${API_BASE_URL}/api/communication/settings`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    if (!response.ok) return;
    const data = await response.json().catch(() => ({}));
    communicationLinks.webmail = data.webmail_url || communicationLinks.webmail;
    communicationLinks.calendar = data.calendar_url || communicationLinks.calendar;
  } catch (err) {
    console.warn("Paramètres communication indisponibles :", err.message);
  }
}

function setWhatsappFeedback(message, type = "") {
  if (!whatsappTestFeedback) return;
  whatsappTestFeedback.textContent = message;
  whatsappTestFeedback.className = `communication-feedback ${type}`.trim();
}

async function sendWhatsappTest() {
  if (!authToken) return;
  const to = window.prompt("Numéro WhatsApp de test (ex : +33612345678)");
  if (!to || !to.trim()) return;

  if (whatsappTestBtn) {
    whatsappTestBtn.disabled = true;
  }
  setWhatsappFeedback("Envoi du test WhatsApp...");

  try {
    const response = await fetch(`${API_BASE_URL}/api/communication/whatsapp/test`, {
      method: "POST",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to: to.trim() }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success !== true || !data.message_id) {
      throw new Error(data.error || "Erreur envoi WhatsApp");
    }
    setWhatsappFeedback(`Test WhatsApp envoyé avec succès (${data.message_id}).`, "success");
  } catch (error) {
    setWhatsappFeedback(error.message || "Erreur envoi WhatsApp", "error");
  } finally {
    if (whatsappTestBtn) {
      whatsappTestBtn.disabled = false;
    }
  }
}

function bindCommunicationActions() {
  communicationButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.communicationOpen;
      const url = communicationLinks[target];
      if (!url) return;
      window.open(url, "_blank", "noopener,noreferrer");
    });
  });

  if (whatsappTestBtn) {
    whatsappTestBtn.addEventListener("click", sendWhatsappTest);
  }
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", () => {
    localStorage.removeItem("grv2_token");
    localStorage.removeItem("grv2_user");
    localStorage.removeItem("grv2_active_department");
    localStorage.removeItem("gc_token");
    localStorage.removeItem("gc_user");
    localStorage.removeItem("gc_active_department");
    window.location.href = "./login.html";
  });
}

if (refreshHomeKpisBtn) {
  refreshHomeKpisBtn.addEventListener("click", loadHomeKpis);
}

renderTopbar();
renderDepartmentSelector();
bindCommunicationActions();
loadCommunicationSettings();
loadHomeKpis();
