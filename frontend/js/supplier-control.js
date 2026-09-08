const token = localStorage.getItem("gc_token") || localStorage.getItem("grv2_token");
const sessionUser = JSON.parse(localStorage.getItem("gc_user") || localStorage.getItem("grv2_user") || "null");

if (!token || !sessionUser) {
  window.location.href = "./login.html";
}

const API_BASE = window.APP_CONFIG.API_BASE_URL;
const PAGE_LIMIT = 40;

const els = {
  userName: document.getElementById("user-name"),
  backHome: document.getElementById("back-home-btn"),
  logout: document.getElementById("logout-btn"),
  refresh: document.getElementById("refresh-btn"),
  feedback: document.getElementById("page-feedback"),
  filters: document.querySelectorAll("[data-filter]"),
  search: document.getElementById("search-input"),
  listCount: document.getElementById("list-count"),
  prev: document.getElementById("prev-page-btn"),
  next: document.getElementById("next-page-btn"),
  list: document.getElementById("documents-list"),
  detailEmpty: document.getElementById("detail-empty"),
  detailContent: document.getElementById("detail-content"),
  documentKind: document.getElementById("document-kind"),
  detailTitle: document.getElementById("detail-title"),
  detailSubtitle: document.getElementById("detail-subtitle"),
  detailStatus: document.getElementById("detail-status"),
  pdfLink: document.getElementById("pdf-link"),
  readonlyNote: document.getElementById("readonly-note"),
  metrics: document.getElementById("detail-metrics"),
  matchSummary: document.getElementById("match-summary"),
  linksList: document.getElementById("links-list"),
  analyze: document.getElementById("analyze-btn"),
  proposalsSection: document.getElementById("proposals-section"),
  proposalsList: document.getElementById("proposals-list"),
  manualSection: document.getElementById("manual-section"),
  loadCandidates: document.getElementById("load-candidates-btn"),
  candidatesList: document.getElementById("candidates-list"),
  applyManual: document.getElementById("apply-manual-btn"),
  differenceSection: document.getElementById("difference-section"),
  differenceBox: document.getElementById("difference-box"),
  resolutionComment: document.getElementById("resolution-comment"),
  validationMessage: document.getElementById("validation-message"),
  validate: document.getElementById("validate-btn"),
  eventsList: document.getElementById("events-list"),
};

const statusLabels = {
  a_rapprocher: "A rapprocher",
  a_controler: "A controler",
  ecart: "Ecart detecte",
  avoir_attendu: "Avoir attendu",
  conforme: "Conforme",
  valide_a_payer: "Valide a payer",
  paye: "Paye",
  litige: "Litige",
  reconciliation_required: "A reconcilier",
};

const eventLabels = {
  pennylane_sync: "Synchronisation Pennylane",
  automatic_analysis: "Analyse automatique",
  match_applied: "Rapprochement confirme",
  match_added: "BL ajoute",
  match_removed: "BL retire",
  validation_requested: "Validation demandee",
  validation_succeeded: "Facture validee a payer",
  validation_failed: "Validation non aboutie",
  validation_already_applied: "Validation deja appliquee",
  validation_reconciliation_required: "Verification necessaire",
  difference_detected: "Ecart detecte",
  difference_accepted: "Ecart accepte",
  dispute_opened: "Litige ouvert",
  expected_credit_note: "Avoir fournisseur attendu",
};

const reasonLabels = {
  document_supprime_pennylane: "Document supprime dans Pennylane",
  document_deja_paye: "Document deja paye",
  already_paid: "Document deja paye",
  already_validated: "Document deja valide a payer",
  document_en_litige: "Document en litige",
  avoir_fournisseur_attendu: "Avoir fournisseur attendu",
  fournisseur_inconnu: "Fournisseur non resolu",
  aucun_bl_rapproche: "Aucun BL rapproche",
  difference_non_resolue: "Ecart non resolu",
  validation_reconciliation_required: "Verification du rapprochement necessaire",
};

let state = {
  documents: [],
  selectedId: null,
  detail: null,
  proposals: [],
  candidates: [],
  selectedPurchaseIds: new Set(),
  filter: "needs_action",
  offset: 0,
  total: 0,
  busy: false,
};

function canMutate() {
  return ["admin", "responsable"].includes(sessionUser.role);
}

function lockedStatus(status) {
  return ["valide_a_payer", "paye", "litige", "avoir_attendu", "reconciliation_required"].includes(status);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("fr-FR");
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatSignedCurrency(value) {
  const amount = Number(value || 0);
  const sign = amount > 0 ? "+" : "";
  return `${sign}${formatCurrency(amount)}`;
}

function showFeedback(message, type = "success") {
  if (!els.feedback) return;
  els.feedback.textContent = message;
  els.feedback.classList.remove("hidden", "error", "success", "warning");
  els.feedback.classList.add(type);
}

function clearFeedback() {
  els.feedback?.classList.add("hidden");
  els.feedback?.classList.remove("error", "success", "warning");
  if (els.feedback) els.feedback.textContent = "";
}

function errorMessage(error) {
  const code = error?.code;
  const map = {
    SUPPLIER_CONTROL_VALIDATION_BLOCKED: "Cette facture ne peut pas encore etre validee.",
    SUPPLIER_CONTROL_VALIDATION_IN_PROGRESS: "Une validation est deja en cours.",
    SUPPLIER_CONTROL_VALIDATION_RECONCILIATION_REQUIRED: "Une verification du rapprochement est necessaire.",
    SUPPLIER_CONTROL_CREDIT_NOTE_VALIDATION_NOT_SUPPORTED: "La validation des avoirs sera geree separement.",
    SUPPLIER_CONTROL_PENNYLANE_VALIDATION_FAILED: "Pennylane n'a pas pu etre mis a jour. La facture n'a pas ete validee dans ALTA.",
    SUPPLIER_CONTROL_DOCUMENT_LINKS_LOCKED: "Ce document est verrouille.",
  };
  const base = map[code] || error?.message || "Erreur API";
  const reasons = error?.details?.blocking_reasons || error?.details?.summary?.blocking_reasons || [];
  if (!Array.isArray(reasons) || !reasons.length) return base;
  return `${base}\n${reasons.map((reason) => `- ${reasonLabels[reason] || reason}`).join("\n")}`;
}

async function apiFetch(path, options = {}) {
  const headers = {
    Authorization: `Bearer ${token}`,
    ...(options.headers || {}),
  };
  if (options.body && !(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Erreur API");
    error.code = data.code;
    error.details = data.details;
    throw error;
  }
  return data;
}

function filterParams() {
  const params = new URLSearchParams();
  params.set("limit", String(PAGE_LIMIT));
  params.set("offset", String(state.offset));
  if (state.filter === "needs_action") params.set("status_group", "needs_action");
  else if (state.filter === "ready_to_validate") params.set("status_group", "ready_to_validate");
  else if (state.filter !== "all") params.set("supplier_control_status", state.filter);
  const search = els.search?.value.trim();
  if (search) params.set("search", search);
  return params;
}

async function loadDocuments({ keepSelection = true } = {}) {
  clearFeedback();
  state.busy = true;
  els.list.innerHTML = `<div class="supplier-control-empty">Chargement...</div>`;
  try {
    const data = await apiFetch(`/api/supplier-control/documents?${filterParams().toString()}`);
    state.documents = data.documents || [];
    state.total = data.pagination?.total || state.documents.length;
    renderDocuments();
    if (!keepSelection || !state.documents.some((doc) => doc.id === state.selectedId)) {
      state.selectedId = state.documents[0]?.id || null;
      if (state.selectedId) await openDocument(state.selectedId, { autoAnalyze: true });
      else renderNoSelection();
    }
  } finally {
    state.busy = false;
  }
}

function renderDocuments() {
  const count = state.total;
  els.listCount.textContent = `${count} document${count > 1 ? "s" : ""}`;
  els.prev.disabled = state.offset <= 0;
  els.next.disabled = state.offset + PAGE_LIMIT >= state.total;

  if (!state.documents.length) {
    els.list.innerHTML = `<div class="supplier-control-empty">Aucun document pour ce filtre.</div>`;
    return;
  }

  els.list.innerHTML = state.documents.map((doc) => {
    const status = doc.supplier_control_status || "a_rapprocher";
    const type = doc.document_type === "credit_note" ? "AVOIR" : "FACTURE";
    return `
      <button class="document-row ${doc.id === state.selectedId ? "is-selected" : ""}" type="button" data-document-id="${escapeHtml(doc.id)}">
        <span class="document-row-main">
          <span class="document-row-title">
            <strong>${escapeHtml(doc.supplier_name || "Fournisseur inconnu")}</strong>
            <span class="type-badge">${type}</span>
          </span>
          <span class="document-row-sub">${escapeHtml(doc.invoice_number || "-")} - ${formatDate(doc.invoice_date)}</span>
          <span class="document-row-meta">${doc.linked_purchase_count || 0} BL - ${statusLabels[status] || status}</span>
        </span>
        <span class="document-row-amount">
          ${formatCurrency(doc.amount_ex_vat)}
          <span class="status-badge status-${escapeHtml(status)}">${statusLabels[status] || status}</span>
        </span>
      </button>
    `;
  }).join("");
}

function renderNoSelection() {
  state.detail = null;
  state.proposals = [];
  state.candidates = [];
  state.selectedPurchaseIds.clear();
  els.detailEmpty.classList.remove("hidden");
  els.detailContent.classList.add("hidden");
}

async function openDocument(documentId, { autoAnalyze = false } = {}) {
  state.selectedId = documentId;
  renderDocuments();
  els.detailEmpty.classList.add("hidden");
  els.detailContent.classList.remove("hidden");
  els.detailTitle.textContent = "Chargement...";
  try {
    state.detail = await apiFetch(`/api/supplier-control/documents/${encodeURIComponent(documentId)}`);
    state.proposals = [];
    state.candidates = [];
    state.selectedPurchaseIds.clear();
    renderDetail();
    const status = state.detail?.summary?.control_status || state.detail?.document?.supplier_control_status;
    if (autoAnalyze && status === "a_rapprocher") {
      await analyzeDocument({ quiet: true });
    }
  } catch (error) {
    showFeedback(errorMessage(error), "error");
    renderNoSelection();
  }
}

function renderDetail() {
  const detail = state.detail;
  if (!detail?.document) return renderNoSelection();

  const doc = detail.document;
  const summary = detail.summary || {};
  const status = summary.control_status || doc.supplier_control_status || "a_rapprocher";
  const readOnly = !canMutate() || lockedStatus(status) || doc.document_type === "credit_note";

  els.documentKind.textContent = doc.document_type === "credit_note" ? "AVOIR" : "FACTURE";
  els.detailTitle.textContent = doc.invoice_number || "-";
  els.detailSubtitle.textContent = doc.supplier_name || "Fournisseur non resolu";
  els.detailStatus.textContent = statusLabels[status] || status;
  els.detailStatus.className = `status-badge status-${status}`;

  if (doc.public_file_url || doc.pdf_available) {
    els.pdfLink.href = doc.public_file_url || "#";
    els.pdfLink.textContent = "Voir le PDF";
    els.pdfLink.setAttribute("aria-disabled", doc.public_file_url ? "false" : "true");
  } else {
    els.pdfLink.href = "#";
    els.pdfLink.textContent = "PDF non disponible";
    els.pdfLink.setAttribute("aria-disabled", "true");
  }

  renderReadonlyNote(status, doc);
  renderMetrics(doc, summary);
  renderMatch(summary);
  renderLinks(detail.links || [], readOnly);
  renderProposals(readOnly);
  renderCandidates(readOnly);
  renderDifference(summary, readOnly);
  renderValidation(summary, doc, readOnly);
  renderEvents(detail.events || []);
  renderActionState(readOnly);
}

function renderReadonlyNote(status, doc) {
  let message = "";
  if (!canMutate()) message = "Lecture seule : les actions de controle sont reservees aux administrateurs et responsables.";
  if (status === "paye") message = "Document paye dans Pennylane. Le controle est en lecture seule.";
  if (status === "valide_a_payer") message = "Facture validee a payer dans Pennylane. Le controle est verrouille.";
  if (status === "reconciliation_required") {
    message = "Le statut de paiement a ete mis a jour dans Pennylane, mais le rapprochement ALTA a change pendant la validation. Une verification est necessaire.";
  }
  if (doc.document_type === "credit_note") {
    message = "Avoir fournisseur : la validation a payer sera geree dans un flux separe.";
  }
  els.readonlyNote.textContent = message;
  els.readonlyNote.classList.toggle("hidden", !message);
}

function renderMetrics(doc, summary) {
  const cells = [
    ["Date", formatDate(doc.invoice_date)],
    ["Echeance", formatDate(doc.due_date)],
    ["Montant HT", formatCurrency(summary.invoice_total ?? doc.amount_ex_vat)],
    ["TVA", formatCurrency(doc.amount_vat)],
    ["TTC", formatCurrency(doc.amount_inc_vat)],
    ["Montant BL", formatCurrency(summary.matched_purchase_total)],
    ["Ecart", formatSignedCurrency(summary.difference_total)],
    ["BL lies", String(summary.linked_purchase_count || 0)],
  ];
  els.metrics.innerHTML = cells.map(([label, value]) => `
    <div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
  `).join("");
}

function renderMatch(summary) {
  els.matchSummary.innerHTML = [
    ["Facture HT", formatCurrency(summary.invoice_total)],
    ["BL rapproches", formatCurrency(summary.matched_purchase_total)],
    ["Ecart", formatSignedCurrency(summary.difference_total)],
  ].map(([label, value]) => `
    <div class="summary-cell"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
  `).join("");
}

function renderLinks(links, readOnly) {
  if (!links.length) {
    els.linksList.innerHTML = `<div class="supplier-control-empty">Aucun BL rapproche.</div>`;
    return;
  }
  els.linksList.innerHTML = links.map((link) => `
    <div class="linked-purchase">
      <div>
        <strong>${escapeHtml(link.bl_number || "BL sans numero")}</strong>
        <div class="linked-details">
          <span>${formatDate(link.receipt_date || link.purchase_date || link.order_date)}</span>
          <span>${formatCurrency(link.purchase_total_ex_vat ?? link.total_amount_ex_vat)}</span>
          <span>${escapeHtml(link.purchase_supplier_name || "-")}</span>
          <span>${escapeHtml(link.purchase_status || "-")}</span>
        </div>
      </div>
      <div class="linked-actions">
        <button class="btn btn-secondary btn-sm" type="button" data-remove-purchase="${escapeHtml(link.purchase_id || "")}" ${readOnly ? "disabled" : ""}>Retirer</button>
      </div>
    </div>
  `).join("");
}

function proposalLabel(confidence) {
  const map = {
    exact: "Correspondance exacte",
    strong_candidate: "Correspondance forte",
    ambiguous: "Possible",
    candidate: "Candidat",
    no_match: "Aucun match",
  };
  return map[confidence] || confidence || "Candidat";
}

function renderProposals(readOnly) {
  els.proposalsSection.classList.toggle("hidden", !state.proposals.length);
  if (!state.proposals.length) {
    els.proposalsList.innerHTML = "";
    return;
  }
  els.proposalsList.innerHTML = state.proposals.map((proposal, index) => `
    <div class="proposal">
      <div>
        <strong>Option ${index + 1} - ${proposalLabel(proposal.confidence)}</strong>
        <div class="proposal-details">
          <span>${(proposal.bl_numbers || proposal.purchase_ids || []).map(escapeHtml).join(" + ") || "BL candidat"}</span>
          <span>Total ${formatCurrency(proposal.combination_total_ex_vat)}</span>
          <span>Ecart ${formatSignedCurrency(proposal.difference_ex_vat)}</span>
        </div>
      </div>
      <div class="proposal-actions">
        <button class="btn btn-primary btn-sm" type="button" data-apply-proposal="${index}" ${readOnly || proposal.applicable === false ? "disabled" : ""}>Confirmer</button>
      </div>
    </div>
  `).join("");
}

function renderCandidates(readOnly) {
  els.manualSection.classList.toggle("hidden", readOnly);
  if (readOnly) return;
  if (!state.candidates.length) {
    els.candidatesList.innerHTML = `<div class="supplier-control-empty">Charge les BL candidats du fournisseur.</div>`;
    els.applyManual.disabled = true;
    return;
  }
  els.candidatesList.innerHTML = state.candidates.map((candidate) => {
    const disabled = candidate.linked_to_locked_document || candidate.applicable === false;
    const checked = state.selectedPurchaseIds.has(candidate.purchase_id);
    return `
      <div class="candidate-row">
        <label>
          <input type="checkbox" data-candidate-id="${escapeHtml(candidate.purchase_id)}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""} />
          <span>
            <strong>${escapeHtml(candidate.bl_number || "BL sans numero")}</strong>
            <span>${formatDate(candidate.receipt_date || candidate.purchase_date)} - ${formatCurrency(candidate.total_ex_vat)} - ${escapeHtml(candidate.purchase_status || candidate.status || "-")}</span>
          </span>
        </label>
        <strong>${candidate.linked_to_locked_document ? "Verrouille" : formatSignedCurrency(candidate.amount_difference)}</strong>
      </div>
    `;
  }).join("");
  els.applyManual.disabled = state.selectedPurchaseIds.size === 0;
}

function renderDifference(summary, readOnly) {
  const hasDifference = Math.abs(Number(summary.difference_total || 0)) > 0.0001;
  const shouldShow = hasDifference && !["valide_a_payer", "paye", "litige", "avoir_attendu", "reconciliation_required"].includes(summary.control_status);
  els.differenceSection.classList.toggle("hidden", !shouldShow);
  if (!shouldShow) return;
  els.differenceBox.innerHTML = [
    ["Facture HT", formatCurrency(summary.invoice_total)],
    ["BL rapproches", formatCurrency(summary.matched_purchase_total)],
    ["Ecart", formatSignedCurrency(summary.difference_total)],
  ].map(([label, value]) => `<div class="summary-cell"><span>${label}</span><strong>${value}</strong></div>`).join("");
  els.differenceSection.querySelectorAll("[data-resolution]").forEach((button) => {
    button.disabled = readOnly;
  });
}

function renderValidation(summary, doc, readOnly) {
  const status = summary.control_status || doc.supplier_control_status;
  if (doc.document_type === "credit_note") {
    els.validationMessage.textContent = "Les avoirs ne sont pas valides a payer dans ce flux.";
    els.validate.classList.add("hidden");
    return;
  }
  if (status === "paye") {
    els.validationMessage.textContent = "Document paye.";
    els.validate.classList.add("hidden");
    return;
  }
  if (status === "valide_a_payer") {
    els.validationMessage.textContent = "Facture validee a payer.";
    els.validate.classList.add("hidden");
    return;
  }
  if (summary.can_validate) {
    els.validationMessage.textContent = "Facture conforme ou ecart traite. La validation marquera la facture a payer dans Pennylane.";
    els.validate.classList.remove("hidden");
    els.validate.disabled = readOnly;
    return;
  }
  const reasons = (summary.blocking_reasons || []).map((reason) => reasonLabels[reason] || reason);
  els.validationMessage.textContent = reasons.length ? `Validation bloquee : ${reasons.join(", ")}.` : "Validation indisponible.";
  els.validate.classList.add("hidden");
}

function renderEvents(events) {
  if (!events.length) {
    els.eventsList.innerHTML = `<div class="supplier-control-empty">Aucun historique.</div>`;
    return;
  }
  els.eventsList.innerHTML = events.slice(0, 30).map((event) => `
    <div class="event-row">
      <strong>${escapeHtml(eventLabels[event.event_type] || event.event_type || "Action")}</strong>
      <span>${formatDate(event.created_at)}</span>
    </div>
  `).join("");
}

function renderActionState(readOnly) {
  els.analyze.disabled = state.busy;
  els.loadCandidates.disabled = readOnly || state.busy;
  els.applyManual.disabled = readOnly || state.busy || state.selectedPurchaseIds.size === 0;
}

async function analyzeDocument({ quiet = false } = {}) {
  if (!state.selectedId) return;
  state.busy = true;
  els.analyze.disabled = true;
  els.analyze.textContent = "Analyse...";
  try {
    const data = await apiFetch(`/api/supplier-control/documents/${encodeURIComponent(state.selectedId)}/analyze`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    state.proposals = data.proposals || [];
    await refreshSelectedDetail(false);
    state.proposals = data.proposals || [];
    renderDetail();
    if (!quiet) showFeedback(state.proposals.length ? "Analyse terminee." : "Aucun rapprochement automatique trouve.", state.proposals.length ? "success" : "warning");
  } catch (error) {
    showFeedback(errorMessage(error), "error");
  } finally {
    state.busy = false;
    els.analyze.disabled = false;
    els.analyze.textContent = "Analyser";
  }
}

async function refreshSelectedDetail(updateList = true) {
  if (!state.selectedId) return;
  state.detail = await apiFetch(`/api/supplier-control/documents/${encodeURIComponent(state.selectedId)}`);
  if (updateList) await loadDocuments({ keepSelection: true });
}

async function applyProposal(index) {
  const proposal = state.proposals[Number(index)];
  if (!proposal) return;
  await mutate("Rapprochement confirme.", async () => {
    await apiFetch(`/api/supplier-control/documents/${encodeURIComponent(state.selectedId)}/apply-match`, {
      method: "POST",
      body: JSON.stringify({ purchase_ids: proposal.purchase_ids || [] }),
    });
    state.proposals = [];
    await refreshSelectedDetail();
    renderDetail();
  });
}

async function loadCandidates() {
  if (!state.selectedId) return;
  state.busy = true;
  els.loadCandidates.disabled = true;
  els.loadCandidates.textContent = "Chargement...";
  try {
    const data = await apiFetch(`/api/supplier-control/documents/${encodeURIComponent(state.selectedId)}/purchase-candidates`);
    state.candidates = data.candidates || [];
    state.selectedPurchaseIds.clear();
    renderDetail();
  } catch (error) {
    showFeedback(errorMessage(error), "error");
  } finally {
    state.busy = false;
    els.loadCandidates.disabled = false;
    els.loadCandidates.textContent = "Charger les BL";
  }
}

async function applyManualSelection() {
  const purchaseIds = [...state.selectedPurchaseIds];
  if (!purchaseIds.length) return;
  const linkedIds = new Set((state.detail?.links || []).map((link) => String(link.purchase_id)));
  const idsToAdd = purchaseIds.filter((purchaseId) => !linkedIds.has(String(purchaseId)));
  if (!idsToAdd.length) {
    showFeedback("Les BL selectionnes sont deja lies.", "warning");
    return;
  }
  await mutate("Selection BL ajoutee.", async () => {
    for (const purchaseId of idsToAdd) {
      await apiFetch(`/api/supplier-control/documents/${encodeURIComponent(state.selectedId)}/purchase-links`, {
        method: "POST",
        body: JSON.stringify({ purchase_id: purchaseId }),
      });
    }
    state.candidates = [];
    state.selectedPurchaseIds.clear();
    await refreshSelectedDetail();
    renderDetail();
  });
}

async function removePurchase(purchaseId) {
  if (!purchaseId) return;
  await mutate("BL retire.", async () => {
    await apiFetch(`/api/supplier-control/documents/${encodeURIComponent(state.selectedId)}/purchase-links/${encodeURIComponent(purchaseId)}`, {
      method: "DELETE",
    });
    await refreshSelectedDetail();
    renderDetail();
  });
}

async function resolveDifference(resolutionType) {
  const comment = els.resolutionComment.value.trim();
  if (!comment) {
    showFeedback("Commentaire obligatoire pour traiter l'ecart.", "error");
    return;
  }
  await mutate("Ecart traite.", async () => {
    await apiFetch(`/api/supplier-control/documents/${encodeURIComponent(state.selectedId)}/resolve-difference`, {
      method: "POST",
      body: JSON.stringify({ resolution_type: resolutionType, comment }),
    });
    els.resolutionComment.value = "";
    await refreshSelectedDetail();
    renderDetail();
  });
}

async function validateDocument() {
  if (!state.selectedId) return;
  const confirmed = window.confirm("Valider cette facture comme controlee et a payer ?\n\nLa facture sera marquee a payer dans Pennylane.");
  if (!confirmed) return;
  await mutate("Facture validee a payer.", async () => {
    await apiFetch(`/api/supplier-control/documents/${encodeURIComponent(state.selectedId)}/validate`, {
      method: "POST",
      body: JSON.stringify({ confirmation: true }),
    });
    await refreshSelectedDetail();
    renderDetail();
  });
}

async function mutate(successMessage, fn) {
  if (state.busy) return;
  clearFeedback();
  state.busy = true;
  document.querySelectorAll("button").forEach((button) => { button.disabled = true; });
  try {
    await fn();
    showFeedback(successMessage, "success");
  } catch (error) {
    showFeedback(errorMessage(error), error.code === "SUPPLIER_CONTROL_VALIDATION_RECONCILIATION_REQUIRED" ? "warning" : "error");
    await refreshSelectedDetail(false).catch(() => {});
    renderDetail();
  } finally {
    state.busy = false;
    renderDetail();
    renderDocuments();
  }
}

function logout() {
  localStorage.removeItem("gc_token");
  localStorage.removeItem("gc_user");
  localStorage.removeItem("gc_active_department");
  localStorage.removeItem("grv2_token");
  localStorage.removeItem("grv2_user");
  localStorage.removeItem("grv2_active_department");
  window.location.href = "./login.html";
}

function bindEvents() {
  els.backHome?.addEventListener("click", () => { window.location.href = "./home.html"; });
  els.logout?.addEventListener("click", logout);
  els.refresh?.addEventListener("click", () => loadDocuments({ keepSelection: true }).catch((error) => showFeedback(errorMessage(error), "error")));
  els.prev?.addEventListener("click", () => {
    state.offset = Math.max(0, state.offset - PAGE_LIMIT);
    loadDocuments({ keepSelection: false }).catch((error) => showFeedback(errorMessage(error), "error"));
  });
  els.next?.addEventListener("click", () => {
    state.offset += PAGE_LIMIT;
    loadDocuments({ keepSelection: false }).catch((error) => showFeedback(errorMessage(error), "error"));
  });
  els.filters.forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      state.offset = 0;
      els.filters.forEach((item) => item.classList.toggle("is-active", item === button));
      loadDocuments({ keepSelection: false }).catch((error) => showFeedback(errorMessage(error), "error"));
    });
  });
  els.search?.addEventListener("input", () => {
    window.clearTimeout(els.search._timer);
    els.search._timer = window.setTimeout(() => {
      state.offset = 0;
      loadDocuments({ keepSelection: false }).catch((error) => showFeedback(errorMessage(error), "error"));
    }, 250);
  });
  els.list?.addEventListener("click", (event) => {
    const row = event.target.closest("[data-document-id]");
    if (!row) return;
    openDocument(row.dataset.documentId, { autoAnalyze: true });
  });
  els.analyze?.addEventListener("click", () => analyzeDocument());
  els.loadCandidates?.addEventListener("click", loadCandidates);
  els.applyManual?.addEventListener("click", applyManualSelection);
  els.validate?.addEventListener("click", validateDocument);
  els.pdfLink?.addEventListener("click", (event) => {
    if (els.pdfLink.getAttribute("aria-disabled") === "true") event.preventDefault();
  });
  document.addEventListener("click", (event) => {
    const proposalButton = event.target.closest("[data-apply-proposal]");
    if (proposalButton) applyProposal(proposalButton.dataset.applyProposal);
    const removeButton = event.target.closest("[data-remove-purchase]");
    if (removeButton) removePurchase(removeButton.dataset.removePurchase);
    const resolutionButton = event.target.closest("[data-resolution]");
    if (resolutionButton) resolveDifference(resolutionButton.dataset.resolution);
  });
  els.candidatesList?.addEventListener("change", (event) => {
    const input = event.target.closest("[data-candidate-id]");
    if (!input) return;
    if (input.checked) state.selectedPurchaseIds.add(input.dataset.candidateId);
    else state.selectedPurchaseIds.delete(input.dataset.candidateId);
    renderCandidates(false);
  });
}

async function init() {
  els.userName.textContent = sessionUser.email || sessionUser.name || "Utilisateur";
  bindEvents();
  await loadDocuments({ keepSelection: false });
}

init().catch((error) => showFeedback(errorMessage(error), "error"));
