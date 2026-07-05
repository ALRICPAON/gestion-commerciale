(function () {
  const API_BASE_URL = window.APP_CONFIG?.API_BASE_URL || '';

  function authToken() {
    return localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
  }

  function headers() {
    return { Authorization: `Bearer ${authToken()}`, 'Content-Type': 'application/json' };
  }

  function queryString(filters = {}) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.set(key, value);
    });
    const query = params.toString();
    return query ? `?${query}` : '';
  }

  async function request(path, options = {}) {
    const response = await fetch(`${API_BASE_URL}/api/quality/temperatures${path}`, {
      ...options,
      headers: { ...headers(), ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Erreur températures qualité');
    return data;
  }

  window.QualityTemperatureApi = {
    listTypes() { return request('/types'); },
    getSummary() { return request('/summary'); },
    listRecords(filters) { return request(`${queryString(filters)}`); },
    getRecord(id) { return request(`/${id}`); },
    saveRecord(payload, id = null) { return request(id ? `/${id}` : '', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) }); },
    deleteRecord(id) { return request(`/${id}`, { method: 'DELETE' }); },
    listLimits(filters) { return request(`/limits${queryString(filters)}`); },
    saveLimit(payload, id = null) { return request(id ? `/limits/${id}` : '/limits', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) }); },
    deleteLimit(id) { return request(`/limits/${id}`, { method: 'DELETE' }); },
  };
})();
