const sessionUser = JSON.parse(localStorage.getItem("grv2_user") || "null");
const activeDepartment = JSON.parse(localStorage.getItem("grv2_active_department") || "null");
const token = localStorage.getItem("grv2_token");

const API_BASE_URL = window.APP_CONFIG.API_BASE_URL;
const FRONT_BASE_URL = window.APP_CONFIG.FRONT_BASE_URL || "https://scorpaseafood.fr";

if (!sessionUser || !token) {
  window.location.href = "./login.html";
}

if (sessionUser.role !== "admin") {
  alert("Accès interdit : cette page est réservée aux admins.");
  window.location.href = "./home.html";
}

const userForm = document.getElementById("user-form");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const roleSelect = document.getElementById("role");
const departmentsContainer = document.getElementById("departments-checkboxes");
const defaultDepartmentSelect = document.getElementById("default-department");
const usersList = document.getElementById("users-list");
const formMessage = document.getElementById("form-message");
const backHomeBtn = document.getElementById("back-home-btn");
const logoutBtn = document.getElementById("logout-btn");
const storeNameEl = document.getElementById("store-name");
const userNameEl = document.getElementById("user-name");
const departmentSelect = document.getElementById("topbar-department-select");
const submitUserBtn = document.getElementById("submit-user-btn");
const openLoginQrBtn = document.getElementById("open-login-qr-btn");
const loginQrModal = document.getElementById("login-qr-modal");
const closeLoginQrBtn = document.getElementById("close-login-qr-btn");
const loginQrCodeEl = document.getElementById("login-qr-code");
const loginQrUrlEl = document.getElementById("login-qr-url");
const printLoginQrBtn = document.getElementById("print-login-qr-btn");

let departmentsData = [];
let editingUserId = null;

function clearSessionAndRedirect() {
  localStorage.removeItem("grv2_token");
  localStorage.removeItem("grv2_user");
  localStorage.removeItem("grv2_active_department");
  window.location.href = "./login.html";
}

function getAuthHeaders(withJson = false) {
  const headers = {
    Authorization: `Bearer ${token}`
  };

  if (withJson) {
    headers["Content-Type"] = "application/json";
  }

  return headers;
}

async function fetchWithAuth(url, options = {}) {
  const finalOptions = {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...getAuthHeaders(options.withJson || false)
    }
  };

  delete finalOptions.withJson;

  const response = await fetch(url, finalOptions);

  if (response.status === 401) {
    alert("Session expirée ou invalide. Merci de vous reconnecter.");
    clearSessionAndRedirect();
    throw new Error("Session invalide");
  }

  return response;
}

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

  if (departments.length > 0) {
    return departments[0];
  }

  return null;
}

function saveActiveDepartment(department) {
  localStorage.setItem("grv2_active_department", JSON.stringify(department));
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

function getLoginQrUrl() {
  return `${FRONT_BASE_URL.replace(/\/+$/, "")}/login.html`;
}

function openLoginQrModal() {
  if (!loginQrModal || !loginQrCodeEl || !loginQrUrlEl) return;

  const targetUrl = getLoginQrUrl();

  loginQrUrlEl.textContent = targetUrl;
  loginQrCodeEl.innerHTML = "";

  if (typeof QRCode === "function") {
    new QRCode(loginQrCodeEl, {
      text: targetUrl,
      width: 280,
      height: 280,
    });
  } else {
    loginQrCodeEl.textContent = "QR code indisponible";
  }

  loginQrModal.classList.remove("hidden");
}

function closeLoginQrModal() {
  loginQrModal?.classList.add("hidden");
}

function renderTopbar() {
  if (storeNameEl) {
    storeNameEl.textContent = sessionUser.store_name || "Magasin";
  }

  if (userNameEl) {
    userNameEl.textContent = sessionUser.email || "Admin";
  }

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

async function loadDepartments() {
  try {
    const response = await fetchWithAuth(`${API_BASE_URL}/api/departments`);

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Impossible de charger les rayons");
    }

    if (!Array.isArray(data)) {
      throw new Error("Format invalide pour les rayons");
    }

    departmentsData = data;
    renderDepartments();
  } catch (error) {
    console.error("Erreur loadDepartments :", error);
    if (departmentsContainer) {
      departmentsContainer.innerHTML = `<p>${error.message}</p>`;
    }
  }
}

function renderDepartments() {
  if (!departmentsContainer || !defaultDepartmentSelect) return;

  departmentsContainer.innerHTML = "";
  defaultDepartmentSelect.innerHTML = `<option value="">Choisir un rayon</option>`;

  departmentsData.forEach((department) => {
    const row = document.createElement("div");
    row.className = "checkbox-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = "department_ids";
    checkbox.value = department.id;
    checkbox.id = `dep-${department.id}`;
    checkbox.addEventListener("change", updateDefaultDepartmentOptions);

    const label = document.createElement("label");
    label.htmlFor = checkbox.id;
    label.textContent = `${department.name} (${department.code})`;

    row.appendChild(checkbox);
    row.appendChild(label);
    departmentsContainer.appendChild(row);
  });
}

function updateDefaultDepartmentOptions() {
  if (!defaultDepartmentSelect) return;

  const previousValue = defaultDepartmentSelect.value;

  const checkedIds = Array.from(
    document.querySelectorAll('input[name="department_ids"]:checked')
  ).map((checkbox) => checkbox.value);

  defaultDepartmentSelect.innerHTML = `<option value="">Choisir un rayon</option>`;

  departmentsData
    .filter((department) => checkedIds.includes(department.id))
    .forEach((department) => {
      const option = document.createElement("option");
      option.value = department.id;
      option.textContent = `${department.name} (${department.code})`;
      defaultDepartmentSelect.appendChild(option);
    });

  if (checkedIds.includes(previousValue)) {
    defaultDepartmentSelect.value = previousValue;
  }
}

function resetFormMode() {
  editingUserId = null;
  userForm.reset();
  updateDefaultDepartmentOptions();

  if (submitUserBtn) {
    submitUserBtn.textContent = "Créer l'utilisateur";
  }

  if (formMessage) {
    formMessage.textContent = "";
  }
}

function startEditUser(user) {
  editingUserId = user.id;

  emailInput.value = user.email || "";
  passwordInput.value = "";
  roleSelect.value = user.role || "";

  const allowedDepartmentIds = Array.isArray(user.departments)
    ? user.departments.map((dep) => dep.department_id)
    : [];

  document.querySelectorAll('input[name="department_ids"]').forEach((checkbox) => {
    checkbox.checked = allowedDepartmentIds.includes(checkbox.value);
  });

  updateDefaultDepartmentOptions();

  const defaultDepartment = Array.isArray(user.departments)
    ? user.departments.find((dep) => dep.is_default)
    : null;

  if (defaultDepartment) {
    defaultDepartmentSelect.value = defaultDepartment.department_id;
  }

  if (submitUserBtn) {
    submitUserBtn.textContent = "Enregistrer les modifications";
  }

  if (formMessage) {
    formMessage.textContent = `Modification de ${user.email}`;
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function loadUsers() {
  try {
    const response = await fetchWithAuth(`${API_BASE_URL}/api/users`);

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Impossible de charger les utilisateurs");
    }

    if (!Array.isArray(data)) {
      throw new Error("Format invalide pour les utilisateurs");
    }

    renderUsers(data);
  } catch (error) {
    console.error("Erreur loadUsers :", error);
    if (usersList) {
      usersList.innerHTML = `<p>${error.message}</p>`;
    }
  }
}

function renderUsers(users) {
  if (!usersList) return;

  usersList.innerHTML = "";

  if (users.length === 0) {
    usersList.innerHTML = "<p>Aucun utilisateur trouvé.</p>";
    return;
  }

  users.forEach((user) => {
    const card = document.createElement("div");
    card.className = "user-card";

    const departmentsHtml = Array.isArray(user.departments) && user.departments.length > 0
      ? user.departments
          .map((dep) => {
            const defaultText = dep.is_default ? " (par défaut)" : "";
            return `<li>${dep.department_name} - ${dep.department_code}${defaultText}</li>`;
          })
          .join("")
      : "<li>Aucun rayon</li>";

    const statusButton = user.is_active
      ? `<button class="btn btn-danger deactivate-btn" data-id="${user.id}">Désactiver</button>`
      : `<button class="btn btn-secondary reactivate-btn" data-id="${user.id}">Réactiver</button>`;

    card.innerHTML = `
      <h3>${user.email}</h3>
      <p><strong>Rôle :</strong> ${user.role || "-"}</p>
      <p><strong>Actif :</strong> ${user.is_active ? "Oui" : "Non"}</p>
      <p><strong>Magasin :</strong> ${user.store_name || "-"}</p>
      <div>
        <strong>Rayons :</strong>
        <ul>${departmentsHtml}</ul>
      </div>
      <div class="user-card-actions">
        <button class="btn btn-primary edit-btn" data-id="${user.id}">Modifier</button>
        ${statusButton}
        <button class="btn btn-danger delete-btn" data-id="${user.id}">Supprimer</button>
      </div>
    `;

    usersList.appendChild(card);

    card.querySelector(".edit-btn")?.addEventListener("click", () => startEditUser(user));

    card.querySelector(".deactivate-btn")?.addEventListener("click", async () => {
      if (!confirm("Désactiver cet utilisateur ?")) return;
      try {
        const res = await fetchWithAuth(`${API_BASE_URL}/api/users/${user.id}/deactivate`, {
          method: "PATCH"
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Erreur désactivation");
        await loadUsers();
      } catch (err) {
        alert(err.message);
      }
    });

    card.querySelector(".reactivate-btn")?.addEventListener("click", async () => {
      if (!confirm("Réactiver cet utilisateur ?")) return;
      try {
        const res = await fetchWithAuth(`${API_BASE_URL}/api/users/${user.id}/reactivate`, {
          method: "PATCH"
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Erreur réactivation");
        await loadUsers();
      } catch (err) {
        alert(err.message);
      }
    });

    card.querySelector(".delete-btn")?.addEventListener("click", async () => {
      if (!confirm("Supprimer définitivement cet utilisateur ?")) return;
      try {
        const res = await fetchWithAuth(`${API_BASE_URL}/api/users/${user.id}`, {
          method: "DELETE"
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Erreur suppression");
        await loadUsers();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

userForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (formMessage) {
    formMessage.textContent = "";
  }

  const departmentIds = Array.from(
    document.querySelectorAll('input[name="department_ids"]:checked')
  ).map((checkbox) => checkbox.value);

  const payload = {
    email: emailInput.value.trim(),
    role: roleSelect.value,
    store_id: sessionUser.store_id,
    department_ids: departmentIds,
    default_department_id: defaultDepartmentSelect.value
  };

  if (passwordInput.value.trim() !== "") {
    payload.password = passwordInput.value.trim();
  }

  try {
    const isEditMode = !!editingUserId;
    const url = isEditMode
      ? `${API_BASE_URL}/api/users/${editingUserId}`
      : `${API_BASE_URL}/api/users`;

    const method = isEditMode ? "PATCH" : "POST";

    const response = await fetchWithAuth(url, {
      method,
      withJson: true,
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Erreur lors de l'enregistrement");
    }

    if (formMessage) {
      formMessage.textContent = isEditMode
        ? "Utilisateur modifié avec succès."
        : "Utilisateur créé avec succès.";
    }

    resetFormMode();
    await loadUsers();
  } catch (error) {
    console.error("Erreur enregistrement utilisateur :", error);
    if (formMessage) {
      formMessage.textContent = error.message;
    }
  }
});

backHomeBtn?.addEventListener("click", () => {
  window.location.href = "./home.html";
});

logoutBtn?.addEventListener("click", clearSessionAndRedirect);

openLoginQrBtn?.addEventListener("click", () => {
  alert("clic QR OK");
  openLoginQrModal();
});
closeLoginQrBtn?.addEventListener("click", closeLoginQrModal);
loginQrModal?.addEventListener("click", (event) => {
  if (event.target === loginQrModal) {
    closeLoginQrModal();
  }
});
printLoginQrBtn?.addEventListener("click", () => {
  window.print();
});

console.log("QR BTN =", openLoginQrBtn);
console.log("QR MODAL =", loginQrModal);
console.log("QRCode =", typeof QRCode);

renderTopbar();
loadDepartments();
loadUsers();
