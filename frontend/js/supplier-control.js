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
  expectedCreditNoteSection: document.getElementById("expected-credit-note-section"),
  expectedCreditNoteList: document.getElementById("expected-credit-note-list"),
  creditNoteMatchSection: document.getElementById("credit-note-match-section"),
  loadCreditNoteCandidates: document.getElementById("load-credit-note-candidates-btn"),
  creditNoteCandidatesList: document.getElementById("credit-note-candidates-list"),
  creditNoteLinksList: document.getElementById("credit-note-links-list"),
  applyCreditNoteMatch: document.getElementById("apply-credit-note-match-btn"),
  validationMessage: document.getElementById("validation-message"),
  validate: document.getElementById("validate-btn"),
  eventsList: document.getElementById("events-list"),
  stockEffectModal: document.getElementById("supplier-control-stock-effect-modal"),
  stockEffectContext: document.getElementById("supplier-control-stock-effect-context"),
  stockEffectFeedback: document.getElementById("supplier-control-stock-effect-feedback"),
  stockEffectType: document.getElementById("supplier-control-stock-effect-type"),
  stockEffectQuantity: document.getElementById("supplier-control-stock-effect-quantity"),
  stockEffectLine: document.getElementById("supplier-control-stock-effect-line"),
  stockEffectNotes: document.getElementById("supplier-control-stock-effect-notes"),
  closeStockEffectModal: document.getElementById("close-supplier-control-stock-effect-modal-btn"),
  createStockEffect: document.getElementById("create-supplier-control-stock-effect-btn"),
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
  supplier_stock_destruction_created: "Destruction stock",
  supplier_stock_return_created: "Retour stock fournisseur",
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
  creditNoteCandidates: [],
  selectedPurchaseIds: new Set(),
  selectedExpectedCreditNoteIds: new Set(),
  stockEffectExpectedCreditNoteId: null,
  stockEffectRequestId: null,
  filter: "needs_action",
  offset: 0,
  total: 0,
  busy: false,
};

const expectedCreditNoteReasonLabels = {
  price_error: "Erreur de prix",
  quality_issue: "Probleme qualite",
  quantity_issue: "Ecart de quantite",
  missing_goods: "Marchandise manquante",
  supplier_return: "Retour fournisseur",
  other: "Autre",
};

const expectedCreditNoteStatusLabels = {
  pending: "En attente",
  matched: "Avoir recu",
  resolved: "Solde",
  cancelled: "Annule",
  disputed: "Litige",
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

function documentAmountExVat(doc = {}) {
  return doc.amount_ex_vat ?? doc.currency_amount_ex_vat;
}

function formatSignedCurrency(value) {
  const amount = Number(value || 0);
  const sign = amount > 0 ? "+" : "";
  return `${sign}${formatCurrency(amount)}`;
}

function findStockEffectLineForExpectedCreditNote(note = {}) {
  const candidates = stockEffectLineCandidatesForExpectedCreditNote(note);
  return candidates.length === 1 ? candidates[0] : null;
}

function stockEffectLineCandidatesForExpectedCreditNote(note = {}) {
  const purchaseLines = state.detail?.purchase_lines || [];
  if (note.source_purchase_line_id) {
    return purchaseLines.filter((line) => String(line.id) === String(note.source_purchase_line_id) && line.lot_id);
  }
  if (note.source_purchase_id) {
    return purchaseLines.filter((line) => String(line.purchase_id) === String(note.source_purchase_id) && line.lot_id);
  }
  return [];
}

function stockEffectLineLabel(line = {}) {
  const available = Number(line.stock_qty_remaining || 0).toLocaleString("fr-FR", { maximumFractionDigits: 3 });
  const lot = line.stock_lot_code || line.supplier_lot_number || line.lot_id || "lot";
  return `${line.article_name || line.supplier_label || line.article_plu || "Article"} - ${lot} - dispo ${available} ${line.price_unit || ""}`;
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
          ${formatCurrency(documentAmountExVat(doc))}
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
  state.selectedExpectedCreditNoteIds.clear();
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
    state.creditNoteCandidates = [];
    state.selectedPurchaseIds.clear();
    state.selectedExpectedCreditNoteIds.clear();
    renderDetail();
    const status = state.detail?.summary?.control_status || state.detail?.document?.supplier_control_status;
    if (autoAnalyze && status === "a_rapprocher" && state.detail?.document?.document_type !== "credit_note") {
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
  const documentLocked = lockedStatus(status);
  const canEditInvoiceControl = canMutate() && !documentLocked && doc.document_type !== "credit_note";
  const canMatchCreditNote = canMutate() && doc.document_type === "credit_note";

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
  renderMatch(summary, doc);
  renderLinks(detail.links || [], !canEditInvoiceControl);
  renderProposals(!canEditInvoiceControl, doc);
  renderCandidates(!canEditInvoiceControl, doc);
  renderDifference(summary, !canEditInvoiceControl);
  renderExpectedCreditNotes(detail.expected_credit_notes || []);
  renderCreditNoteMatching(doc, !canMatchCreditNote);
  renderValidation(summary, doc, !canEditInvoiceControl);
  renderEvents(detail.events || []);
  renderActionState(!canEditInvoiceControl, !canMatchCreditNote, doc);
}

function renderReadonlyNote(status, doc) {
  let message = "";
  if (!canMutate()) message = "Lecture seule : les actions de controle sont reservees aux administrateurs et responsables.";
  if (status === "avoir_attendu" && doc.payment_status === "to_be_paid") {
    message = "Facture deja validee a payer dans Pennylane avant la creation de l'attente d'avoir.";
  }
  if (status === "avoir_attendu" && (doc.paid === true || doc.payment_status === "paid")) {
    message = "Facture deja payee dans Pennylane avant la creation de l'attente d'avoir.";
  }
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
  if (doc.document_type === "credit_note") return renderCreditNoteMetrics(doc, summary);
  const cells = [
    ["Date", formatDate(doc.invoice_date)],
    ["Echeance", formatDate(doc.due_date)],
    ["Montant HT", formatCurrency(summary.invoice_total ?? documentAmountExVat(doc))],
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

function renderCreditNoteMetrics(doc, summary) {
  const links = state.detail?.credit_note_links || [];
  const applied = links.reduce((sum, link) => sum + Number(link.applied_amount_ex_vat || 0), 0);
  const amount = Number(summary.invoice_total ?? documentAmountExVat(doc) ?? 0);
  const remaining = Math.max(amount - applied, 0);
  const cells = [
    ["Date", formatDate(doc.invoice_date)],
    ["Montant avoir HT", formatCurrency(amount)],
    ["Montant applique", formatCurrency(applied)],
    ["Reliquat non affecte", formatCurrency(remaining)],
    ["Attentes liees", String(links.length)],
  ];
  els.metrics.innerHTML = cells.map(([label, value]) => `
    <div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
  `).join("");
}

function renderMatch(summary, doc = {}) {
  if (doc.document_type === "credit_note") {
    const links = state.detail?.credit_note_links || [];
    const applied = links.reduce((sum, link) => sum + Number(link.applied_amount_ex_vat || 0), 0);
    const amount = Number(summary.invoice_total ?? documentAmountExVat(doc) ?? 0);
    const remaining = Math.max(amount - applied, 0);
    const rows = [
      ["Montant avoir HT", formatCurrency(amount)],
      ["Montant applique", formatCurrency(applied)],
      ["Reliquat non affecte", formatCurrency(remaining)],
      ["Attentes liees", String(links.length)],
    ];
    els.matchSummary.innerHTML = rows.map(([label, value]) => `
      <div class="summary-cell"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
    `).join("");
    return;
  }
  const rows = [
    ["Facture HT", formatCurrency(summary.invoice_total)],
    ["BL brut", formatCurrency(summary.gross_purchase_total_ex_vat ?? summary.matched_purchase_total)],
    ["Avoirs recus", `-${formatCurrency(summary.applied_credit_note_total_ex_vat)}`],
    ["Valeur nette achat", formatCurrency(summary.net_purchase_total_ex_vat ?? summary.matched_purchase_total)],
    ["Ecart residuel", formatSignedCurrency(summary.residual_difference_ex_vat ?? summary.difference_total)],
  ];
  els.matchSummary.innerHTML = rows.map(([label, value]) => `
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

function renderProposals(readOnly, doc = {}) {
  const show = doc.document_type !== "credit_note" && state.proposals.length;
  els.proposalsSection.classList.toggle("hidden", !show);
  if (!show) {
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

function renderCandidates(readOnly, doc = {}) {
  const show = doc.document_type !== "credit_note" && !readOnly;
  els.manualSection.classList.toggle("hidden", !show);
  if (!show) {
    els.candidatesList.innerHTML = "";
    els.applyManual.disabled = true;
    return;
  }
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

function renderExpectedCreditNotes(expectedCreditNotes) {
  els.expectedCreditNoteSection.classList.toggle("hidden", !expectedCreditNotes.length);
  if (!expectedCreditNotes.length) {
    els.expectedCreditNoteList.innerHTML = "";
    return;
  }
  els.expectedCreditNoteList.innerHTML = expectedCreditNotes.map((item) => {
    const expected = Number(item.expected_amount_ex_vat || 0);
    const received = Number(item.received_amount_ex_vat || 0);
    const remaining = Number(item.remaining_amount_ex_vat ?? Math.max(expected - received, 0));
    const overage = Math.max(received - expected, 0);
    const stockEffects = Array.isArray(item.stock_effects) ? item.stock_effects : [];
    const stockLineCandidates = stockEffectLineCandidatesForExpectedCreditNote(item);
    const canCreateStockEffect = canMutate() && stockLineCandidates.some((line) => Number(line.stock_qty_remaining || 0) > 0);
    return `
      <div class="expected-credit-note">
        <div class="expected-credit-note-main">
          <strong>${escapeHtml(expectedCreditNoteReasonLabels[item.reason_type] || item.reason_type || "Avoir attendu")}</strong>
          <span class="status-badge status-${escapeHtml(item.status || "pending")}">${escapeHtml(expectedCreditNoteStatusLabels[item.status] || item.status || "En attente")}</span>
        </div>
        <div class="linked-details">
          <span>Attendu ${formatCurrency(expected)}</span>
          <span>Recu ${formatCurrency(received)}</span>
          <span>Reste ${formatCurrency(remaining)}</span>
          ${overage > 0 ? `<span>Ecart avoir +${formatCurrency(overage)}</span>` : ""}
          ${item.bl_number ? `<span>BL ${escapeHtml(item.bl_number)}</span>` : ""}
          ${item.article_name ? `<span>${escapeHtml(item.article_name)}</span>` : ""}
          ${item.affected_quantity ? `<span>${escapeHtml(item.affected_quantity)} ${escapeHtml(item.affected_unit || "")}</span>` : ""}
        </div>
        <p>${escapeHtml(item.reason_comment || "")}</p>
        ${stockEffects.length ? `
          <div class="linked-details">
            ${stockEffects.map((effect) => `
              <span>${escapeHtml(effect.movement_type === "supplier_return" ? "Retour fournisseur" : "Destruction/perte")} ${escapeHtml(Math.abs(Number(effect.quantity || 0)).toLocaleString("fr-FR", { maximumFractionDigits: 3 }))} - ${escapeHtml(effect.article_name || effect.article_plu || "Article")}</span>
            `).join("")}
          </div>
        ` : `<div class="linked-details"><span>Effet stock physique : aucun</span></div>`}
        ${canCreateStockEffect ? `
          <div class="linked-actions">
            <button class="btn btn-secondary btn-sm" type="button" data-open-stock-effect="${escapeHtml(item.id)}">Effet stock</button>
          </div>
        ` : ""}
      </div>
    `;
  }).join("");
}

function renderCreditNoteMatching(doc, readOnly) {
  const isCreditNote = doc.document_type === "credit_note";
  els.creditNoteMatchSection.classList.toggle("hidden", !isCreditNote);
  if (!isCreditNote) {
    els.creditNoteCandidatesList.innerHTML = "";
    if (els.creditNoteLinksList) els.creditNoteLinksList.innerHTML = "";
    return;
  }
  renderCreditNoteLinks(state.detail?.credit_note_links || [], readOnly);
  if (!state.creditNoteCandidates.length) {
    els.creditNoteCandidatesList.innerHTML = `<div class="supplier-control-empty">Avoir a identifier : recherche les attentes du meme fournisseur.</div>`;
    els.loadCreditNoteCandidates.disabled = readOnly || state.busy;
    els.applyCreditNoteMatch.disabled = true;
    return;
  }
  els.creditNoteCandidatesList.innerHTML = state.creditNoteCandidates.map((candidate) => `
    <div class="candidate-row">
      <label>
        <input type="checkbox" data-expected-credit-note-id="${escapeHtml(candidate.id)}" ${state.selectedExpectedCreditNoteIds.has(candidate.id) ? "checked" : ""} ${readOnly || candidate.applicable === false ? "disabled" : ""} />
        <span>
          <strong>${escapeHtml(expectedCreditNoteReasonLabels[candidate.reason_type] || candidate.reason_type)}</strong>
          <span>${candidate.bl_number ? `BL ${escapeHtml(candidate.bl_number)} - ` : ""}Attendu ${formatCurrency(candidate.remaining_amount_ex_vat || candidate.expected_amount_ex_vat)} - Ecart ${formatSignedCurrency(candidate.difference_ex_vat)}</span>
        </span>
      </label>
      <strong>${escapeHtml(proposalLabel(candidate.confidence))}</strong>
    </div>
  `).join("");
  els.loadCreditNoteCandidates.disabled = readOnly || state.busy;
  els.applyCreditNoteMatch.disabled = readOnly || state.busy || state.selectedExpectedCreditNoteIds.size === 0;
}

function renderCreditNoteLinks(links, readOnly) {
  if (!els.creditNoteLinksList) return;
  if (!links.length) {
    els.creditNoteLinksList.innerHTML = "";
    return;
  }
  els.creditNoteLinksList.innerHTML = links.map((link) => {
    const expected = Number(link.expected_amount_ex_vat || 0);
    const received = Number(link.received_amount_ex_vat || 0);
    const remaining = Number(link.remaining_amount_ex_vat ?? Math.max(expected - received, 0));
    const overage = Number(link.over_applied_amount_ex_vat || 0);
    return `
      <div class="expected-credit-note">
        <div class="expected-credit-note-main">
          <strong>${escapeHtml(link.source_invoice_number || link.bl_number || "Attente liee")}</strong>
          <span class="status-badge status-${escapeHtml(link.expected_credit_note_status || "matched")}">${escapeHtml(expectedCreditNoteStatusLabels[link.expected_credit_note_status] || link.expected_credit_note_status || "Avoir recu")}</span>
        </div>
        <div class="linked-details">
          <span>Applique ${formatCurrency(link.applied_amount_ex_vat)}</span>
          <span>Attendu ${formatCurrency(expected)}</span>
          <span>Recu ${formatCurrency(received)}</span>
          <span>Reste ${formatCurrency(remaining)}</span>
          ${overage > 0 ? `<span>Excedent +${formatCurrency(overage)}</span>` : ""}
          ${link.bl_number ? `<span>BL ${escapeHtml(link.bl_number)}</span>` : ""}
        </div>
        <div class="linked-actions">
          <button class="btn btn-secondary btn-sm" type="button" data-remove-credit-note-link="${escapeHtml(link.id || "")}" ${readOnly ? "disabled" : ""}>Retirer</button>
        </div>
      </div>
    `;
  }).join("");
}

function closeStockEffectModal() {
  els.stockEffectModal?.classList.add("hidden");
  state.stockEffectExpectedCreditNoteId = null;
}

function openStockEffectModal(expectedCreditNoteId) {
  const note = (state.detail?.expected_credit_notes || []).find((item) => String(item.id) === String(expectedCreditNoteId));
  const candidates = stockEffectLineCandidatesForExpectedCreditNote(note)
    .filter((line) => Number(line.stock_qty_remaining || 0) > 0);
  if (!note || !candidates.length) {
    showFeedback("Aucun lot stock disponible pour cette attente.", "warning");
    return;
  }
  state.stockEffectExpectedCreditNoteId = note.id;
  state.stockEffectRequestId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  els.stockEffectContext.textContent = `${expectedCreditNoteReasonLabels[note.reason_type] || "Avoir attendu"} - ${candidates.length} lot${candidates.length > 1 ? "s" : ""} disponible${candidates.length > 1 ? "s" : ""}`;
  els.stockEffectType.value = "destruction";
  els.stockEffectQuantity.value = "";
  els.stockEffectLine.innerHTML = candidates.map((line) => `
    <option value="${escapeHtml(line.id)}">${escapeHtml(stockEffectLineLabel(line))}</option>
  `).join("");
  els.stockEffectNotes.value = "";
  els.stockEffectFeedback?.classList.add("hidden");
  els.stockEffectModal?.classList.remove("hidden");
}

async function createStockEffectFromSupplierControl() {
  const note = (state.detail?.expected_credit_notes || []).find((item) => String(item.id) === String(state.stockEffectExpectedCreditNoteId));
  const line = stockEffectLineCandidatesForExpectedCreditNote(note)
    .find((item) => String(item.id) === String(els.stockEffectLine?.value || ""));
  if (!note || !line) return;
  const type = els.stockEffectType.value === "supplier_return" ? "supplier_return" : "destruction";
  els.createStockEffect.disabled = true;
  try {
    await apiFetch(`/api/supplier-control/stock-effects/${type === "supplier_return" ? "supplier-return" : "destruction"}`, {
      method: "POST",
      body: JSON.stringify({
        purchase_id: line.purchase_id,
        purchase_line_id: line.id,
        lot_id: line.lot_id,
        article_id: line.article_id,
        supplier_id: state.detail?.document?.supplier_id,
        supplier_expected_credit_note_id: note.id,
        quantity: els.stockEffectQuantity.value,
        reason: type,
        notes: els.stockEffectNotes.value || null,
        idempotency_key: state.stockEffectRequestId,
      }),
    });
    closeStockEffectModal();
    await refreshSelectedDetail();
    renderDetail();
    showFeedback("Effet stock enregistre.", "success");
  } catch (error) {
    if (els.stockEffectFeedback) {
      els.stockEffectFeedback.textContent = errorMessage(error);
      els.stockEffectFeedback.classList.remove("hidden", "success", "warning");
      els.stockEffectFeedback.classList.add("error");
    }
  } finally {
    els.createStockEffect.disabled = false;
  }
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

function renderActionState(invoiceReadOnly, creditNoteReadOnly, doc = {}) {
  els.analyze.disabled = state.busy || invoiceReadOnly || doc.document_type === "credit_note";
  if (els.loadCandidates) els.loadCandidates.disabled = invoiceReadOnly || state.busy;
  if (els.applyManual) els.applyManual.disabled = invoiceReadOnly || state.busy || state.selectedPurchaseIds.size === 0;
  if (els.loadCreditNoteCandidates) els.loadCreditNoteCandidates.disabled = creditNoteReadOnly || state.busy;
  if (els.applyCreditNoteMatch) els.applyCreditNoteMatch.disabled = creditNoteReadOnly || state.busy || state.selectedExpectedCreditNoteIds.size === 0;
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

async function loadCreditNoteCandidates() {
  if (!state.selectedId) return;
  state.busy = true;
  els.loadCreditNoteCandidates.disabled = true;
  els.loadCreditNoteCandidates.textContent = "Recherche...";
  try {
    const data = await apiFetch(`/api/supplier-control/credit-notes/${encodeURIComponent(state.selectedId)}/match-candidates`);
    state.creditNoteCandidates = data.candidates || [];
    state.selectedExpectedCreditNoteIds.clear();
    renderDetail();
    if (!state.creditNoteCandidates.length) showFeedback("Aucune attente compatible pour cet avoir.", "warning");
  } catch (error) {
    showFeedback(errorMessage(error), "error");
  } finally {
    state.busy = false;
    els.loadCreditNoteCandidates.disabled = false;
    els.loadCreditNoteCandidates.textContent = "Chercher attentes";
  }
}

async function applyCreditNoteSelection() {
  const expectedCreditNoteIds = [...state.selectedExpectedCreditNoteIds];
  if (!expectedCreditNoteIds.length) return;
  await mutate("Avoir fournisseur associe.", async () => {
    const result = await apiFetch(`/api/supplier-control/credit-notes/${encodeURIComponent(state.selectedId)}/apply-match`, {
      method: "POST",
      body: JSON.stringify({ expected_credit_note_ids: expectedCreditNoteIds }),
    });
    state.creditNoteCandidates = [];
    state.selectedExpectedCreditNoteIds.clear();
    await refreshSelectedDetail();
    renderDetail();
    if (Number(result.unapplied_amount_ex_vat || 0) > 0.0001) {
      return {
        message: `Avoir associe. Reliquat non affecte : ${formatCurrency(result.unapplied_amount_ex_vat)}.`,
        type: "warning",
      };
    }
    return null;
  });
}

async function removeCreditNoteLink(linkId) {
  if (!linkId) return;
  await mutate("Lien avoir retire.", async () => {
    await apiFetch(`/api/supplier-control/credit-notes/${encodeURIComponent(state.selectedId)}/links/${encodeURIComponent(linkId)}`, {
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
  renderDetail();
  renderDocuments();
  try {
    const result = await fn();
    showFeedback(result?.message || successMessage, result?.type || "success");
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
  els.loadCreditNoteCandidates?.addEventListener("click", loadCreditNoteCandidates);
  els.applyCreditNoteMatch?.addEventListener("click", applyCreditNoteSelection);
  els.closeStockEffectModal?.addEventListener("click", closeStockEffectModal);
  els.createStockEffect?.addEventListener("click", createStockEffectFromSupplierControl);
  els.stockEffectModal?.addEventListener("click", (event) => {
    if (event.target === els.stockEffectModal) closeStockEffectModal();
  });
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
    const removeCreditNoteLinkButton = event.target.closest("[data-remove-credit-note-link]");
    if (removeCreditNoteLinkButton) removeCreditNoteLink(removeCreditNoteLinkButton.dataset.removeCreditNoteLink);
    const stockEffectButton = event.target.closest("[data-open-stock-effect]");
    if (stockEffectButton) openStockEffectModal(stockEffectButton.dataset.openStockEffect);
  });
  els.candidatesList?.addEventListener("change", (event) => {
    const input = event.target.closest("[data-candidate-id]");
    if (!input) return;
    if (input.checked) state.selectedPurchaseIds.add(input.dataset.candidateId);
    else state.selectedPurchaseIds.delete(input.dataset.candidateId);
    renderCandidates(false);
  });
  els.creditNoteCandidatesList?.addEventListener("change", (event) => {
    const input = event.target.closest("[data-expected-credit-note-id]");
    if (!input) return;
    if (input.checked) state.selectedExpectedCreditNoteIds.add(input.dataset.expectedCreditNoteId);
    else state.selectedExpectedCreditNoteIds.delete(input.dataset.expectedCreditNoteId);
    renderCreditNoteMatching(state.detail?.document || {}, false);
  });
}

async function init() {
  els.userName.textContent = sessionUser.email || sessionUser.name || "Utilisateur";
  bindEvents();
  await loadDocuments({ keepSelection: false });
}

init().catch((error) => showFeedback(errorMessage(error), "error"));
