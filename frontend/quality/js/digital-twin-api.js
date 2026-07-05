(function () {
  const API_BASE_URL = window.APP_CONFIG?.API_BASE_URL || '';

  function authToken() {
    return localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
  }

  function headers() {
    return {
      Authorization: `Bearer ${authToken()}`,
      'Content-Type': 'application/json',
    };
  }

  function queryString(filters = {}) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.set(key, value);
      }
    });
    const query = params.toString();
    return query ? `?${query}` : '';
  }

  async function request(path, options = {}) {
    const response = await fetch(`${API_BASE_URL}/api/quality${path}`, {
      ...options,
      headers: {
        ...headers(),
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Erreur qualité');
    return data;
  }

  window.QualityDigitalTwinApi = {
    listZones(filters) { return request(`/zones${queryString(filters)}`); },
    getZone(id) { return request(`/zones/${id}`); },
    saveZone(payload, id = null) {
      return request(id ? `/zones/${id}` : '/zones', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    },
    setZoneStatus(id, status) { return request(`/zones/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); },
    deleteZone(id) { return request(`/zones/${id}`, { method: 'DELETE' }); },
    listEquipments(filters) { return request(`/equipments${queryString(filters)}`); },
    getEquipment(id) { return request(`/equipments/${id}`); },
    saveEquipment(payload, id = null) {
      return request(id ? `/equipments/${id}` : '/equipments', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    },
    setEquipmentStatus(id, status) { return request(`/equipments/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); },
    deleteEquipment(id) { return request(`/equipments/${id}`, { method: 'DELETE' }); },
  };
})();
