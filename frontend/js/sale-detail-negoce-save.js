(() => {
  if (!window || !document || !els?.body) return;

  const normalizeKind = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  isNegoce = function patchedIsNegoce() {
    return normalizeKind(sale?.origin) === 'negoce';
  };

  isFactured = function patchedIsFactured() {
    return normalizeKind(sale?.status) === 'invoiced'
      || !!sale?.invoice_id
      || !!sale?.invoice_reference
      || !!sale?.source_invoice_id
      || !!sale?.invoiced_at;
  };

  isDeliveryNote = function patchedIsDeliveryNote() {
    return normalizeKind(sale?.document_type) === 'delivery_note'
      || normalizeKind(sale?.status) === 'delivery_note';
  };

  editable = function patchedEditable() {
    if (isDeliveryNote()) return !isFactured();
    if (normalizeKind(sale?.document_type) === 'order') return normalizeKind(sale?.status) === 'draft';
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
    return (Array.isArray(lines) ? lines : []).find((line) => String(line.id) === String(lineId)) || null;
  }

  async function saveNegoceLine(lineId) {
    clear(els.lf);
    await ensureHeader();
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
    fb(els.lf, isDeliveryNote() && normalizeKind(sale?.status) !== 'draft' ? 'Ligne enregistrée et stock réajusté' : 'Ligne enregistrée');
    await loadSale();
    return true;
  }

  const originalSaveLine = saveLine;
  saveLine = async function patchedSaveLine(lineId) {
    if (!isNegoce()) return originalSaveLine(lineId);
    return saveNegoceLine(lineId);
  };

  els.body.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action="save-line"]');
    if (!button || !isNegoce()) return;
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
    if (!row || !isNegoce() || event.key !== 'Enter' || !event.target.classList.contains('line-input')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      const saved = await saveNegoceLine(row.dataset.lineId);
      if (saved) await addLine();
    } catch (err) {
      fb(els.lf, err.message || 'Erreur enregistrement ligne négoce', true);
    }
  }, true);

  window.setTimeout(() => {
    if (sale && isDeliveryNote()) loadSale().catch((err) => fb(els.lf, err.message || 'Erreur rechargement BL négoce', true));
  }, 0);
})();
