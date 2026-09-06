(() => {
  const token = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
  const API_BASE = window.APP_CONFIG?.API_BASE_URL;
  const saleId = new URLSearchParams(window.location.search).get('id');
  if (!token || !API_BASE || !saleId) return;

  const feedbackEl = document.getElementById('sale-lines-feedback');
  const lineBody = document.getElementById('sale-lines-table-body');
  const lotModal = document.getElementById('lot-modal');
  const lotBody = document.getElementById('lot-modal-table-body');
  const validateButtons = [
    document.getElementById('validate-bl-btn'),
    document.getElementById('validate-bl-flow-btn'),
  ].filter(Boolean);

  let saleSnapshot = null;
  let lotItems = [];
  const lotAutosavingLineIds = new Set();

  function number(value, fallback = 0) {
    const parsed = Number(String(value ?? '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function qty(value) {
    return number(value).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }

  function formatDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('fr-FR');
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    }[char]));
  }

  function feedback(message, isError = false) {
    if (!feedbackEl) return;
    feedbackEl.textContent = message;
    feedbackEl.classList.remove('hidden');
    feedbackEl.classList.toggle('error', isError);
    feedbackEl.classList.toggle('success', !isError);
  }

  async function request(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.message || data.error || 'Erreur API');
      error.status = response.status;
      error.code = data.code;
      error.details = data.details || {};
      error.payload = data;
      throw error;
    }
    return data;
  }

  async function requestWithStockConfirmation(path, payload = {}) {
    console.info('Validation BL payload envoyé', { path, payload });
    try {
      return await request(path, { method: 'POST', body: JSON.stringify(payload) });
    } catch (error) {
      if (error.status !== 409 || error.code !== 'STOCK_INSUFFICIENT') throw error;
      const missing = error.details?.missing_quantity ? `\nManque : ${qty(error.details.missing_quantity)}` : '';
      const confirmed = window.confirm(`Stock insuffisant. Voulez-vous valider quand même en sortie forcée ?${missing}`);
      if (!confirmed) throw error;
      const forcedPayload = { ...payload, allow_negative_stock: true };
      console.info('Validation BL payload envoyé après confirmation', { path, payload: forcedPayload });
      return request(path, {
        method: 'POST',
        body: JSON.stringify(forcedPayload),
      });
    }
  }

  async function getJson(path) {
    return request(path, { method: 'GET' });
  }

  function normalizeArticle(item) {
    return {
      ...item,
      article_id: item.article_id || item.id,
      plu: item.plu || item.code || '',
      designation: item.designation || item.display_name || '',
      sale_price_level_1_ht: item.sale_price_level_1_ht ?? item.sale_price_ex_vat ?? 0,
      sale_price_level_2_ht: item.sale_price_level_2_ht ?? 0,
      sale_price_level_3_ht: item.sale_price_level_3_ht ?? 0,
      stock_quantity: item.stock_quantity ?? 0,
      pma: item.pma ?? item.unit_cost_ex_vat ?? 0,
      sale_unit: item.sale_unit || item.unit || 'kg',
    };
  }

  async function findArticleForSale(search) {
    const query = encodeURIComponent(search || '');
    const articleRows = await getJson(`/api/articles/search?q=${query}&article_category=product`).catch(() => []);
    const articleItems = (Array.isArray(articleRows) ? articleRows : []).map(normalizeArticle);
    const articleMatch = articleItems.find((item) => String(item.plu) === String(search)) || articleItems[0];
    if (articleMatch) return articleMatch;

    const stockRows = await getJson(`/api/stock?search=${query}&available_only=false&limit=20`).catch(() => []);
    const stockItems = (Array.isArray(stockRows) ? stockRows : []).map(normalizeArticle);
    return stockItems.find((item) => String(item.plu) === String(search)) || stockItems[0] || null;
  }

  async function refreshSaleSnapshot() {
    const data = await request(`/api/sales/${encodeURIComponent(saleId)}`);
    saleSnapshot = data.sale || null;
    return saleSnapshot;
  }

  async function validateDeliveryNote(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const button = event.currentTarget;
    await refreshSaleSnapshot();
    if (!saleSnapshot || saleSnapshot.document_type !== 'ORDER' || saleSnapshot.status !== 'draft') return;
    if (!window.confirm('Valider en BL ? Cette action génère le BL et déstocke les lots disponibles.')) return;

    button.disabled = true;
    try {
      const data = await requestWithStockConfirmation(`/api/sales/${encodeURIComponent(saleSnapshot.id)}/validate-delivery-note`, {});
      feedback(data.forced_stock_exit ? 'Commande validée en BL avec sortie forcée tracée' : 'Commande validée en BL');
      const nextId = data.delivery_note_id || data.id;
      if (nextId) window.location.href = `./sale-detail.html?id=${encodeURIComponent(nextId)}`;
      else window.location.reload();
    } catch (error) {
      feedback(error.message || 'Erreur validation en BL', true);
      button.disabled = false;
    }
  }

  function enableLotButtons() {
    lineBody?.querySelectorAll('tr[data-line-id]').forEach((row) => {
      const button = row.querySelector('[data-action="choose-lot"]');
      if (!button || !row.dataset.articleId) return;
      button.disabled = false;
      if (button.textContent.trim() === 'Négoce') button.textContent = 'Lot';
    });
  }

  function traceText(lot) {
    return [
      lot.lot_code || lot.supplier_lot_number,
      lot.latin_name,
      lot.fao_zone,
      lot.sous_zone,
      lot.fishing_gear,
      lot.production_method,
      lot.allergens,
    ].filter(Boolean).join(' | ') || '-';
  }

  function lineQuantity(row) {
    const totalWeight = number(row?.querySelector('.line-total-weight')?.value);
    if (totalWeight > 0) return totalWeight;
    return number(row?.querySelector('.line-package-count')?.value) * number(row?.querySelector('.line-weight-per-package')?.value);
  }

  function lineReadyForAutosave(row) {
    if (!row) return false;
    const clientId = document.getElementById('sale-client-id')?.value;
    if (!clientId) return false;
    if (!row.dataset.articleId) return false;
    if (lineQuantity(row) <= 0) return false;
    if (number(row.querySelector('.line-unit-price-ht')?.value) <= 0) return false;
    return true;
  }

  function focusAfterLotSave(lineId, nextLineId = null) {
    const nextRow = nextLineId ? lineBody?.querySelector(`tr[data-line-id="${CSS.escape(String(nextLineId))}"]`) : null;
    const currentRow = lineBody?.querySelector(`tr[data-line-id="${CSS.escape(String(lineId))}"]`);
    const target = nextRow?.querySelector('.line-plu:not([disabled])')
      || currentRow?.querySelector('.line-package-count:not([disabled])')
      || currentRow?.querySelector('[data-action="save-line"]:not([disabled])');
    target?.focus();
  }

  async function autosaveLotSelection(lineId) {
    const row = lineBody?.querySelector(`tr[data-line-id="${CSS.escape(String(lineId))}"]`);
    if (!row) return;
    if (!lineReadyForAutosave(row)) {
      feedback("Lot sélectionné. Complétez la ligne pour l'enregistrer.");
      focusAfterLotSave(lineId);
      return;
    }
    if (lotAutosavingLineIds.has(lineId)) return;
    const rowIds = [...lineBody.querySelectorAll('tr[data-line-id]')].map((item) => item.dataset.lineId);
    const nextLineId = rowIds[rowIds.indexOf(String(lineId)) + 1] || null;
    const lotButton = row.querySelector('[data-action="choose-lot"]');
    lotAutosavingLineIds.add(lineId);
    if (lotButton) lotButton.disabled = true;
    try {
      if (typeof saveLine === 'function') await saveLine(lineId, { focusLineId: lineId, focusNextLineId: nextLineId });
      else feedback('Lot sélectionné. Cliquez sur OK pour enregistrer.');
    } catch (error) {
      feedback(error.message || 'Erreur sauvegarde lot', true);
    } finally {
      lotAutosavingLineIds.delete(lineId);
    }
  }

  async function openLotChooser(lineId) {
    const row = lineBody?.querySelector(`tr[data-line-id="${CSS.escape(String(lineId))}"]`);
    const articleId = row?.dataset.articleId;
    if (!row || !articleId) return;
    lotItems = await request(`/api/stock/lots?article_id=${encodeURIComponent(articleId)}&available_only=true&limit=200`);
    lotBody.innerHTML = lotItems.map((lot) => `<tr data-lot-id="${escapeHtml(lot.id)}">
      <td>${escapeHtml(lot.lot_code || '')}</td>
      <td>${escapeHtml(lot.supplier_lot_number || '')}</td>
      <td>${qty(lot.qty_remaining)}</td>
      <td>${formatDate(lot.dlc)}</td>
      <td>${escapeHtml(lot.latin_name || '')}</td>
      <td>${escapeHtml(lot.fao_zone || '')}</td>
      <td>${escapeHtml(lot.sous_zone || '')}</td>
      <td>${escapeHtml(lot.fishing_gear || '')}</td>
      <td>${escapeHtml(lot.production_method || '')}</td>
      <td>${escapeHtml(lot.allergens || '')}</td>
    </tr>`).join('') || '<tr><td colspan="10">Aucun lot disponible.</td></tr>';
    lotModal?.classList.remove('hidden');
  }

  async function applySelectedLot(lot) {
    const lineId = String(window.__saleStockNegativeLineId || '');
    if (lotAutosavingLineIds.has(lineId)) return;
    const row = lineBody?.querySelector(`tr[data-line-id="${CSS.escape(lineId)}"]`);
    if (!row || !lot) return;
    row.dataset.selectedLotId = lot.id;
    const button = row.querySelector('[data-action="choose-lot"]');
    if (button) button.textContent = lot.lot_code || lot.supplier_lot_number || 'Lot';
    const traceCell = row.querySelector('.trace-cell');
    if (traceCell) {
      traceCell.textContent = traceText(lot);
      traceCell.title = traceText(lot);
    }
    lotModal?.classList.add('hidden');
    await autosaveLotSelection(lineId);
  }

  if (typeof isNegoce !== 'undefined') {
    isNegoce = function patchedIsNegoce() { return false; };
  }

  if (typeof api !== 'undefined') {
    api = async function patchedApi(path, options = {}) {
      try {
        return await request(path, options);
      } catch (error) {
        const method = String(options.method || 'GET').toUpperCase();
        if (method === 'GET' || error.status !== 409 || error.code !== 'STOCK_INSUFFICIENT') throw error;
        const confirmed = window.confirm('Stock insuffisant. Voulez-vous valider quand même en sortie forcée ?');
        if (!confirmed) throw error;
        const body = options.body ? JSON.parse(options.body) : {};
        const forcedBody = { ...body, allow_negative_stock: true };
        console.info('Validation BL payload envoyé après confirmation', { path, payload: forcedBody });
        return request(path, { ...options, body: JSON.stringify(forcedBody) });
      }
    };
  }

  if (typeof resolvePlu !== 'undefined') {
    resolvePlu = async function patchedResolvePlu(row) {
      const plu = clean(row.querySelector('.line-plu')?.value);
      if (!plu || row.dataset.articleId) return;
      const item = await findArticleForSale(plu);
      if (!item) throw new Error(`Article introuvable pour le PLU ${plu}`);
      editingLineId = row.dataset.lineId;
      applyArticle(item);
    };
  }

  if (typeof searchNegocePlu !== 'undefined') {
    searchNegocePlu = async function patchedSearchNegocePlu(row, { applyFirst = false } = {}) {
      const plu = clean(row.querySelector('.line-plu')?.value);
      if (!plu) return;
      const item = await findArticleForSale(plu);
      if (!item || (!applyFirst && String(item.plu) !== plu)) return;
      editingLineId = row.dataset.lineId;
      applyArticle(item);
    };
  }

  if (typeof applyArticle !== 'undefined') {
    const originalApplyArticle = applyArticle;
    applyArticle = function patchedApplyArticle(item) {
      originalApplyArticle(item);
      const row = lineBody?.querySelector(`tr[data-line-id="${CSS.escape(String(editingLineId || ''))}"]`);
      const button = row?.querySelector('[data-action="choose-lot"]');
      if (row && item?.article_id) row.dataset.articleId = item.article_id;
      if (button && row?.dataset.articleId) button.disabled = false;
    };
  }

  if (typeof openLots !== 'undefined') {
    openLots = async function patchedOpenLots(lineId) {
      editingLineId = lineId;
      window.__saleStockNegativeLineId = lineId;
      await openLotChooser(lineId);
    };
  }

  validateButtons.forEach((button) => {
    button.addEventListener('click', validateDeliveryNote, true);
  });

  lineBody?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action="choose-lot"]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.__saleStockNegativeLineId = button.dataset.id;
    openLotChooser(button.dataset.id).catch((error) => feedback(error.message || 'Erreur chargement lots', true));
  }, true);

  lotBody?.addEventListener('click', (event) => {
    const row = event.target.closest('tr[data-lot-id]');
    const lot = lotItems.find((item) => String(item.id) === String(row?.dataset.lotId));
    if (lot) applySelectedLot(lot);
  }, true);

  lotBody?.addEventListener('dblclick', (event) => {
    const row = event.target.closest('tr[data-lot-id]');
    const lot = lotItems.find((item) => String(item.id) === String(row?.dataset.lotId));
    if (lot) applySelectedLot(lot);
  }, true);

  const observer = new MutationObserver(() => enableLotButtons());
  if (lineBody) observer.observe(lineBody, { childList: true, subtree: true });
  refreshSaleSnapshot().then(enableLotButtons).catch(() => null);
})();
