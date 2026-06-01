(() => {
  if (!window || !document || !els?.body) return;

  const originalApplyArticle = applyArticle;
  applyArticle = function patchedApplyArticle(item) {
    originalApplyArticle(item);
    const row = els.body.querySelector(`tr[data-line-id="${editingLineId}"]`);
    const articleId = clean(item?.article_id || item?.id);
    if (!row || !articleId) return;
    row.dataset.articleId = articleId;
    row.querySelector('.line-plu').dataset.articleId = articleId;
  };

  async function saveNegoceLine(lineId) {
    clear(els.lf);
    await ensureHeader();
    const row = els.body.querySelector(`tr[data-line-id="${lineId}"]`);
    if (!row) return false;

    window.clearTimeout(pluSearchTimers.get(lineId));
    if (!row.dataset.articleId) await searchNegocePlu(row, { applyFirst: true });

    const pluInput = row.querySelector('.line-plu');
    const articleId = clean(row.dataset.articleId || pluInput?.dataset.articleId);
    if (!articleId) {
      fb(els.lf, 'Sélectionne un article référencé', true);
      return false;
    }

    const label = clean(row.querySelector('.line-article-label')?.value);
    if (!label) {
      fb(els.lf, 'Saisis la désignation du produit négoce', true);
      return false;
    }

    const totalWeight = n(row.querySelector('.line-total-weight')?.value);
    const payload = {
      article_id: articleId,
      article_plu: clean(pluInput?.value),
      article_label: label,
      selected_lot_id: row.dataset.selectedLotId || null,
      package_count: n(row.querySelector('.line-package-count')?.value),
      weight_per_package: n(row.querySelector('.line-weight-per-package')?.value),
      total_weight: totalWeight,
      sold_quantity: totalWeight,
      sale_unit: row.dataset.saleUnit || 'kg',
      unit_sale_price_ht: n(row.querySelector('.line-unit-price-ht')?.value),
      vat_rate: n(row.querySelector('.line-vat-rate')?.value, vatRate()),
    };

    await api(`/api/sales/lines/${lineId}`, { method: 'PATCH', body: JSON.stringify(payload) });
    fb(els.lf, 'Ligne enregistrée');
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
})();
