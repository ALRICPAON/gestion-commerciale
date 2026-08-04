(function () {
  const API_BASE_URL = window.APP_CONFIG?.API_BASE_URL || '';

  function authToken() {
    return localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
  }

  function headers() {
    return { Authorization: `Bearer ${authToken()}`, 'Content-Type': 'application/json' };
  }

  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function queryString(filters = {}) {
    const params = new URLSearchParams();
    Object.entries(filters || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.set(key, value);
    });
    const query = params.toString();
    return query ? `?${query}` : '';
  }

  async function request(path, options = {}) {
    const response = await fetch(`${API_BASE_URL}/api/quality/operations${path}`, {
      ...options,
      headers: { ...headers(), ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Erreur qualite operationnelle');
    return data;
  }

  async function upload(path, formData) {
    const response = await fetch(`${API_BASE_URL}/api/quality/operations${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken()}` },
      body: formData,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Erreur upload preuve qualite');
    return data;
  }

  window.QualityOperationsApi = {
    today(filters) { return request(`/today${queryString(filters)}`); },
    overdue(filters) { return request(`/overdue${queryString(filters)}`); },
    ddpp(filters) { return request(`/ddpp${queryString(filters)}`); },
    ddppRecordDetail(type, id) {
      console.debug('[DDPP api] GET detail', { record_type: type, record_id: id });
      if (!UUID_PATTERN.test(String(id || ''))) throw new Error('Identifiant enregistrement invalide cote interface');
      return request(`/ddpp/record/${encodeURIComponent(type)}/${encodeURIComponent(id)}`);
    },
    uploadEvidencePhoto(formData) { return upload('/evidence/photos', formData); },
    uploadEvidenceDocument(formData) { return upload('/evidence/documents', formData); },
    deleteEvidencePhoto(id) { return request(`/evidence/photos/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
    deleteEvidenceDocument(id) { return request(`/evidence/documents/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
    executeTemperature(payload) { return request('/temperature-occurrences/execute', { method: 'POST', body: JSON.stringify(payload) }); },
    executeCleaning(payload) { return request('/cleaning-occurrences/execute', { method: 'POST', body: JSON.stringify(payload) }); },
    executeManual(payload) { return request('/manual-occurrences/execute', { method: 'POST', body: JSON.stringify(payload) }); },
    createNonConformity(payload) { return request('/non-conformities', { method: 'POST', body: JSON.stringify(payload) }); },
    createCorrectiveAction(payload) { return request('/corrective-actions', { method: 'POST', body: JSON.stringify(payload) }); },
    closeNonConformity(id, payload) { return request(`/non-conformities/${id}/close`, { method: 'POST', body: JSON.stringify(payload) }); },
  };
})();
