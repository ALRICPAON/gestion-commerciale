(() => {
  const originalFetch = window.fetch.bind(window);

  function normalizeSaleUnit(value) {
    if (value === undefined || value === null || value === '') return value;
    const raw = String(value).trim().toLowerCase();
    const compact = raw
      .replace(/€/g, '')
      .replace(/eur/g, '')
      .replace(/euro/g, '')
      .replace(/par/g, '')
      .replace(/[\s/_-]+/g, '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    if (['kg', 'kilo', 'kilogramme', 'kilogrammes'].includes(compact)) return 'kg';
    if (['piece', 'pieces', 'pc', 'pcs', 'unite', 'unites'].includes(compact)) return 'piece';
    if (['colis', 'carton'].includes(compact)) return 'colis';
    if (['caisse', 'caisses'].includes(compact)) return 'caisse';
    if (['barquette', 'barquettes'].includes(compact)) return 'barquette';
    if (['sachet', 'sachets'].includes(compact)) return 'sachet';

    return raw.includes('kg') ? 'kg' : value;
  }

  window.fetch = (resource, options = {}) => {
    const url = typeof resource === 'string' ? resource : resource?.url || '';
    const isSalesLineWrite = /\/api\/sales\/lines\//.test(url)
      && ['PATCH', 'POST', 'PUT'].includes(String(options.method || 'GET').toUpperCase());

    if (isSalesLineWrite && typeof options.body === 'string') {
      try {
        const payload = JSON.parse(options.body);
        if (Object.prototype.hasOwnProperty.call(payload, 'sale_unit')) {
          payload.sale_unit = normalizeSaleUnit(payload.sale_unit);
          options = { ...options, body: JSON.stringify(payload) };
        }
      } catch (_) {
        // Non JSON body: leave it untouched.
      }
    }

    return originalFetch(resource, options);
  };
})();
