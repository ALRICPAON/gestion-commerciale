(() => {
  const token = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
  const API_BASE = window.APP_CONFIG?.API_BASE_URL;
  if (!token || !API_BASE) return;

  const toggleId = 'stock-article-available-only-toggle';
  const searchInput = document.getElementById('stock-article-search-input');
  const stockBody = document.getElementById('stock-article-modal-table-body');
  const stockHead = document.getElementById('stock-article-modal-table-head');
  const stockTitle = document.getElementById('stock-article-modal-title');
  const stockSubtitle = document.getElementById('stock-article-modal-subtitle');
  const feedbackEl = document.getElementById('sale-lines-feedback');

  function number(value, fallback = 0) {
    const parsed = Number(String(value ?? '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function formatQty(value) {
    return number(value).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }

  function formatMoney(value) {
    return number(value).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatDate(value) {
    if (!value) return '-';
    try { return new Date(value).toLocaleDateString('fr-FR'); } catch { return '-'; }
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

  function cleanText(value) {
    if (typeof clean === 'function') return clean(value);
    return String(value ?? '').trim();
  }

  function showError(error) {
    if (typeof fb === 'function') return fb(feedbackEl, error.message || 'Erreur recherche article', true);
    if (feedbackEl) feedbackEl.textContent = error.message || 'Erreur recherche article';
  }

  async function getJson(path) {
    if (typeof api === 'function') return api(path);
    const response = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Erreur API');
    return data;
  }

  function normalize(item) {
    const base = typeof normalizeArticle === 'function' ? normalizeArticle(item) : item;
    return {
      ...base,
      article_id: base.article_id || base.id,
      plu: base.plu || base.code || '',
      designation: base.designation || base.display_name || '',
      stock_quantity: number(base.stock_quantity, 0),
      lot_code: base.lot_code || base.next_lot_code || '',
      supplier_lot_number: base.supplier_lot_number || base.next_supplier_lot_number || '',
      next_dlc: base.next_dlc || base.next_lot_dlc || null,
      sale_unit: base.sale_unit || base.unit || 'kg',
    };
  }

  function stockOnlyEnabled() {
    const toggle = document.getElementById(toggleId);
    return toggle ? toggle.checked : true;
  }

  function installToggle() {
    if (!searchInput || document.getElementById(toggleId)) return;
    const wrapper = document.createElement('label');
    wrapper.className = 'helper-text';
    wrapper.style.display = 'inline-flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.gap = '8px';
    wrapper.style.marginTop = '8px';
    wrapper.innerHTML = `<input type="checkbox" id="${toggleId}" checked> Articles en stock uniquement`;
    searchInput.closest('.form-group')?.appendChild(wrapper);
    wrapper.querySelector('input')?.addEventListener('change', () => {
      if (typeof stockSearch === 'function') {
        stockSearch(cleanText(searchInput.value)).catch(showError);
      }
    });
  }

  async function fetchStockRows(search, availableOnly) {
    const params = new URLSearchParams({ limit: '1000', available_only: availableOnly ? 'true' : 'false' });
    if (search) params.set('search', search);
    const rows = await getJson(`/api/stock?${params.toString()}`).catch(() => []);
    return Array.isArray(rows) ? rows.map(normalize) : [];
  }

  async function fetchArticleRows(search) {
    if (search) {
      const rows = await getJson(`/api/articles/search?q=${encodeURIComponent(search)}`).catch(() => []);
      return Array.isArray(rows) ? rows.map(normalize) : [];
    }
    const rows = await getJson('/api/articles?active=true&limit=200').catch(() => []);
    return Array.isArray(rows) ? rows.map(normalize) : [];
  }

  async function fetchAllActiveWithStock(search) {
    const [articles, stockRows] = await Promise.all([
      fetchArticleRows(search),
      fetchStockRows(search, false),
    ]);
    const stockByArticle = new Map(stockRows.map((item) => [String(item.article_id), item]));
    return articles.map((article) => ({ ...article, ...(stockByArticle.get(String(article.article_id)) || {}) }));
  }

  function renderSaleArticleSearchTable() {
    installToggle();
    const onlyStock = stockOnlyEnabled();
    if (stockTitle) stockTitle.textContent = 'Rechercher un article';
    if (stockSubtitle) {
      stockSubtitle.textContent = onlyStock
        ? 'Articles avec stock positif, double clic pour choisir'
        : 'Tous les articles actifs, y compris hors stock';
    }
    if (stockHead) {
      stockHead.innerHTML = '<tr><th>PLU</th><th>Désignation</th><th>Stock</th><th>Statut</th><th>Lot FIFO</th><th>DLC FIFO</th><th>Tarif client</th><th>Tarif 1</th></tr>';
    }
    if (!stockBody) return;
    const rows = Array.isArray(stockItems) ? stockItems : [];
    stockBody.innerHTML = rows.map((article) => {
      const hasStock = number(article.stock_quantity) > 0;
      return `<tr data-article-id="${escapeHtml(article.article_id)}">
        <td>${escapeHtml(article.plu)}</td>
        <td>${escapeHtml(article.designation)}</td>
        <td>${hasStock ? formatQty(article.stock_quantity) : '0,000'}</td>
        <td>${hasStock ? 'En stock' : 'Hors stock'}</td>
        <td>${escapeHtml(article.lot_code || article.supplier_lot_number || '-')}</td>
        <td>${formatDate(article.next_dlc || article.next_lot_dlc)}</td>
        <td>${typeof priceFor === 'function' ? formatMoney(priceFor(article)) : formatMoney(article.sale_price_ex_vat)}</td>
        <td>${formatMoney(article.sale_price_level_1_ht ?? article.sale_price_ex_vat)}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="8">Aucun article.</td></tr>';
  }

  if (typeof renderStockSearchTable !== 'undefined') {
    renderStockSearchTable = renderSaleArticleSearchTable;
  }

  if (typeof stockSearch !== 'undefined') {
    stockSearch = async function patchedStockSearch(search = '') {
      installToggle();
      const term = cleanText(search);
      stockItems = stockOnlyEnabled()
        ? await fetchStockRows(term, true)
        : await fetchAllActiveWithStock(term);
      renderSaleArticleSearchTable();
    };
  }

  if (typeof resolvePlu !== 'undefined') {
    resolvePlu = async function patchedResolvePlu(row) {
      const plu = cleanText(row.querySelector('.line-plu')?.value);
      if (!plu || row.dataset.articleId) return;
      const items = await fetchArticleRows(plu);
      const item = items.find((article) => String(article.plu) === plu) || items[0];
      if (!item) throw new Error(`Article introuvable pour le PLU ${plu}`);
      editingLineId = row.dataset.lineId;
      applyArticle(item);
    };
  }

  installToggle();
}());
