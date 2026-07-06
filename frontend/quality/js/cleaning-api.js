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
    const response = await fetch(`${API_BASE_URL}/api/quality/cleaning${path}`, {
      ...options,
      headers: { ...headers(), ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Erreur nettoyage qualité');
    return data;
  }

  window.QualityCleaningApi = {
    getSummary() { return request('/summary'); },
    listPlans(filters) { return request(`/plans${queryString(filters)}`); },
    getPlan(id) { return request(`/plans/${id}`); },
    savePlan(payload, id = null) { return request(id ? `/plans/${id}` : '/plans', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) }); },
    updatePlanStatus(id, active) { return request(`/plans/${id}/status`, { method: 'PATCH', body: JSON.stringify({ active }) }); },
    listDueRecords(filters) { return request(`/due-records${queryString(filters)}`); },
    createRecord(payload) { return request('/records', { method: 'POST', body: JSON.stringify(payload) }); },
    listRecords(filters) { return request(`/records${queryString(filters)}`); },
  };
})();
