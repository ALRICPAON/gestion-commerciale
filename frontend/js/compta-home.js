const sessionUser = JSON.parse(localStorage.getItem("grv2_user") || "null");

if (!sessionUser) {
  window.location.href = "./login.html";
}

const storeNameEl = document.getElementById("store-name");
const userNameEl = document.getElementById("user-name");

const backHomeBtn = document.getElementById("back-home-btn");
const logoutBtn = document.getElementById("logout-btn");

const comptaDailyBtn = document.getElementById("compta-daily-btn");
const comptaDashboardBtn = document.getElementById("compta-dashboard-btn");
const supplierMatchingBtn = document.getElementById("supplier-matching-btn");
const matchedInvoicesBtn = document.getElementById("matched-invoices-btn");
const comptaStatsBtn = document.getElementById("compta-stats-btn");
const comptaSuppliersBtn = document.getElementById("compta-suppliers-btn");
const comptaArticlesBtn = document.getElementById("compta-articles-btn");
const comptaInventoryAnomaliesBtn = document.getElementById("compta-inventory-anomalies-btn");

if (!["admin", "responsable"].includes(sessionUser.role)) {
  alert("Accès réservé aux responsables et administrateurs.");
  window.location.href = "./home.html";
}

if (storeNameEl) {
  storeNameEl.textContent = sessionUser.store_name || "Magasin";
}

if (userNameEl) {
  userNameEl.textContent = sessionUser.email || "Utilisateur";
}

if (backHomeBtn) {
  backHomeBtn.addEventListener("click", () => {
    window.location.href = "./home.html";
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

if (comptaDailyBtn) {
  comptaDailyBtn.addEventListener("click", () => {
    window.location.href = "./compta-daily.html";
  });
}

if (comptaDashboardBtn) {
  comptaDashboardBtn.addEventListener("click", () => {
    window.location.href = "./compta-dashboard.html";
  });
}

if (supplierMatchingBtn) {
  supplierMatchingBtn.addEventListener("click", () => {
    window.location.href = "./compta-lettrage.html";
  });
}

if (matchedInvoicesBtn) {
  matchedInvoicesBtn.addEventListener("click", () => {
    window.location.href = "./compta-factures.html";
  });
}

if (comptaStatsBtn) {
  comptaStatsBtn.addEventListener("click", () => {
    window.location.href = "./compta-analysis.html";
  });
}

if (comptaSuppliersBtn) {
  comptaSuppliersBtn.addEventListener("click", () => {
    window.location.href = "./compta-suppliers.html";
  });
}

if (comptaArticlesBtn) {
  comptaArticlesBtn.addEventListener("click", () => {
    window.location.href = "./compta-articles.html";
  });
}

if (comptaInventoryAnomaliesBtn) {
  comptaInventoryAnomaliesBtn.addEventListener("click", () => {
    window.location.href = "./compta-inventory-anomalies.html";
  });
}
