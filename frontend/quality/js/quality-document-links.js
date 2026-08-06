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
    const response = await fetch(`${API_BASE_URL}/api/quality/master-documents/applicable/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (!response.ok) return [];
    const data = await response.json().catch(() => ({}));
    return data.references || [];
  }

  async function openPdf(documentId) {
    const response = await fetch(`${API_BASE_URL}/api/quality/master-documents/${encodeURIComponent(documentId)}/export-pdf`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (!response.ok) throw new Error(response.status === 403 ? 'Export PDF non autorise.' : 'Export PDF indisponible.');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
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
          <div class="quality-actions">
            <button class="btn btn-secondary" type="button" data-master-document-id="${escapeHtml(reference.document_id)}">Consulter</button>
            <button class="btn btn-secondary" type="button" data-master-document-pdf="${escapeHtml(reference.document_id)}">PDF</button>
          </div>
        </article>
      `).join('') : '<div class="quality-empty-state">Aucun document applicable rattache.</div>'}
    `;
    container.querySelectorAll('[data-master-document-id]').forEach((button) => {
      button.addEventListener('click', () => {
        window.location.href = `./master-documents.html?document_id=${encodeURIComponent(button.dataset.masterDocumentId)}`;
      });
    });
    container.querySelectorAll('[data-master-document-pdf]').forEach((button) => {
      button.addEventListener('click', () => openPdf(button.dataset.masterDocumentPdf).catch(() => {}));
    });
    return references;
  }

  window.QualityDocumentLinks = { list, openPdf, render };
})();
