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
const settingsCard = document.getElementById("settings-card");
const logoutBtn = document.getElementById("logout-btn");
const departmentSelect = document.getElementById("topbar-department-select");
const currentDepartmentNameEl = document.getElementById("current-department-name");
const communicationButtons = document.querySelectorAll("[data-communication-open]");

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

function bindCommunicationActions() {
  communicationButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.communicationOpen;
      const url = communicationLinks[target];
      if (!url) return;
      window.open(url, "_blank", "noopener,noreferrer");
    });
  });
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

renderTopbar();
renderDepartmentSelector();
bindCommunicationActions();
loadCommunicationSettings();
