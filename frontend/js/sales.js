const token = localStorage.getItem("gc_token") || localStorage.getItem("grv2_token");
const sessionUser = JSON.parse(localStorage.getItem("gc_user") || localStorage.getItem("grv2_user") || "null");
const activeDepartment = JSON.parse(localStorage.getItem("gc_active_department") || localStorage.getItem("grv2_active_department") || "null");
if (!token || !sessionUser) window.location.href = "./login.html";
const API_BASE = window.APP_CONFIG.API_BASE_URL;
const userNameEl = document.getElementById("user-name");
const logoutBtn = document.getElementById("logout-btn");
const backHomeBtn = document.getElementById("back-home-btn");
const departmentSelect = document.getElementById("topbar-department-select");
const currentDepartmentNameEl = document.getElementById("current-department-name");
const saleStatusFilter = document.getElementById("sale-status-filter");
const saleTypeFilter = document.getElementById("sale-type-filter");
const refreshSalesBtn = document.getElementById("refresh-sales-btn");
const resetSalesFiltersBtn = document.getElementById("reset-sales-filters-btn");
const newSaleBtn = document.getElementById("new-sale-btn");
const newNegoceSaleBtn = document.getElementById("new-negoce-sale-btn");
const salesFeedback = document.getElementById("sales-feedback");
const salesTableBody = document.getElementById("sales-table-body");
let sales = [];
function departments() { return Array.isArray(sessionUser.departments) ? sessionUser.departments : []; }
function safeDepartment() { return activeDepartment && departments().some((dep) => dep.id === activeDepartment.id) ? activeDepartment : departments()[0] || null; }
function saveActiveDepartment(department) { localStorage.setItem("gc_active_department", JSON.stringify(department)); localStorage.setItem("grv2_active_department", JSON.stringify(department)); }
function showFeedback(el, message, isError = false) { if (!el) return; el.textContent = message; el.classList.remove("hidden"); el.classList.toggle("error", isError); el.classList.toggle("success", !isError); }
function clearFeedback(el) { if (!el) return; el.textContent = ""; el.classList.add("hidden"); el.classList.remove("error", "success"); }
async function apiFetch(path, options = {}) { const response = await fetch(`${API_BASE}${path}`, { ...options, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(options.headers || {}) } }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || "Erreur API"); return data; }
function formatDate(value) { if (!value) return "-"; try { return new Date(value).toLocaleDateString("fr-FR"); } catch { return value; } }
function money(value) { return Number(value || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function statusLabel(status) { return ({ draft: "Brouillon", validated: "Validé", delivered: "Livré", invoiced: "Facturé", cancelled: "Annulé" })[status] || status || "-"; }
function typeLabel(sale) { if (sale.origin === "negoce" && sale.document_type === "ORDER") return "Commande Négoce"; return ({ ORDER: "Commande", DELIVERY_NOTE: "Bon de livraison", INVOICE: "Facture", manual_sale: "Vente manuelle", inventory_sale: "Vente inventaire" })[sale.document_type] || sale.document_type || "-"; }
function renderTopbar() { if (userNameEl) userNameEl.textContent = sessionUser.email || "Utilisateur"; }
function renderDepartmentSelector() { const list = departments(); const current = safeDepartment(); departmentSelect.innerHTML = ""; if (!list.length) { departmentSelect.innerHTML = `<option value="">Aucun service</option>`; departmentSelect.disabled = true; currentDepartmentNameEl.textContent = "Aucun service"; return; } list.forEach((department) => { const option = document.createElement("option"); option.value = department.id; option.textContent = `${department.name} (${department.code})`; departmentSelect.appendChild(option); }); if (current) { departmentSelect.value = current.id; currentDepartmentNameEl.textContent = current.name || "-"; saveActiveDepartment(current); } departmentSelect.disabled = list.length === 1; departmentSelect.addEventListener("change", () => { const selected = list.find((dep) => dep.id === departmentSelect.value); if (!selected) return; saveActiveDepartment(selected); window.location.reload(); }); }
async function loadSales() { clearFeedback(salesFeedback); const params = new URLSearchParams(); if (saleStatusFilter.value) params.set("status", saleStatusFilter.value); if (saleTypeFilter.value) params.set("document_type", saleTypeFilter.value); sales = await apiFetch(`/api/sales?${params.toString()}`); renderSalesTable(); }
function renderSalesTable() { if (!sales.length) { salesTableBody.innerHTML = `<tr><td colspan="9">Aucun document trouvé</td></tr>`; return; } salesTableBody.innerHTML = sales.map((sale) => `<tr><td>${formatDate(sale.document_date)}</td><td>${sale.client_name || "-"}</td><td>${typeLabel(sale)}</td><td>${statusLabel(sale.status)}</td><td>${sale.reference_number || "-"}</td><td>${sale.line_count || 0}</td><td>${money(sale.total_amount_ex_vat)} €</td><td>${money(sale.total_amount_inc_vat)} €</td><td><div class="page-actions-right"><button class="btn btn-secondary btn-sm" data-action="open-sale" data-id="${sale.id}">Ouvrir</button>${sale.status === "draft" ? `<button class="btn btn-danger btn-sm" data-action="delete-sale" data-id="${sale.id}">Supprimer</button>` : ""}</div></td></tr>`).join(""); }
async function createSale() { clearFeedback(salesFeedback); const data = await apiFetch("/api/sales", { method: "POST", body: JSON.stringify({ document_type: "ORDER", origin: "manual", notes: null }) }); if (data?.sale?.id) window.location.href = `./sale-detail.html?id=${encodeURIComponent(data.sale.id)}`; }
async function createNegoceSale() { clearFeedback(salesFeedback); const data = await apiFetch("/api/sales/negoce", { method: "POST", body: JSON.stringify({ notes: "Commande Négoce" }) }); if (data?.sale?.id) window.location.href = `./sale-detail.html?id=${encodeURIComponent(data.sale.id)}`; }
async function deleteSale(saleId) { clearFeedback(salesFeedback); if (!confirm("Supprimer ce document de vente ?")) return; await apiFetch(`/api/sales/${saleId}`, { method: "DELETE" }); sales = sales.filter((sale) => sale.id !== saleId); renderSalesTable(); showFeedback(salesFeedback, "Document supprimé"); }
if (logoutBtn) logoutBtn.addEventListener("click", () => { localStorage.removeItem("gc_token"); localStorage.removeItem("gc_user"); localStorage.removeItem("gc_active_department"); localStorage.removeItem("grv2_token"); localStorage.removeItem("grv2_user"); localStorage.removeItem("grv2_active_department"); window.location.href = "./login.html"; });
if (backHomeBtn) backHomeBtn.addEventListener("click", () => { window.location.href = "./home.html"; });
if (refreshSalesBtn) refreshSalesBtn.addEventListener("click", loadSales);
if (resetSalesFiltersBtn) resetSalesFiltersBtn.addEventListener("click", async () => { saleStatusFilter.value = ""; saleTypeFilter.value = ""; await loadSales(); });
if (saleStatusFilter) saleStatusFilter.addEventListener("change", loadSales);
if (saleTypeFilter) saleTypeFilter.addEventListener("change", loadSales);
if (newSaleBtn) newSaleBtn.addEventListener("click", createSale);
if (newNegoceSaleBtn) newNegoceSaleBtn.addEventListener("click", createNegoceSale);
if (salesTableBody) salesTableBody.addEventListener("click", async (event) => { const button = event.target.closest("[data-action]"); if (!button) return; if (button.dataset.action === "open-sale") window.location.href = `./sale-detail.html?id=${encodeURIComponent(button.dataset.id)}`; if (button.dataset.action === "delete-sale") await deleteSale(button.dataset.id); });
async function init() { try { renderTopbar(); renderDepartmentSelector(); await loadSales(); } catch (error) { console.error("Erreur init ventes :", error); showFeedback(salesFeedback, error.message || "Erreur chargement ventes", true); } }
init();
