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

const backBtn = document.getElementById("back-compta-home-btn");
const logoutBtn = document.getElementById("logout-btn");
const printBtn = document.getElementById("print-btn");

const periodTypeInput = document.getElementById("period-type");
const startDateInput = document.getElementById("start-date");
const endDateInput = document.getElementById("end-date");
const loadBtn = document.getElementById("load-dashboard-btn");

const periodLabel = document.getElementById("period-label");

const kpiCaReal = document.getElementById("kpi-ca-real");
const kpiRealMargin = document.getElementById("kpi-real-margin");
const kpiRealMarginPct = document.getElementById("kpi-real-margin-pct");
const kpiCaTheoretical = document.getElementById("kpi-ca-theoretical");
const kpiTheoreticalMargin = document.getElementById("kpi-theoretical-margin");
const kpiTheoreticalMarginPct = document.getElementById("kpi-theoretical-margin-pct");
const kpiDeltaCa = document.getElementById("kpi-delta-ca");
const kpiDeltaN1 = document.getElementById("kpi-delta-n1");
const kpiDeltaN1Pct = document.getElementById("kpi-delta-n1-pct");
const kpiStockStart = document.getElementById("kpi-stock-start");
const kpiPurchases = document.getElementById("kpi-purchases");
const kpiStockEnd = document.getElementById("kpi-stock-end");
const kpiConsumedCost = document.getElementById("kpi-consumed-cost");

const daysBody = document.getElementById("dashboard-days-body");

function formatMoney(value) {
  return Number(value || 0).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + " €";
}

function formatPct(value) {
  return Number(value || 0).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + " %";
}

function toDateInputValue(date) {
  return date.toISOString().slice(0, 10);
}

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function setDefaultPeriod() {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  startDateInput.value = toDateInputValue(start);
  endDateInput.value = toDateInputValue(end);
}

function updatePeriodDates() {
  const type = periodTypeInput.value;
  const today = new Date();

  if (type === "custom") {
    return;
  }

  if (type === "day") {
    startDateInput.value = toDateInputValue(today);
    endDateInput.value = toDateInputValue(today);
  }

  if (type === "week") {
    const start = getMonday(today);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);

    startDateInput.value = toDateInputValue(start);
    endDateInput.value = toDateInputValue(end);
  }

  if (type === "month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    startDateInput.value = toDateInputValue(start);
    endDateInput.value = toDateInputValue(end);
  }

  if (type === "year") {
    const start = new Date(today.getFullYear(), 0, 1);
    const end = new Date(today.getFullYear(), 11, 31);

    startDateInput.value = toDateInputValue(start);
    endDateInput.value = toDateInputValue(end);
  }
}

function renderSummary(summary) {
  kpiCaReal.textContent = formatMoney(summary.ca_real_ht);
  kpiRealMargin.textContent = formatMoney(summary.real_margin_ht);
  kpiRealMarginPct.textContent = formatPct(summary.real_margin_pct);
  kpiStockStart.textContent = formatMoney(summary.stock_start_value_ht);
kpiPurchases.textContent = formatMoney(summary.purchases_ht);
kpiStockEnd.textContent = formatMoney(summary.stock_end_value_ht);
kpiConsumedCost.textContent = formatMoney(summary.real_consumed_cost_ht);

  kpiCaTheoretical.textContent = formatMoney(summary.theoretical_ca_ht);
  kpiTheoreticalMargin.textContent = formatMoney(summary.theoretical_margin_ht);
  kpiTheoreticalMarginPct.textContent = formatPct(summary.theoretical_margin_pct);

  kpiDeltaCa.textContent = formatMoney(summary.delta_ca_real_vs_theoretical);
  kpiDeltaN1.textContent = formatMoney(summary.delta_ca_vs_n1);
  kpiDeltaN1Pct.textContent = formatPct(summary.delta_ca_vs_n1_pct);
}

function renderDays(days) {
  if (!days || days.length === 0) {
    daysBody.innerHTML = `
      <tr>
        <td colspan="11">Aucune journée validée sur cette période.</td>
      </tr>
    `;
    return;
  }

  daysBody.innerHTML = days.map((day) => `
  <tr>
    <td>${day.closure_date?.slice(0, 10) || ""}</td>
    <td>${formatMoney(day.stock_start_value_ht)}</td>
    <td>${formatMoney(day.purchases_ht)}</td>
    <td>${formatMoney(day.stock_end_value_ht)}</td>
    <td>${formatMoney(day.real_consumed_cost_ht)}</td>
    <td>${formatMoney(day.ca_real_ht)}</td>
    <td>${formatMoney(day.real_margin_ht)}</td>
    <td>${formatPct(day.real_margin_pct)}</td>
    <td>${formatMoney(day.theoretical_ca_ht)}</td>
    <td>${formatMoney(day.theoretical_margin_ht)}</td>
    <td>${formatMoney(day.delta_ca_real_vs_theoretical)}</td>
  </tr>
`).join("");
}

async function loadDashboard() {
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

  periodLabel.textContent = `Période du ${startDate} au ${endDate}`;

  const url =
    `${API_URL}/compta/period?department_id=${activeDepartment.id}` +
    `&start_date=${startDate}&end_date=${endDate}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await res.json();

  if (!res.ok) {
    console.error(data);
    alert(data.error || "Erreur chargement tableau de bord.");
    return;
  }

  renderSummary(data.summary || {});
  renderDays(data.days || []);
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

if (printBtn) {
  printBtn.addEventListener("click", () => {
    const printableContent = document.querySelector(".compta-dashboard-page");

    if (!printableContent) {
      alert("Contenu imprimable introuvable.");
      return;
    }

    const printWindow = window.open("", "_blank");

    if (!printWindow) {
      alert("Impossible d’ouvrir la fenêtre d’impression.");
      return;
    }

    const html = `
      <!DOCTYPE html>
      <html lang="fr">
      <head>
        <meta charset="UTF-8" />
        <title>Tableau de bord comptabilité</title>

        <style>
          * {
            box-sizing: border-box;
          }

          body {
            font-family: Arial, sans-serif;
            background: #ffffff;
            color: #111827;
            margin: 0;
            padding: 20px;
          }

          .no-print {
            display: none !important;
          }

          .compta-dashboard-page {
            max-width: none;
            padding: 0;
          }

          .print-title {
            margin-bottom: 18px;
          }

          .print-title h2 {
            margin: 0 0 6px;
            font-size: 22px;
          }

          .print-title p {
            margin: 0;
            color: #475569;
          }

          .kpi-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 12px;
            margin-bottom: 20px;
          }

          .kpi-card {
            border: 1px solid #d1d5db;
            border-radius: 10px;
            padding: 12px;
          }

          .kpi-card span {
            display: block;
            font-size: 12px;
            color: #64748b;
            margin-bottom: 6px;
          }

          .kpi-card strong {
            display: block;
            font-size: 20px;
          }

          .kpi-card small {
            display: block;
            margin-top: 4px;
            font-weight: 700;
          }

          .dashboard-card {
            border: 1px solid #d1d5db;
            border-radius: 10px;
            padding: 12px;
          }

          .dashboard-card h3 {
            margin-top: 0;
          }

          .table-wrapper {
            overflow: visible;
          }

          .dashboard-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 11px;
          }

          .dashboard-table th,
          .dashboard-table td {
            border-bottom: 1px solid #e5e7eb;
            padding: 6px;
            text-align: right;
            white-space: nowrap;
          }

          .dashboard-table th:first-child,
          .dashboard-table td:first-child {
            text-align: left;
          }

          .dashboard-table th {
            background: #f3f4f6;
            font-weight: 700;
          }

          @page {
            size: A4 landscape;
            margin: 10mm;
          }
        </style>
      </head>

      <body>
        ${printableContent.outerHTML}

        <script>
          window.onload = function () {
            setTimeout(function () {
              window.focus();
              window.print();
            }, 300);
          };
        <\/script>
      </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  });
}

periodTypeInput.addEventListener("change", () => {
  updatePeriodDates();
});

loadBtn.addEventListener("click", loadDashboard);

setDefaultPeriod();
loadDashboard();