(() => {
  if (!window || !document || !els?.body) {
    console.log('NEGOCE SAVE HELPER NOT INSTALLED', {
      hasWindow: typeof window !== 'undefined',
      hasDocument: typeof document !== 'undefined',
      hasEls: typeof els !== 'undefined',
      hasBody: typeof els !== 'undefined' && !!els?.body,
    });
    return;
  }

  console.log('NEGOCE SAVE HELPER LOADED', { version: 5, script: 'sale-detail-negoce-save.js' });

  const normalizeKind = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const documentIdFromUrl = () => new URLSearchParams(window.location.search).get('id');

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
        if (Array.isArray(data?.lines)) {
          window.currentSaleLines = data.lines;
        }
        return loaded;
      }
    } catch (err) {
      console.log('NEGOCE SAVE DOCUMENT LOAD ERROR', { reason, id, error: err.message });
    }

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
      || normalizeKind(document?.status) === 'delivery_note';
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

  function saleDiagnostic() {
    const document = getCurrentSaleDocument();
    return {
      sale_id: document?.id || documentIdFromUrl(),
      sale_status: document?.status,
      sale_document_type: document?.document_type,
      sale_origin: document?.origin,
      sale_source_type: document?.source_type,
      sale_invoice_id: document?.invoice_id,
      sale_invoice_reference: document?.invoice_reference,
      sale_source_invoice_id: document?.source_invoice_id,
      sale_invoiced_at: document?.invoiced_at,
      source: window.currentSaleDocumentSource || (document ? 'lexical-or-window' : 'missing'),
      is_negoce: isNegoce(),
      is_delivery_note: isDeliveryNote(),
      is_factured: isFactured(),
      editable: editable(),
    };
  }

  async function saveNegoceLine(lineId) {
    console.log('NEGOCE SAVE CLICK DETECTED', {
      ...saleDiagnostic(),
      line_id: lineId,
    });

    await ensureSaleDocument('click');
    clear(els.lf);
    const document = getCurrentSaleDocument();

    if (!document?.id) {
      console.log('NEGOCE SAVE HANDLER HIT', {
        ...saleDiagnostic(),
        line_id: lineId,
        blocked_reason: 'missing_sale_document',
      });
      fb(els.lf, 'Document BL négoce non chargé, recharge la page puis réessaie.', true);
      return false;
    }

    await ensureHeader();
    await ensureSaleDocument('after-ensure-header');
    const row = els.body.querySelector(`tr[data-line-id="${lineId}"]`);
    if (!row) {
      console.log('NEGOCE SAVE HANDLER HIT', { ...saleDiagnostic(), line_id: lineId, row_found: false });
      return false;
    }

    window.clearTimeout(pluSearchTimers.get(lineId));
    if (!row.dataset.articleId) await searchNegocePlu(row, { applyFirst: true });

    const line = currentLine(lineId);
    const pluInput = row.querySelector('.line-plu');
    const articleId = clean(row.dataset.articleId || pluInput?.dataset.articleId || line?.article_id);
    const label = clean(row.querySelector('.line-article-label')?.value || line?.article_label);
    if (!label) {
      console.log('NEGOCE SAVE HANDLER HIT', {
        ...saleDiagnostic(),
        line_id: lineId,
        article_id: articleId || null,
        blocked_reason: 'missing_label',
      });
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
    const url = `/api/sales/lines/${lineId}`;

    console.log('NEGOCE SAVE HANDLER HIT', {
      ...saleDiagnostic(),
      line_id: lineId,
      article_id: articleId || null,
      payload,
      url,
    });

    await api(url, { method: 'PATCH', body: JSON.stringify(payload) });
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

    console.log('NEGOCE SAVE CLICK DETECTED', {
      ...saleDiagnostic(),
      line_id: button.dataset.id,
      phase: 'capture',
    });

    await ensureSaleDocument('click-capture');
    if (!isNegoce()) {
      console.log('NEGOCE SAVE HANDLER SKIPPED', { ...saleDiagnostic(), line_id: button.dataset.id, reason: 'not_negoce' });
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      await saveNegoceLine(button.dataset.id);
    } catch (err) {
      console.log('NEGOCE SAVE HANDLER ERROR', { ...saleDiagnostic(), line_id: button.dataset.id, error: err.message });
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
      console.log('NEGOCE SAVE HANDLER ERROR', { ...saleDiagnostic(), line_id: row.dataset.lineId, error: err.message });
      fb(els.lf, err.message || 'Erreur enregistrement ligne négoce', true);
    }
  }, true);

  window.setTimeout(async () => {
    await ensureSaleDocument('initial-snapshot');
    console.log('NEGOCE SAVE HELPER SALE SNAPSHOT', saleDiagnostic());
  }, 0);
})();
