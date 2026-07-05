(function () {
  const API_BASE_URL = window.APP_CONFIG?.API_BASE_URL || '';

  function parseStoredJson(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null');
    } catch (error) {
      return null;
    }
  }

  function currentUser() {
    return parseStoredJson('gc_user') || parseStoredJson('grv2_user');
  }

  function currentToken() {
    return localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
  }

  function redirectToLogin() {
    const redirect = `${window.location.pathname}${window.location.search}`;
    window.location.href = `/login.html?redirect=${encodeURIComponent(redirect)}`;
  }

  const sessionUser = currentUser();
  const authToken = currentToken();
  if (!sessionUser || !authToken) { redirectToLogin(); return; }

  const canManage = window.hasQualityPermission?.(sessionUser, 'quality.document.manage') || window.hasQualityPermission?.(sessionUser, 'quality.admin');
  const params = new URLSearchParams(window.location.search);
  const ownerType = params.get('owner_type');
  const ownerId = params.get('owner_id');
  const ownerLabel = params.get('label') || 'Objet qualité';
  const $ = (id) => document.getElementById(id);
  const els = {
    title: $('document-owner-title'),
    feedback: $('document-feedback'),
    tabPhotos: $('tab-photos'),
    tabDocuments: $('tab-documents'),
    photosPanel: $('photos-panel'),
    documentsPanel: $('documents-panel'),
    photoForm: $('photo-form'),
    photoFile: $('photo-file'),
    photoCaption: $('photo-caption'),
    photoDate: $('photo-date'),
    photoAuthor: $('photo-author'),
    photoOrder: $('photo-order'),
    photoPrimary: $('photo-primary'),
    photoSubmit: $('photo-submit'),
    photoIncludeArchived: $('photo-include-archived'),
    photoList: $('photo-list'),
    documentForm: $('document-form'),
    documentFile: $('document-file'),
    documentType: $('document-type'),
    documentName: $('document-name'),
    documentVersion: $('document-version'),
    documentDate: $('document-date'),
    documentAuthor: $('document-author'),
    documentDescription: $('document-description'),
    documentSubmit: $('document-submit'),
    documentIncludeArchived: $('document-include-archived'),
    documentList: $('document-list'),
  };
  let photos = [];
  let documents = [];

  function setFeedback(message = '', type = '') {
    els.feedback.textContent = message;
    els.feedback.className = message ? `page-feedback ${type}`.trim() : 'page-feedback hidden';
  }

  function authHeaders(extra = {}) {
    return { Authorization: `Bearer ${authToken}`, ...extra };
  }

  function queryString(includeArchived = false) {
    const params = new URLSearchParams({ owner_type: ownerType, owner_id: ownerId });
    if (includeArchived) params.set('include_archived', 'true');
    const query = params.toString();
    return `?${query}`;
  }

  async function request(path, options = {}) {
    const response = await fetch(`${API_BASE_URL}/api/quality${path}`, {
      ...options,
      headers: authHeaders(options.headers || {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Erreur dossier documentaire qualité');
    return data;
  }

  async function fetchProtectedBlob(path) {
    const response = await fetch(`${API_BASE_URL}/api/quality${path}`, { headers: authHeaders() });
    if (!response.ok) throw new Error('Fichier introuvable');
    return response.blob();
  }

  async function openProtectedFile(path, filename, download = false) {
    const blob = await fetchProtectedBlob(path);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener';
    if (download && filename) link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function hydratePhotoThumbnails() {
    const images = Array.from(els.photoList.querySelectorAll('img[data-photo-src]'));
    await Promise.all(images.map(async (image) => {
      try {
        const blob = await fetchProtectedBlob(image.dataset.photoSrc);
        const url = URL.createObjectURL(blob);
        image.src = url;
        image.onload = () => URL.revokeObjectURL(url);
      } catch (error) {
        image.replaceWith(document.createTextNode('Aperçu indisponible'));
      }
    }));
  }

  async function downloadProtectedFile(path, filename) {
    const response = await fetch(`${API_BASE_URL}/api/quality${path}`, { headers: authHeaders() });
    if (!response.ok) throw new Error('Fichier introuvable');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || 'document';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function switchTab(name) {
    const photosVisible = name === 'photos';
    els.photosPanel.classList.toggle('hidden', !photosVisible);
    els.documentsPanel.classList.toggle('hidden', photosVisible);
    els.tabPhotos.className = photosVisible ? 'btn btn-primary' : 'btn btn-secondary';
    els.tabDocuments.className = photosVisible ? 'btn btn-secondary' : 'btn btn-primary';
  }

  function renderPhotos() {
    if (!photos.length) {
      els.photoList.innerHTML = '<div class="quality-empty-state">Aucune photo enregistrée.</div>';
      return;
    }
    els.photoList.innerHTML = photos.map((photo) => `<article class="quality-card" style="${photo.archived_at ? 'border-color:#b7791f;background:#fffaf0;' : ''}"><span class="quality-badge">${photo.archived_at ? 'Archivé' : (photo.is_primary ? 'Principale' : 'Photo')}</span><img data-photo-src="/photos/${photo.id}/file" alt="${photo.caption || photo.original_filename}" style="width:100%;max-height:180px;object-fit:cover;border-radius:6px;margin:8px 0;"><h3>${photo.caption || photo.original_filename}</h3><p class="quality-muted">Type : photo · Date : ${photo.photo_date || '-'} · Auteur : ${photo.author || '-'}</p><p class="quality-muted">Ordre : ${photo.display_order}</p>${photo.archived_at ? `<p class="quality-muted">Archivée le : ${new Date(photo.archived_at).toLocaleString('fr-FR')}</p>` : ''}<div class="quality-actions"><button class="btn btn-secondary" data-photo-action="view" data-id="${photo.id}">Consulter</button>${photo.archived_at ? `<button class="btn btn-secondary" data-photo-action="restore" data-id="${photo.id}">Restaurer</button>` : `<button class="btn btn-secondary" data-photo-action="delete" data-id="${photo.id}">Archiver</button>`}</div></article>`).join('');
    if (!canManage) els.photoList.querySelectorAll('button[data-photo-action="delete"], button[data-photo-action="restore"]').forEach((button) => { button.disabled = true; });
    hydratePhotoThumbnails();
  }

  function renderDocuments() {
    if (!documents.length) {
      els.documentList.innerHTML = '<div class="quality-empty-state">Aucun document enregistré.</div>';
      return;
    }
    els.documentList.innerHTML = documents.map((document) => `<article class="quality-card" style="${document.archived_at ? 'border-color:#b7791f;background:#fffaf0;' : ''}"><span class="quality-badge">${document.archived_at ? 'Archivé' : document.type_code}</span><h3>${document.name}</h3><p class="quality-muted">Type : ${document.type_code} · Date : ${document.document_date || '-'} · Auteur : ${document.author || '-'}</p><p class="quality-muted">Version : ${document.version || '-'} · Fichier : ${document.original_filename || '-'}</p>${document.archived_at ? `<p class="quality-muted">Archivé le : ${new Date(document.archived_at).toLocaleString('fr-FR')}</p>` : ''}<p class="quality-muted">${document.description || ''}</p><div class="quality-actions"><button class="btn btn-secondary" data-document-action="open" data-id="${document.id}">Consulter</button><button class="btn btn-secondary" data-document-action="download" data-id="${document.id}">Télécharger</button>${document.archived_at ? `<button class="btn btn-secondary" data-document-action="restore" data-id="${document.id}">Restaurer</button>` : `<button class="btn btn-secondary" data-document-action="delete" data-id="${document.id}">Archiver</button>`}</div></article>`).join('');
    if (!canManage) els.documentList.querySelectorAll('button[data-document-action="delete"], button[data-document-action="restore"]').forEach((button) => { button.disabled = true; });
  }

  async function load() {
    setFeedback('Chargement du dossier documentaire...');
    try {
      [photos, documents] = await Promise.all([
        request(`/photos${queryString(els.photoIncludeArchived.checked)}`),
        request(`/documents${queryString(els.documentIncludeArchived.checked)}`),
      ]);
      renderPhotos();
      renderDocuments();
      setFeedback('');
    } catch (error) {
      setFeedback(error.message, 'error');
    }
  }

  function ownerFields(formData) {
    formData.set('owner_type', ownerType);
    formData.set('owner_id', ownerId);
    return formData;
  }

  els.title.textContent = `Dossier documentaire - ${ownerLabel}`;
  els.photoSubmit.disabled = !canManage;
  els.documentSubmit.disabled = !canManage;
  if (!canManage) {
    els.photoForm.classList.add('quality-readonly');
    els.documentForm.classList.add('quality-readonly');
  }

  els.tabPhotos.addEventListener('click', () => switchTab('photos'));
  els.tabDocuments.addEventListener('click', () => switchTab('documents'));
  els.photoIncludeArchived.addEventListener('change', load);
  els.documentIncludeArchived.addEventListener('change', load);

  els.photoForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!canManage) return;
    const formData = ownerFields(new FormData());
    formData.set('file', els.photoFile.files[0]);
    formData.set('caption', els.photoCaption.value);
    formData.set('photo_date', els.photoDate.value);
    formData.set('author', els.photoAuthor.value);
    formData.set('display_order', els.photoOrder.value);
    formData.set('is_primary', els.photoPrimary.checked ? 'true' : 'false');
    try {
      await request('/photos', { method: 'POST', body: formData });
      els.photoForm.reset();
      await load();
    } catch (error) {
      setFeedback(error.message, 'error');
    }
  });

  els.documentForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!canManage) return;
    const formData = ownerFields(new FormData());
    formData.set('file', els.documentFile.files[0]);
    formData.set('type_code', els.documentType.value);
    formData.set('name', els.documentName.value);
    formData.set('version', els.documentVersion.value);
    formData.set('document_date', els.documentDate.value);
    formData.set('author', els.documentAuthor.value);
    formData.set('description', els.documentDescription.value);
    try {
      await request('/documents', { method: 'POST', body: formData });
      els.documentForm.reset();
      await load();
    } catch (error) {
      setFeedback(error.message, 'error');
    }
  });

  els.photoList.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-photo-action]');
    if (!button) return;
    const photo = photos.find((item) => item.id === button.dataset.id);
    if (!photo) return;
    try {
      if (button.dataset.photoAction === 'view') await openProtectedFile(`/photos/${photo.id}/file`, photo.original_filename);
      if (button.dataset.photoAction === 'restore' && canManage) {
        await request(`/photos/${photo.id}/restore`, { method: 'PATCH' });
        await load();
      }
      if (button.dataset.photoAction === 'delete' && canManage && window.confirm('Archiver cette photo ?')) {
        await request(`/photos/${photo.id}`, { method: 'DELETE' });
        await load();
      }
    } catch (error) {
      setFeedback(error.message, 'error');
    }
  });

  els.documentList.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-document-action]');
    if (!button) return;
    const document = documents.find((item) => item.id === button.dataset.id);
    if (!document) return;
    try {
      if (button.dataset.documentAction === 'open') await openProtectedFile(`/documents/${document.id}/download`, document.original_filename);
      if (button.dataset.documentAction === 'download') await downloadProtectedFile(`/documents/${document.id}/download`, document.original_filename);
      if (button.dataset.documentAction === 'restore' && canManage) {
        await request(`/documents/${document.id}/restore`, { method: 'PATCH' });
        await load();
      }
      if (button.dataset.documentAction === 'delete' && canManage && window.confirm('Archiver ce document ?')) {
        await request(`/documents/${document.id}`, { method: 'DELETE' });
        await load();
      }
    } catch (error) {
      setFeedback(error.message, 'error');
    }
  });

  if (!['zone', 'equipment'].includes(ownerType) || !ownerId) {
    setFeedback('Objet qualité invalide.', 'error');
  } else {
    load();
  }
})();
