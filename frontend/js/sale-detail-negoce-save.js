(() => {
  if (!window || !document || typeof els === 'undefined' || !els?.body) return;

  const normalizeKind = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const documentIdFromUrl = () => new URLSearchParams(window.location.search).get('id');

  function apiOptionsWithForcedStock(options = {}) {
    const next = { ...options };
    const body = next.body ? JSON.parse(next.body) : {};
    next.body = JSON.stringify({ ...body, allow_negative_stock: true, force_stock_exit: true });
    return next;
  }

  api = async function patchedApi(path, options = {}) {
    const call = async (nextOptions) => {
      const response = await fetch(`${API_BASE}${path}`, {
        ...nextOptions,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(nextOptions.headers || {}),
        },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(data.message || data.error || 'Erreur API');
        error.code = data.code;
        error.details = data.details;
        error.status = response.status;
        throw error;
      }
      return data;
    };

    try {
      return await call(options);
    } catch (error) {
      const method = String(options.method || 'GET').toUpperCase();
      if (error.code !== 'STOCK_INSUFFICIENT' || method === 'GET') throw error;
      const confirmed = window.confirm('Stock insuffisant. Voulez-vous forcer la sortie stock ?');
      if (!confirmed) throw error;
      return call(apiOptionsWithForcedStock(options));
    }
  };

  function lexicalSale() {
    try {
      if (typeof sale !== 'undefined') return sale;
    } catch (_) {}
    return null;
  }

  function exposeSaleDocument(document, source = 'unknown') {
    if (!document) return null;
    window.currentSaleDocument = document;
    window.currentSaleDocumentSource = source;
    return document;
  }

  function getCurrentSaleDocument() {
    return window.currentSaleDocument || lexicalSale() || null;
  }

  function isNegoceDeliveryNoteShape(document) {
    return normalizeKind(document?.origin || document?.source_type) === 'negoce'
      && ['delivered', 'delivery_note', 'validated'].includes(normalizeKind(document?.status));
  }

  async function ensureSaleDocument(reason = 'unknown') {
    const current = getCurrentSaleDocument();
    if (current?.id) return current;

    const id = documentIdFromUrl();
    if (!id) return current;

    try {
      const data = await api(`/api/sales/${encodeURIComponent(id)}`);
      const loaded = data?.sale || data?.document || data;
      if (loaded?.id) {
        exposeSaleDocument(loaded, `api:${reason}`);
        if (Array.isArray(data?.lines)) window.currentSaleLines = data.lines;
        return loaded;
      }
    } catch (_) {}

    return getCurrentSaleDocument();
  }

  isNegoce = function patchedIsNegoce() {
    const document = getCurrentSaleDocument();
    return normalizeKind(document?.origin || document?.source_type) === 'negoce';
  };

  isFactured = function patchedIsFactured() {
    const document = getCurrentSaleDocument();
    return normalizeKind(document?.status) === 'invoiced'
      || !!document?.invoice_id
      || !!document?.invoice_reference
      || !!document?.source_invoice_id
      || !!document?.invoiced_at;
  };

  isDeliveryNote = function patchedIsDeliveryNote() {
    const document = getCurrentSaleDocument();
    return normalizeKind(document?.document_type) === 'delivery_note'
      || normalizeKind(document?.status) === 'delivery_note'
      || isNegoceDeliveryNoteShape(document);
  };

  editable = function patchedEditable() {
    const document = getCurrentSaleDocument();
    if (isDeliveryNote()) return !isFactured();
    if (normalizeKind(document?.document_type) === 'order') return normalizeKind(document?.status) === 'draft';
    return false;
  };

  const originalApplyArticle = applyArticle;
  applyArticle = function patchedApplyArticle(item) {
    originalApplyArticle(item);
    const row = els.body.querySelector(`tr[data-line-id="${editingLineId}"]`);
    const articleId = clean(item?.article_id || item?.id);
    if (!row || !articleId) return;
    row.dataset.articleId = articleId;
    row.querySelector('.line-plu').dataset.articleId = articleId;
  };

  function currentLine(lineId) {
    const knownLines = Array.isArray(window.currentSaleLines) ? window.currentSaleLines : (Array.isArray(lines) ? lines : []);
    return knownLines.find((line) => String(line.id) === String(lineId)) || null;
  }

  async function saveNegoceLine(lineId) {
    await ensureSaleDocument('click');
    clear(els.lf);
    const document = getCurrentSaleDocument();

    if (!document?.id) {
      fb(els.lf, 'Document BL négoce non chargé, recharge la page puis réessaie.', true);
      return false;
    }

    await ensureHeader();
    await ensureSaleDocument('after-ensure-header');
    const row = els.body.querySelector(`tr[data-line-id="${lineId}"]`);
    if (!row) return false;

    window.clearTimeout(pluSearchTimers.get(lineId));
    if (!row.dataset.articleId) await searchNegocePlu(row, { applyFirst: true });

    const line = currentLine(lineId);
    const pluInput = row.querySelector('.line-plu');
    const articleId = clean(row.dataset.articleId || pluInput?.dataset.articleId || line?.article_id);
    const label = clean(row.querySelector('.line-article-label')?.value || line?.article_label);
    if (!label) {
      fb(els.lf, 'Saisis la désignation du produit négoce', true);
      return false;
    }

    const totalWeight = n(row.querySelector('.line-total-weight')?.value);
    const payload = {
      article_id: articleId || null,
      article_plu: clean(pluInput?.value || line?.article_plu),
      article_label: label,
      selected_lot_id: row.dataset.selectedLotId || line?.selected_lot_id || null,
      package_count: n(row.querySelector('.line-package-count')?.value),
      weight_per_package: n(row.querySelector('.line-weight-per-package')?.value),
      total_weight: totalWeight,
      sold_quantity: totalWeight,
      sale_unit: row.dataset.saleUnit || line?.sale_unit || 'kg',
      unit_sale_price_ht: n(row.querySelector('.line-unit-price-ht')?.value),
      vat_rate: n(row.querySelector('.line-vat-rate')?.value, vatRate()),
    };

    await api(`/api/sales/lines/${lineId}`, { method: 'PATCH', body: JSON.stringify(payload) });
    fb(els.lf, isDeliveryNote() && normalizeKind(getCurrentSaleDocument()?.status) !== 'draft' ? 'Ligne enregistrée et stock réajusté' : 'Ligne enregistrée');
    await loadSale();
    const refreshed = lexicalSale();
    if (refreshed?.id) exposeSaleDocument(refreshed, 'loadSale-after-save');
    return true;
  }

  const originalSaveLine = saveLine;
  saveLine = async function patchedSaveLine(lineId) {
    await ensureSaleDocument('saveLine');
    if (!isNegoce()) return originalSaveLine(lineId);
    return saveNegoceLine(lineId);
  };

  els.body.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action="save-line"]');
    if (!button) return;

    await ensureSaleDocument('click-capture');
    if (!isNegoce()) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      await saveNegoceLine(button.dataset.id);
    } catch (err) {
      fb(els.lf, err.message || 'Erreur enregistrement ligne négoce', true);
    }
  }, true);

  els.body.addEventListener('keydown', async (event) => {
    const row = event.target.closest('tr[data-line-id]');
    if (!row || event.key !== 'Enter' || !event.target.classList.contains('line-input')) return;

    await ensureSaleDocument('keydown');
    if (!isNegoce()) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      const saved = await saveNegoceLine(row.dataset.lineId);
      if (saved) await addLine();
    } catch (err) {
      fb(els.lf, err.message || 'Erreur enregistrement ligne négoce', true);
    }
  }, true);

  window.setTimeout(() => ensureSaleDocument('initial-snapshot'), 0);
})();