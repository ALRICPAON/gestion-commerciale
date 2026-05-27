const API_URL = `${window.APP_CONFIG.API_BASE_URL}/api`;

const token = localStorage.getItem("grv2_token");
const sessionUser = JSON.parse(localStorage.getItem("grv2_user") || "null");
const activeDepartment = JSON.parse(localStorage.getItem("grv2_active_department") || "null");

if (!token || !sessionUser) {
  window.location.href = "./login.html";
}

if (!["admin", "responsable"].includes(sessionUser.role)) {
  alert("Accès réservé aux responsables et administrateurs.");
  window.location.href = "./home.html";
}

const startDateInput = document.getElementById("start-date");
const endDateInput = document.getElementById("end-date");
const anomaliesOnlyInput = document.getElementById("anomalies-only");
const loadBtn = document.getElementById("load-analysis-btn");

const kpiCa = document.getElementById("kpi-ca");
const kpiCost = document.getElementById("kpi-cost");
const kpiMargin = document.getElementById("kpi-margin");
const kpiMarginPct = document.getElementById("kpi-margin-pct");
const kpiPricingIssues = document.getElementById("kpi-pricing-issues");
const kpiCostIssues = document.getElementById("kpi-cost-issues");
const kpiNegativeMargins = document.getElementById("kpi-negative-margins");

const articlesBody = document.getElementById("articles-body");
const daysBody = document.getElementById("days-body");

const backBtn = document.getElementById("back-compta-home-btn");
const logoutBtn = document.getElementById("logout-btn");

function formatMoney(value) {
  return Number(value || 0).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + " €";
}

function formatQty(value) {
  return Number(value || 0).toLocaleString("fr-FR", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

function formatPct(value) {
  return Number(value || 0).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + " %";
}

function formatDate(value) {
  return String(value || "").slice(0, 10);
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function monthStartString() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function issueBadge(row) {
  const notes = [];

  if (row.pricing_issue) notes.push("PV absent");
  if (row.cost_issue) notes.push("Coût absent");
  if (row.negative_margin) notes.push("Marge négative");

  if (!notes.length) {
    return `<span class="badge-ok">OK</span>`;
  }

  return `<span class="badge-warning">${notes.join(" / ")}</span>`;
}

function renderSummary(summary) {
  const ca = Number(summary.theoretical_ca_ht || 0);
  const margin = Number(summary.theoretical_margin_ht || 0);
  const marginPct = ca > 0 ? (margin / ca) * 100 : 0;

  kpiCa.textContent = formatMoney(ca);
  kpiCost.textContent = formatMoney(summary.theoretical_cost_ht);
  kpiMargin.textContent = formatMoney(margin);
  kpiMarginPct.textContent = formatPct(marginPct);

  kpiPricingIssues.textContent = summary.pricing_issues || 0;
  kpiCostIssues.textContent = summary.cost_issues || 0;
  kpiNegativeMargins.textContent = summary.negative_margins || 0;
}

function renderArticles(articles) {
  if (!articles || articles.length === 0) {
    articlesBody.innerHTML = `
      <tr>
        <td colspan="9">Aucun article trouvé sur cette période.</td>
      </tr>
    `;
    return;
  }

  articlesBody.innerHTML = articles.map((row) => `
    <tr>
      <td>${row.article_plu || ""}</td>
      <td>${row.article_label || ""}</td>
      <td>${formatQty(row.qty_sold)}</td>
      <td>${row.sale_unit || ""}</td>
      <td>${formatMoney(row.ca_ht)}</td>
      <td>${formatMoney(row.cost_ht)}</td>
      <td>${formatMoney(row.margin_ht)}</td>
      <td>${formatPct(row.margin_pct)}</td>
      <td>${issueBadge(row)}</td>
    </tr>
  `).join("");
}

function renderDays(days) {
  if (!days || days.length === 0) {
    daysBody.innerHTML = `
      <tr>
        <td colspan="7">Aucune journée validée sur cette période.</td>
      </tr>
    `;
    return;
  }

  daysBody.innerHTML = days.map((day) => `
    <tr>
      <td>${formatDate(day.closure_date)}</td>
      <td>${formatMoney(day.ca_real_ht)}</td>
      <td>${formatMoney(day.theoretical_ca_ht)}</td>
      <td>${formatMoney(day.delta_ca_real_vs_theoretical)}</td>
      <td>${formatMoney(day.real_margin_ht)}</td>
      <td>${formatMoney(day.theoretical_margin_ht)}</td>
      <td>${formatMoney(day.delta_margin_real_vs_theoretical)}</td>
    </tr>
  `).join("");
}

async function loadAnalysis() {
  if (!activeDepartment?.id) {
    alert("Rayon actif introuvable.");
    return;
  }

  const startDate = startDateInput.value;
  const endDate = endDateInput.value;

  if (!startDate || !endDate) {
    alert("Dates obligatoires.");
    return;
  }

  const params = new URLSearchParams({
    department_id: activeDepartment.id,
    start_date: startDate,
    end_date: endDate,
    anomalies_only: anomaliesOnlyInput.checked ? "true" : "false",
  });

  const res = await fetch(`${API_URL}/compta/analysis?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await res.json();

  if (!res.ok) {
    console.error(data);
    alert(data.error || "Erreur chargement analyse.");
    return;
  }

  renderSummary(data.summary || {});
  renderArticles(data.articles || []);
  renderDays(data.days || []);
}

if (loadBtn) {
  loadBtn.addEventListener("click", loadAnalysis);
}

if (anomaliesOnlyInput) {
  anomaliesOnlyInput.addEventListener("change", loadAnalysis);
}

if (backBtn) {
  backBtn.addEventListener("click", () => {
    window.location.href = "./compta-home.html";
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

startDateInput.value = monthStartString();
endDateInput.value = todayString();

loadAnalysis();