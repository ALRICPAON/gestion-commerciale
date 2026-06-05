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
const saleDocumentTabs = document.getElementById("sale-document-tabs");
const salesSectionTitle = document.getElementById("sales-section-title");
const salesSectionHelper = document.getElementById("sales-section-helper");
const saleStatusFilter = document.getElementById("sale-status-filter");
const saleDateFromFilter = document.getElementById("sale-date-from-filter");
const saleDateToFilter = document.getElementById("sale-date-to-filter");
const refreshSalesBtn = document.getElementById("refresh-sales-btn");
const resetSalesFiltersBtn = document.getElementById("reset-sales-filters-btn");
const newSaleBtn = document.getElementById("new-sale-btn");
const newNegoceSaleBtn = document.getElementById("new-negoce-sale-btn");
const salesFeedback = document.getElementById("sales-feedback");
const salesTableBody = document.getElementById("sales-table-body");
const sectionLabels = {
  orders: "Commandes",
  delivery_notes: "Bons de livraison",
  invoices: "Factures",
  credit_notes: "Avoirs",
};
const sectionTitles = {
  orders: "Commandes actives",
  delivery_notes: "Bons de livraison",
  invoices: "Factures client",
  credit_notes: "Avoirs client",
};
const sectionHelpers = {
  orders: "Commandes brouillon ou en cours, avant passage en bon de livraison.",
  delivery_notes: "Bons de livraison issus des commandes, validés ou déjà facturés.",
  invoices: "Factures client avec avoirs liés et solde restant.",
  credit_notes: "Avoirs client rattachés à leur facture source.",
};
let sales = [];
let activeSection = localStorage.getItem("gc_sales_section") || "orders";
function departments() { return Array.isArray(sessionUser.departments) ? sessionUser.departments : []; }
function safeDepartment() { return activeDepartment && departments().some((dep) => dep.id === activeDepartment.id) ? activeDepartment : departments()[0] || null; }
function saveActiveDepartment(department) { localStorage.setItem("gc_active_department", JSON.stringify(department)); localStorage.setItem("grv2_active_department", JSON.stringify(department)); }
function showFeedback(el, message, isError = false) { if (!el) return; el.textContent = message; el.classList.remove("hidden"); el.classList.toggle("error", isError); el.classList.toggle("success", !isError); }
function clearFeedback(el) { if (!el) return; el.textContent = ""; el.classList.add("hidden"); el.classList.remove("error", "success"); }
async function apiFetch(path, options = {}) { const response = await fetch(`${API_BASE}${path}`, { ...options, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(options.headers || {}) } }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || "Erreur API"); return data; }
function formatDate(value) { if (!value) return "-"; try { return new Date(value).toLocaleDateString("fr-FR"); } catch { return value; } }
function dateKey(value) { if (!value) return ""; try { return new Date(value).toISOString().slice(0, 10); } catch { return String(value).slice(0, 10); } }
function money(value) { return Number(value || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function amount(value) { return Number(value || 0); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" }[char])); }
function statusLabel(status) { return ({ draft: "Brouillon", validated: "Validé", delivered: "Livré", invoiced: "Facturé", cancelled: "Annulé" })[status] || status || "-"; }
function typeLabel(sale) { if (sale.origin === "negoce" && sale.document_type === "ORDER") return "Commande Négoce"; return ({ ORDER: "Commande", DELIVERY_NOTE: "Bon de livraison", INVOICE: "Facture", CREDIT_NOTE: "Avoir client", manual_sale: "Vente manuelle", inventory_sale: "Vente inventaire" })[sale.document_type] || sale.document_type || "-"; }
function renderTopbar() { if (userNameEl) userNameEl.textContent = sessionUser.email || "Utilisateur"; }
function renderDepartmentSelector() { const list = departments(); const current = safeDepartment(); departmentSelect.innerHTML = ""; if (!list.length) { departmentSelect.innerHTML = `<option value="">Aucun service</option>`; departmentSelect.disabled = true; currentDepartmentNameEl.textContent = "Aucun service"; return; } list.forEach((department) => { const option = document.createElement("option"); option.value = department.id; option.textContent = `${department.name} (${department.code})`; departmentSelect.appendChild(option); }); if (current) { departmentSelect.value = current.id; currentDepartmentNameEl.textContent = current.name || "-"; saveActiveDepartment(current); } departmentSelect.disabled = list.length === 1; departmentSelect.addEventListener("change", () => { const selected = list.find((dep) => dep.id === departmentSelect.value); if (!selected) return; saveActiveDepartment(selected); window.location.reload(); }); }
function baseFilteredSales() { const from = saleDateFromFilter?.value || ""; const to = saleDateToFilter?.value || ""; return sales.filter((sale) => { const key = dateKey(sale.document_date); if (from && key && key < from) return false; if (to && key && key > to) return false; return true; }); }
function isActiveOrder(sale) { return sale.document_type === "ORDER" && !["delivered", "invoiced", "cancelled"].includes(String(sale.status || "").toLowerCase()); }
function sectionFor(sale) { if (isActiveOrder(sale)) return "orders"; if (sale.document_type === "DELIVERY_NOTE") return "delivery_notes"; if (sale.document_type === "INVOICE") return "invoices"; if (sale.document_type === "CREDIT_NOTE") return "credit_notes"; return null; }
function sectionCount(section) { return baseFilteredSales().filter((sale) => sectionFor(sale) === section).length; }
function creditNotesFor(invoice) { return sales.filter((sale) => sale.document_type === "CREDIT_NOTE" && sale.source_invoice_id === invoice.id); }
function sourceInvoiceFor(creditNote) { return sales.find((sale) => sale.id === creditNote.source_invoice_id); }
function invoiceSummary(invoice) { const creditNotes = creditNotesFor(invoice); const creditTtc = creditNotes.reduce((sum, credit) => sum + amount(credit.total_amount_inc_vat), 0); const invoiceTtc = amount(invoice.total_amount_inc_vat); const balance = Math.max(invoiceTtc - creditTtc, 0); return { creditNotes, creditTtc, invoiceTtc, balance }; }
function renderTabs() { if (!saleDocumentTabs) return; saleDocumentTabs.querySelectorAll("[data-section]").forEach((button) => { const section = button.dataset.section; const active = section === activeSection; button.classList.toggle("btn-primary", active); button.classList.toggle("btn-secondary", !active); button.setAttribute("aria-selected", active ? "true" : "false"); button.textContent = `${sectionLabels[section]} (${sectionCount(section)})`; }); if (salesSectionTitle) salesSectionTitle.textContent = sectionTitles[activeSection] || "Documents vente"; if (salesSectionHelper) salesSectionHelper.textContent = sectionHelpers[activeSection] || ""; }
async function loadSales() { clearFeedback(salesFeedback); const params = new URLSearchParams(); if (saleStatusFilter?.value) params.set("status", saleStatusFilter.value); sales = await apiFetch(`/api/sales?${params.toString()}`); renderSalesTable(); }
function referenceDetails(sale) { if (sale.document_type === "INVOICE") { const summary = invoiceSummary(sale); return `${escapeHtml(sale.reference_number || "-")}<br><small>Facturé ${money(summary.invoiceTtc)} € - Avoirs ${money(summary.creditTtc)} € - Solde ${money(summary.balance)} €</small>${summary.creditNotes.length ? `<br><small>Avoirs liés : ${summary.creditNotes.map((credit) => escapeHtml(credit.reference_number || credit.id)).join(", ")}</small>` : ""}`; } if (sale.document_type === "CREDIT_NOTE") { const invoice = sourceInvoiceFor(sale); return `${escapeHtml(sale.reference_number || "-")}<br><small>Facture source : ${escapeHtml(invoice?.reference_number || sale.source_invoice_id || "-")}</small>`; } if (sale.document_type === "DELIVERY_NOTE" && sale.invoice_reference) { return `${escapeHtml(sale.reference_number || "-")}<br><small>Facture : ${escapeHtml(sale.invoice_reference)}</small>`; } return escapeHtml(sale.reference_number || "-"); }
function renderSalesTable() { renderTabs(); const visibleSales = baseFilteredSales().filter((sale) => sectionFor(sale) === activeSection); if (!visibleSales.length) { salesTableBody.innerHTML = `<tr><td colspan="9">Aucun document dans cette section</td></tr>`; return; } salesTableBody.innerHTML = visibleSales.map((sale) => `<tr><td>${formatDate(sale.document_date)}</td><td>${escapeHtml(sale.client_name || "-")}</td><td>${escapeHtml(typeLabel(sale))}</td><td>${escapeHtml(statusLabel(sale.status))}</td><td>${referenceDetails(sale)}</td><td>${sale.line_count || 0}</td><td>${money(sale.total_amount_ex_vat)} €</td><td>${money(sale.total_amount_inc_vat)} €</td><td><div class="page-actions-right"><button class="btn btn-secondary btn-sm" data-action="open-sale" data-id="${sale.id}">Ouvrir</button>${sale.status === "draft" ? `<button class="btn btn-danger btn-sm" data-action="delete-sale" data-id="${sale.id}">Supprimer</button>` : ""}</div></td></tr>`).join(""); }
async function createSale() { clearFeedback(salesFeedback); const data = await apiFetch("/api/sales", { method: "POST", body: JSON.stringify({ document_type: "ORDER", origin: "manual", notes: null }) }); if (data?.sale?.id) window.location.href = `./sale-detail.html?id=${encodeURIComponent(data.sale.id)}`; }
async function createNegoceSale() { clearFeedback(salesFeedback); const data = await apiFetch("/api/sales/negoce", { method: "POST", body: JSON.stringify({ notes: "Commande Négoce" }) }); if (data?.sale?.id) window.location.href = `./sale-detail.html?id=${encodeURIComponent(data.sale.id)}`; }
async function deleteSale(saleId) { clearFeedback(salesFeedback); if (!confirm("Supprimer ce document de vente ?")) return; await apiFetch(`/api/sales/${saleId}`, { method: "DELETE" }); sales = sales.filter((sale) => sale.id !== saleId); renderSalesTable(); showFeedback(salesFeedback, "Document supprimé"); }
if (logoutBtn) logoutBtn.addEventListener("click", () => { localStorage.removeItem("gc_token"); localStorage.removeItem("gc_user"); localStorage.removeItem("gc_active_department"); localStorage.removeItem("grv2_token"); localStorage.removeItem("grv2_user"); localStorage.removeItem("grv2_active_department"); window.location.href = "./login.html"; });
if (backHomeBtn) backHomeBtn.addEventListener("click", () => { window.location.href = "./home.html"; });
if (saleDocumentTabs) saleDocumentTabs.addEventListener("click", (event) => { const button = event.target.closest("[data-section]"); if (!button) return; activeSection = button.dataset.section || "orders"; localStorage.setItem("gc_sales_section", activeSection); renderSalesTable(); });
if (refreshSalesBtn) refreshSalesBtn.addEventListener("click", loadSales);
if (resetSalesFiltersBtn) resetSalesFiltersBtn.addEventListener("click", async () => { if (saleStatusFilter) saleStatusFilter.value = ""; if (saleDateFromFilter) saleDateFromFilter.value = ""; if (saleDateToFilter) saleDateToFilter.value = ""; await loadSales(); });
if (saleStatusFilter) saleStatusFilter.addEventListener("change", loadSales);
if (saleDateFromFilter) saleDateFromFilter.addEventListener("change", renderSalesTable);
if (saleDateToFilter) saleDateToFilter.addEventListener("change", renderSalesTable);
if (newSaleBtn) newSaleBtn.addEventListener("click", createSale);
if (newNegoceSaleBtn) newNegoceSaleBtn.addEventListener("click", createNegoceSale);
if (salesTableBody) salesTableBody.addEventListener("click", async (event) => { const button = event.target.closest("[data-action]"); if (!button) return; if (button.dataset.action === "open-sale") window.location.href = `./sale-detail.html?id=${encodeURIComponent(button.dataset.id)}`; if (button.dataset.action === "delete-sale") await deleteSale(button.dataset.id); });
async function init() { try { renderTopbar(); renderDepartmentSelector(); await loadSales(); } catch (error) { console.error("Erreur init ventes :", error); showFeedback(salesFeedback, error.message || "Erreur chargement ventes", true); } }
init();