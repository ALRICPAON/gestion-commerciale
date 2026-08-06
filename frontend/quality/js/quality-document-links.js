(function () {
  const API_BASE_URL = window.APP_CONFIG?.API_BASE_URL || '';

  function token() {
    return localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
  }

  function escapeHtml(value = '') {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[char]));
  }

  async function list(targetType, targetId) {
    if (!targetType || !targetId) return [];
    const response = await fetch(`${API_BASE_URL}/api/quality/master-documents/target/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (!response.ok) return [];
    const data = await response.json().catch(() => ({}));
    return data.references || [];
  }

  async function render(targetType, targetId, container, options = {}) {
    if (!container) return [];
    container.innerHTML = '<div class="quality-muted">Chargement des documents applicables...</div>';
    const references = await list(targetType, targetId);
    const title = options.title || 'Documents applicables';
    container.innerHTML = `
      <h3>${escapeHtml(title)}</h3>
      ${references.length ? references.map((reference) => `
        <article class="quality-card">
          <span class="quality-badge">${escapeHtml(reference.document_status || '-')}</span>
          <h4>${escapeHtml(reference.document_title || reference.target_label || 'Document qualite')}</h4>
          <p class="quality-muted">${escapeHtml(reference.document_type || '-')} - ${escapeHtml(reference.relation_type || 'reference')}</p>
          <button class="btn btn-secondary" type="button" data-master-document-id="${escapeHtml(reference.document_id)}">Ouvrir</button>
        </article>
      `).join('') : '<div class="quality-empty-state">Aucun document applicable rattache.</div>'}
    `;
    container.querySelectorAll('[data-master-document-id]').forEach((button) => {
      button.addEventListener('click', () => {
        window.location.href = `./master-documents.html?document_id=${encodeURIComponent(button.dataset.masterDocumentId)}`;
      });
    });
    return references;
  }

  window.QualityDocumentLinks = { list, render };
})();
