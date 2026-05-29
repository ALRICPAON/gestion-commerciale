const sessionUser = JSON.parse(localStorage.getItem("gc_user") || localStorage.getItem("grv2_user") || "null");
const activeDepartment = JSON.parse(
  localStorage.getItem("gc_active_department") || localStorage.getItem("grv2_active_department") || "null"
);

if (!sessionUser) {
  window.location.href = "./login.html";
}

const storeNameEl = document.getElementById("store-name");
const userNameEl = document.getElementById("user-name");
const usersBtn = document.getElementById("users-btn");
const usersCardBtn = document.getElementById("users-card-btn");
const logoutBtn = document.getElementById("logout-btn");
const departmentSelect = document.getElementById("topbar-department-select");
const currentDepartmentNameEl = document.getElementById("current-department-name");

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

function renderTopbar() {
  if (storeNameEl) {
    storeNameEl.textContent = sessionUser.store_name || "Magasin";
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

  if (usersCardBtn) {
    usersCardBtn.disabled = !canManageUsers;
    usersCardBtn.textContent = canManageUsers ? "Ouvrir" : "Reserve admin";
    if (canManageUsers) {
      usersCardBtn.addEventListener("click", openUsers);
    }
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
