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
    const response = await fetch(`${API_BASE_URL}/api/quality/tasks${path}`, {
      ...options,
      headers: { ...headers(), ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Erreur tâches qualité');
    return data;
  }

  window.QualityTasksApi = {
    getSummary() { return request('/summary'); },
    list(filters) { return request(queryString(filters)); },
    get(id) { return request(`/${id}`); },
    save(payload, id = null) { return request(id ? `/${id}` : '', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) }); },
    updateStatus(id, payload) { return request(`/${id}/status`, { method: 'PATCH', body: JSON.stringify(payload) }); },
    deactivate(id) { return request(`/${id}`, { method: 'DELETE' }); },
  };
})();
