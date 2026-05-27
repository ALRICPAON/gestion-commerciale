const sessionUser = JSON.parse(localStorage.getItem("grv2_user") || "null");
const activeDepartment = JSON.parse(localStorage.getItem("grv2_active_department") || "null");

if (!sessionUser) {
  window.location.href = "./login.html";
}

const storeNameEl = document.getElementById("store-name");
const userNameEl = document.getElementById("user-name");
const usersBtn = document.getElementById("users-btn");
const logoutBtn = document.getElementById("logout-btn");
const departmentSelect = document.getElementById("topbar-department-select");
const currentDepartmentNameEl = document.getElementById("current-department-name");
const articlesBtn = document.getElementById('articles-btn');
const suppliersBtn = document.getElementById('suppliers-btn');
const afMapBtn = document.getElementById("afmap-btn");
const purchasesBtn = document.getElementById("purchases-btn");
const stockBtn = document.getElementById("stock-btn");
const salesBtn = document.getElementById("sales-btn");
const inventoryBtn = document.getElementById("inventory-btn");
const traceabilityBtn = document.getElementById("traceability-btn");
const transformationsBtn = document.getElementById("transformations-btn");
const recipesBtn = document.getElementById("recipes-btn");
const fabricationsBtn = document.getElementById("fabrications-btn");
const labelsBtn = document.getElementById("labels-btn");
const comptaBtn = document.getElementById("compta-btn");

const MODULE_PERMISSIONS = {
  vendeur: [
    "articles",
    "stock",
    "traceability",
    "transformations",
    "recipes",
    "fabrications",
    "labels"
  ],
  qualite: [
    "articles",
    "stock",
    "traceability",
    "transformations",
    "recipes",
    "fabrications",
    "labels",
    "purchases",
    "sales"
  ]
};


function getUserDepartments() {
  if (Array.isArray(sessionUser.departments)) {
    return sessionUser.departments;
  }

  return [];
}

function getSafeActiveDepartment() {
  const departments = getUserDepartments();

  if (activeDepartment && departments.some((dep) => dep.id === activeDepartment.id)) {
    return activeDepartment;
  }

  const defaultDepartment = departments.find((dep) => dep.is_default);
  if (defaultDepartment) {
    return defaultDepartment;
  }

  return departments.length > 0 ? departments[0] : null;
}

function saveActiveDepartment(department) {
  localStorage.setItem("grv2_active_department", JSON.stringify(department));
}

function renderTopbar() {
  if (storeNameEl) {
    storeNameEl.textContent = sessionUser.store_name || "Magasin";
  }

  if (userNameEl) {
    userNameEl.textContent = sessionUser.email || "Utilisateur";
  }

  if (usersBtn) {
    if (sessionUser.role === "admin") {
      usersBtn.style.display = "inline-block";
      usersBtn.addEventListener("click", () => {
        window.location.href = "./users.html";
      });
    } else {
      usersBtn.style.display = "none";
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
    option.textContent = "Aucun rayon";
    departmentSelect.appendChild(option);
    departmentSelect.disabled = true;

    if (currentDepartmentNameEl) {
      currentDepartmentNameEl.textContent = "Aucun rayon";
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
    applyDepartmentTheme(currentDepartment);

    if (currentDepartmentNameEl) {
      currentDepartmentNameEl.textContent = currentDepartment.name || "-";
    }
  }

  departmentSelect.disabled = departments.length === 1;

  departmentSelect.addEventListener("change", () => {
    const selectedId = departmentSelect.value;
    const selectedDepartment = departments.find((dep) => dep.id === selectedId);

    if (!selectedDepartment) return;

    saveActiveDepartment(selectedDepartment);
    applyDepartmentTheme(selectedDepartment);
    window.location.reload();
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", () => {
    localStorage.removeItem("grv2_token");
    localStorage.removeItem("grv2_user");
    localStorage.removeItem("grv2_active_department");
    window.location.href = "./login.html";
  });
}
if (articlesBtn) {
  articlesBtn.addEventListener('click', () => {
    window.location.href = './articles.html';
  });
}

if (suppliersBtn) {
  suppliersBtn.addEventListener('click', () => {
    window.location.href = './suppliers.html';
  });
}

if (afMapBtn) {
  afMapBtn.addEventListener("click", () => {
    window.location.href = "./af-map.html";
  });
}

if (purchasesBtn) {
  purchasesBtn.addEventListener("click", () => {
    window.location.href = "./purchases.html";
  });
}

if (salesBtn) {
  salesBtn.addEventListener("click", () => {
    window.location.href = "./sales.html";
  });
}

if (inventoryBtn) {
  inventoryBtn.addEventListener("click", () => {
    window.location.href = "./inventaire.html";
  });
}

if (traceabilityBtn) {
  traceabilityBtn.addEventListener("click", () => {
    window.location.href = "./traceability.html";
  });
}

if (transformationsBtn) {
  transformationsBtn.addEventListener("click", () => {
    window.location.href = "./transformations.html";
  });
}

if (recipesBtn) {
  recipesBtn.addEventListener("click", () => {
    window.location.href = "./recipes.html";
  });
}

if (fabricationsBtn) {
  fabricationsBtn.addEventListener("click", () => {
    window.location.href = "./fabrications.html";
  });
}

if (comptaBtn) {
  comptaBtn.addEventListener("click", () => {
    window.location.href = "./compta-home.html";
  });
}

if (labelsBtn) {
  labelsBtn.addEventListener("click", async () => {
    const token = localStorage.getItem("grv2_token");
    const activeDepartment = JSON.parse(
      localStorage.getItem("grv2_active_department") || "null"
    );

    if (!token || !activeDepartment?.id) {
      alert("Session ou rayon actif introuvable.");
      return;
    }

    try {
      labelsBtn.disabled = true;
      labelsBtn.textContent = "Export...";

      const response = await fetch(
        `${window.APP_CONFIG.API_BASE_URL}/api/labels/export-evolis?department_id=${activeDepartment.id}`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      if (!response.ok) {
        throw new Error("Erreur export étiquettes");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = "etiquettes_evolis.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();

      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
      alert("Erreur pendant l’export étiquettes.");
    } finally {
      labelsBtn.disabled = false;
      labelsBtn.textContent = "Exporter";
    }
  });
}


if (stockBtn) {
  stockBtn.addEventListener("click", () => {
    window.location.href = "./stock.html";
  });
}

function applyDepartmentTheme(department) {
  document.body.classList.remove(
    "theme-pois",
    "theme-bouch",
    "theme-fdl",
    "theme-boul",
    "theme-char",
    "theme-trait",
    "theme-from"
  );

  if (!department || !department.code) return;

  const code = department.code.toUpperCase();

  const map = {
    POIS: "theme-pois",
    BOUCH: "theme-bouch",
    FDL: "theme-fdl",
    BOUL: "theme-boul",
    CHAR: "theme-char",
    TRAIT: "theme-trait",
    FROM: "theme-from"
  };

  const themeClass = map[code];

  if (themeClass) {
    document.body.classList.add(themeClass);
  }
}

function applyModulePermissions() {
  const role = sessionUser?.role;

  if (role === "admin" || role === "responsable") {
    return;
  }

  const allowedModules = MODULE_PERMISSIONS[role] || [];

  document.querySelectorAll("[data-module]").forEach((card) => {
    const moduleName = card.dataset.module;

    if (!allowedModules.includes(moduleName)) {
      card.style.display = "none";
    }
  });
}

renderTopbar();
renderDepartmentSelector();
applyModulePermissions();
