const token = localStorage.getItem("grv2_token");
const sessionUser = JSON.parse(localStorage.getItem("grv2_user") || "null");
const activeDepartment = JSON.parse(localStorage.getItem("grv2_active_department") || "null");

if (!token || !sessionUser) {
  window.location.href = "./login.html";
}

const API_BASE = window.APP_CONFIG.API_BASE_URL;

const userNameEl = document.getElementById("user-name");
const logoutBtn = document.getElementById("logout-btn");
const backHomeBtn = document.getElementById("back-home-btn");
const departmentSelect = document.getElementById("topbar-department-select");
const currentDepartmentNameEl = document.getElementById("current-department-name");

const refreshStockBtn = document.getElementById("refresh-stock-btn");
const saveMargesBtn = document.getElementById("save-marges-btn");
const stockFeedback = document.getElementById("stock-feedback");
const stockSearchInput = document.getElementById("stock-search-input");

const margeTradInput = document.getElementById("marge-trad");
const margeFeInput = document.getElementById("marge-fe");
const margeLsInput = document.getElementById("marge-ls");
const margeSceInput = document.getElementById("marge-sce");
const margeEmbInput = document.getElementById("marge-emb");
const pmaMajorationInput = document.getElementById("pma-majoration");

let stockItems = [];
let filteredStockItems = [];
let suppressPvChange = false;

function getUserDepartments() {
  return Array.isArray(sessionUser.departments) ? sessionUser.departments : [];
}

function getSafeActiveDepartment() {
  const departments = getUserDepartments();
  if (activeDepartment && departments.some((dep) => dep.id === activeDepartment.id)) {
    return activeDepartment;
  }
  return departments.length > 0 ? departments[0] : null;
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

  const map = {
    POIS: "theme-pois",
    BOUCH: "theme-bouch",
    FDL: "theme-fdl",
    BOUL: "theme-boul",
    CHAR: "theme-char",
    TRAIT: "theme-trait",
    FROM: "theme-from",
  };

  const themeClass = map[String(department.code).toUpperCase()];
  if (themeClass) document.body.classList.add(themeClass);
}

function showFeedback(el, message, isError = false) {
  el.textContent = message;
  el.classList.remove("hidden");
  el.classList.toggle("error", isError);
  el.classList.toggle("success", !isError);
}

function clearFeedback(el) {
  el.textContent = "";
  el.classList.add("hidden");
  el.classList.remove("error", "success");
}

async function apiFetch(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Erreur API");
  }

  return data;
}

function renderTopbar() {
  if (userNameEl) userNameEl.textContent = sessionUser.email || "Utilisateur";
}

function renderDepartmentSelector() {
  const departments = getUserDepartments();
  const currentDepartment = getSafeActiveDepartment();

  departmentSelect.innerHTML = "";

  if (departments.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Aucun rayon";
    departmentSelect.appendChild(option);
    departmentSelect.disabled = true;
    currentDepartmentNameEl.textContent = "Aucun rayon";
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
    currentDepartmentNameEl.textContent = currentDepartment.name || "-";
    saveActiveDepartment(currentDepartment);
    applyDepartmentTheme(currentDepartment);
  }

  departmentSelect.disabled = departments.length === 1;

  departmentSelect.addEventListener("change", () => {
    const selectedDepartment = departments.find((dep) => dep.id === departmentSelect.value);
    if (!selectedDepartment) return;
    saveActiveDepartment(selectedDepartment);
    applyDepartmentTheme(selectedDepartment);
    window.location.reload();
  });
}

function formatNumber(value, digits = 3) {
  const n = Number(value || 0);
  return n.toLocaleString("fr-FR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatCurrency(value, digits = 2) {
  const n = Number(value || 0);
  return n.toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatDate(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleDateString("fr-FR");
  } catch {
    return "";
  }
}

function getMarginRate(sectorCode) {
  const key = `marge-${String(sectorCode || "").toLowerCase()}`;
  const raw = localStorage.getItem(key);

  if (raw !== null && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) return n / 100;
  }

  const defaults = {
    trad: 35,
    fe: 40,
    ls: 30,
    sce: 30,
    emb: 30,
  };

  return (defaults[String(sectorCode || "").toLowerCase()] || 30) / 100;
}

function getPmaMajorationRate() {
  const raw = localStorage.getItem("pma-majoration-pct");
  if (raw === null || raw === "") return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n / 100 : 0;
}

function initMarginsUI() {
  margeTradInput.value = localStorage.getItem("marge-trad") || "35";
  margeFeInput.value = localStorage.getItem("marge-fe") || "40";
  margeLsInput.value = localStorage.getItem("marge-ls") || "30";
  margeSceInput.value = localStorage.getItem("marge-sce") || "30";
  margeEmbInput.value = localStorage.getItem("marge-emb") || "30";
  pmaMajorationInput.value = localStorage.getItem("pma-majoration-pct") || "0";
}

function saveMarginsUI() {
  localStorage.setItem("marge-trad", margeTradInput.value || "35");
  localStorage.setItem("marge-fe", margeFeInput.value || "40");
  localStorage.setItem("marge-ls", margeLsInput.value || "30");
  localStorage.setItem("marge-sce", margeSceInput.value || "30");
  localStorage.setItem("marge-emb", margeEmbInput.value || "30");
  localStorage.setItem("pma-majoration-pct", pmaMajorationInput.value || "0");
}

function computeRowPricing(item) {
  const sector = String(item.sector_code || "TRAD").toLowerCase();
  const margeRate = getMarginRate(sector);
  const pmaMajorationRate = getPmaMajorationRate();

  const stockQty = Number(item.stock_quantity || 0);
  const pma = Number(item.pma || 0);
  const stockValue = Number(item.stock_value_ex_vat || 0);
  const pvTtcReal = item.pv_ttc_real !== null && item.pv_ttc_real !== undefined
    ? Number(item.pv_ttc_real)
    : null;

  const pmaForPrice = pma * (1 + pmaMajorationRate);
  const pvHtSuggested = pmaForPrice > 0 && margeRate < 1 ? pmaForPrice / (1 - margeRate) : 0;
  const pvTtcSuggested = pvHtSuggested * 1.055;

  const margeTheo = pvHtSuggested > 0 ? (pvHtSuggested - pma) / pvHtSuggested : 0;

  let margeReelle = null;
  if (pvTtcReal && pvTtcReal > 0) {
    const pvHtReal = pvTtcReal / 1.055;
    margeReelle = pvHtReal > 0 ? (pvHtReal - pma) / pvHtReal : null;
  }

  return {
    ...item,
    stockQty,
    pma,
    stockValue,
    pvTtcReal,
    pvTtcSuggested,
    margeTheo,
    margeReelle,
  };
}

function fillSectorTable(tbodyId, items) {
  const tbody = document.getElementById(tbodyId);

  if (!tbody) return;

  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="10">Aucune ligne</td></tr>`;
    return;
  }

  tbody.innerHTML = items.map((item) => {
    const dlc = formatDate(item.next_dlc);
    const dlcStyle = getDlcRowStyle(item.next_dlc);

    return `
      <tr data-article-id="${item.article_id}" style="${dlcStyle}">
        <td>${item.plu || "-"}</td>
        <td>${item.display_name || item.designation || "-"}</td>
        <td>${formatNumber(item.stockQty, 3)}</td>
        <td>${formatCurrency(item.pma, 4)}</td>
        <td>${(item.margeTheo * 100).toFixed(1)} %</td>
        <td>${formatCurrency(item.pvTtcSuggested, 2)}</td>
        <td>
          <input
            type="number"
            step="0.01"
            class="stock-pv-input"
            data-article-id="${item.article_id}"
            value="${item.pvTtcReal ?? ""}"
            style="width:90px"
          />
        </td>
        <td>${item.margeReelle !== null ? `${(item.margeReelle * 100).toFixed(1)} %` : ""}</td>
        <td>${dlc || ""}</td>
        <td>${formatCurrency(item.stockValue, 2)}</td>
      </tr>
    `;
  }).join("");
}

function getDlcRowStyle(nextDlc) {
  if (!nextDlc) return "";

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const dlcDate = new Date(nextDlc);
  if (Number.isNaN(dlcDate.getTime())) return "";

  dlcDate.setHours(0, 0, 0, 0);

  const diffDays = (dlcDate - today) / 86400000;

  if (diffDays <= 0) return "background-color:#ffcccc;";
  if (diffDays <= 2) return "background-color:#ffe7b3;";
  return "";
}

function updateSectorTotals(items, targetId) {
  const target = document.getElementById(targetId);
  if (!target) return;

  let achatHT = 0;
  let venteTTC = 0;

  items.forEach((item) => {
    achatHT += Number(item.stockValue || 0);
    const pv = item.pvTtcReal || item.pvTtcSuggested || 0;
    venteTTC += Number(pv || 0) * Number(item.stockQty || 0);
  });

  const venteHT = venteTTC / 1.055;
  const marge = venteHT > 0 ? ((venteHT - achatHT) / venteHT) * 100 : 0;

  const ahtEl = target.querySelector(".aht");
  const vtcEl = target.querySelector(".vtc");
  const margeEl = target.querySelector(".marge");

  if (ahtEl) ahtEl.textContent = formatCurrency(achatHT, 2);
  if (vtcEl) vtcEl.textContent = formatCurrency(venteTTC, 2);
  if (margeEl) margeEl.textContent = `${marge.toFixed(1)} %`;
}

function renderStockTables(items) {
  const prepared = items.map(computeRowPricing);

  const trad = prepared.filter((i) => (i.sector_code || "").toUpperCase() === "TRAD");
  const fe = prepared.filter((i) => (i.sector_code || "").toUpperCase() === "FE");
  const ls = prepared.filter((i) => (i.sector_code || "").toUpperCase() === "LS");
  const sce = prepared.filter((i) => (i.sector_code || "").toUpperCase() === "SCE");
  const emb = prepared.filter((i) => (i.sector_code || "").toUpperCase() === "EMB");

  fillSectorTable("tbody-trad", trad);
  fillSectorTable("tbody-fe", fe);
  fillSectorTable("tbody-ls", ls);
  fillSectorTable("tbody-sce", sce);
  fillSectorTable("tbody-emb", emb);

  updateSectorTotals(trad, "totaux-trad");
  updateSectorTotals(fe, "totaux-fe");
  updateSectorTotals(ls, "totaux-ls");
  updateSectorTotals(sce, "totaux-sce");
  updateSectorTotals(emb, "totaux-emb");
  updateSectorTotals(prepared, "totaux-all");
}

function applySearchFilter() {
  const term = (stockSearchInput.value || "").trim().toLowerCase();

  if (!term) {
    filteredStockItems = [...stockItems];
    renderStockTables(filteredStockItems);
    return;
  }

  filteredStockItems = stockItems.filter((item) => {
    const haystack = [
      item.plu,
      item.designation,
      item.display_name,
      item.sector_code,
      item.sector_name,
      item.category,
      item.latin_name,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(term);
  });

  renderStockTables(filteredStockItems);
}

async function loadStock() {
  clearFeedback(stockFeedback);

  const currentDepartment = getSafeActiveDepartment();
  const params = new URLSearchParams();

  if (currentDepartment?.id) {
    params.set("department_id", currentDepartment.id);
  }

  const data = await apiFetch(`/api/stock?${params.toString()}`);
  stockItems = Array.isArray(data) ? data : [];
  filteredStockItems = [...stockItems];

  renderStockTables(filteredStockItems);

  if (currentDepartment?.name) {
    showFeedback(stockFeedback, `Stock chargé pour le rayon ${currentDepartment.name}`);
  }
}

async function savePvTtcReal(articleId, value) {
  const currentDepartment = getSafeActiveDepartment();

  if (!currentDepartment?.id) {
    throw new Error("Aucun rayon actif");
  }

  await apiFetch(`/api/stock/${articleId}/pricing`, {
    method: "PATCH",
    body: JSON.stringify({
      department_id: currentDepartment.id,
      pv_ttc_real: value === "" ? null : Number(value),
    }),
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

if (backHomeBtn) {
  backHomeBtn.addEventListener("click", () => {
    window.location.href = "./home.html";
  });
}

if (refreshStockBtn) {
  refreshStockBtn.addEventListener("click", loadStock);
}

if (saveMargesBtn) {
  saveMargesBtn.addEventListener("click", () => {
    saveMarginsUI();
    renderStockTables(filteredStockItems);
    showFeedback(stockFeedback, "Marges enregistrées");
  });
}

if (stockSearchInput) {
  stockSearchInput.addEventListener("input", applySearchFilter);
}

function getVisiblePvInputs() {
  return Array.from(document.querySelectorAll(".stock-pv-input"))
    .filter((input) => {
      const row = input.closest("tr");
      return row && row.offsetParent !== null;
    });
}

function getNextPvArticleId(currentInput) {
  const inputs = getVisiblePvInputs();
  const currentIndex = inputs.indexOf(currentInput);

  if (currentIndex === -1) return null;

  const nextInput = inputs[currentIndex + 1];
  return nextInput ? nextInput.dataset.articleId : null;
}

function focusNextPvInput(currentInput) {
  const inputs = getVisiblePvInputs();
  const currentIndex = inputs.indexOf(currentInput);

  if (currentIndex === -1) return;

  const nextInput = inputs[currentIndex + 1];
  if (nextInput) {
    nextInput.focus();
    nextInput.select();
  }
}

function updateLocalPv(articleId, value) {
  const val = value === "" ? null : Number(value);

  const item = stockItems.find(i => String(i.article_id) === String(articleId));
  if (item) {
    item.pv_ttc_real = val;
  }
}

document.addEventListener("change", async (event) => {
  const input = event.target;
  if (!input.classList.contains("stock-pv-input")) return;
  if (suppressPvChange) return;

  const articleId = input.dataset.articleId;
  const value = input.value;

  try {
    await savePvTtcReal(articleId, value);
    updateLocalPv(articleId, value);
    applySearchFilter();
    showFeedback(stockFeedback, "PV enregistré");
  } catch (error) {
    console.error("Erreur save PV stock :", error);
    showFeedback(stockFeedback, error.message || "Erreur enregistrement PV", true);
  }
});

document.addEventListener("keydown", async (event) => {
  const input = event.target;
  if (!input.classList.contains("stock-pv-input")) return;
  if (event.key !== "Tab" || event.shiftKey) return;

  event.preventDefault();

  const articleId = input.dataset.articleId;
  const value = input.value;

  // 🔥 on mémorise la vraie case suivante AVANT rerender
  const nextArticleId = getNextPvArticleId(input);

  try {
    suppressPvChange = true;

    await savePvTtcReal(articleId, value);
    updateLocalPv(articleId, value);
    applySearchFilter();

    showFeedback(stockFeedback, "PV enregistré");

    setTimeout(() => {
      if (nextArticleId) {
        const nextInput = document.querySelector(
          `.stock-pv-input[data-article-id="${nextArticleId}"]`
        );
        if (nextInput) {
          nextInput.focus();
          nextInput.select();
        }
      }
      suppressPvChange = false;
    }, 0);
  } catch (error) {
    suppressPvChange = false;
    console.error("Erreur save PV stock :", error);
    showFeedback(stockFeedback, error.message || "Erreur enregistrement PV", true);
  }
});

async function init() {
  try {
    renderTopbar();
    renderDepartmentSelector();
    initMarginsUI();
    await loadStock();
  } catch (error) {
    console.error("Erreur init stock :", error);
    showFeedback(stockFeedback, error.message || "Erreur chargement stock", true);
  }
}

init();