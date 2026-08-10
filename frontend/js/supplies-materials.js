(function () {
  const API_BASE_URL = window.APP_CONFIG?.API_BASE_URL || '';
  const user = JSON.parse(localStorage.getItem('gc_user') || localStorage.getItem('grv2_user') || 'null');
  const token = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
  if (!user || !token) { window.location.href = './login.html'; return; }

  const canRead = window.hasQualityPermission?.(user, 'supplies_materials.read') || ['admin', 'responsable'].includes(user.role);
  const canWrite = window.hasQualityPermission?.(user, 'supplies_materials.write') || ['admin', 'responsable'].includes(user.role);
  const canArchive = window.hasQualityPermission?.(user, 'supplies_materials.archive') || ['admin', 'responsable'].includes(user.role);
  if (!canRead) { window.location.href = './home.html'; return; }

  const categories = [
    ['cleaning_product', 'Produit d’entretien'],
    ['food_packaging', 'Emballage alimentaire'],
    ['hygiene_ppe', 'Hygiène / EPI'],
    ['cleaning_equipment', 'Matériel de nettoyage'],
    ['food_small_equipment', 'Petit matériel alimentaire'],
    ['technical_consumable', 'Consommable technique'],
    ['maintenance_consumable', 'Maintenance / pièces'],
    ['other', 'Autre'],
  ];
  const documentRelations = [
    ['technical_sheet', 'Fiche technique'],
    ['safety_data_sheet', 'FDS'],
    ['food_contact_declaration', 'Déclaration contact alimentaire'],
    ['certificate', 'Certificat'],
    ['manufacturer_notice', 'Notice fabricant'],
    ['attestation', 'Attestation'],
    ['supplier_document', 'Document fournisseur'],
    ['other', 'Autre'],
  ];
  const linkTypes = [
    ['zone', 'Zone'],
    ['equipment', 'Équipement'],
    ['cleaning_plan', 'Plan de nettoyage'],
    ['documentation_section', 'Procédure / chapitre'],
    ['quality_task', 'Tâche qualité'],
    ['pms_chapter', 'Chapitre PMS'],
  ];

  const $ = (id) => document.getElementById(id);
  const els = {
    feedback: $('supplies-feedback'),
    table: $('supplies-table-body'),
    search: $('supplies-search'),
    categoryFilter: $('supplies-category-filter'),
    supplierFilter: $('supplies-supplier-filter'),
    activeFilter: $('supplies-active-filter'),
    foodContactFilter: $('supplies-food-contact-filter'),
    refreshBtn: $('supplies-refresh-btn'),
    addBtn: $('supplies-add-btn'),
    formCard: $('supplies-form-card'),
    form: $('supplies-form'),
    formTitle: $('supplies-form-title'),
    archiveBtn: $('supplies-archive-btn'),
    cancelBtn: $('supplies-cancel-btn'),
    detailCard: $('supplies-detail-card'),
    detailTitle: $('supplies-detail-title'),
    detailSummary: $('supplies-detail-summary'),
    documentsList: $('supplies-documents-list'),
    linksList: $('supplies-links-list'),
    documentSelect: $('supply-document-select'),
    documentRelation: $('supply-document-relation'),
    addDocumentBtn: $('supply-add-document-btn'),
    linkTargetType: $('supply-link-target-type'),
    linkTargetId: $('supply-link-target-id'),
    addLinkBtn: $('supply-add-link-btn'),
    diagnosticsBtn: $('supplies-diagnostics-btn'),
    diagnostics: $('supplies-diagnostics'),
  };

  const fields = {
    id: $('supply-id'),
    code: $('supply-code'),
    name: $('supply-name'),
    category: $('supply-category'),
    subcategory: $('supply-subcategory'),
    brand: $('supply-brand'),
    supplier: $('supply-supplier'),
    supplierReference: $('supply-supplier-reference'),
    orderUrl: $('supply-order-url'),
    unit: $('supply-unit'),
    packaging: $('supply-packaging'),
    purchasePrice: $('supply-purchase-price'),
    minimumStock: $('supply-minimum-stock'),
    currentStock: $('supply-current-stock'),
    active: $('supply-active'),
    description: $('supply-description'),
    notes: $('supply-notes'),
    dosage: $('meta-dosage'),
    dosageMode: $('meta-dosage-mode'),
    contactTime: $('meta-contact-time'),
    material: $('meta-material'),
    intendedUse: $('meta-intended-use'),
    ppeType: $('meta-ppe-type'),
    foodContact: $('meta-food-contact'),
    directFoodContact: $('meta-direct-food-contact'),
    dilutionCompatible: $('meta-dilution-compatible'),
    rinseRequired: $('meta-rinse-required'),
  };

  let materials = [];
  let selectedMaterial = null;
  let suppliers = [];
  let documents = [];
  let zones = [];
  let equipments = [];
  let cleaningPlans = [];
  let tasks = [];
  let sections = [];

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function setFeedback(message = '', type = '') {
    els.feedback.textContent = message;
    els.feedback.className = message ? `page-feedback ${type}`.trim() : 'page-feedback hidden';
  }

  function authHeaders() {
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
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
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: { ...authHeaders(), ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Erreur fournitures et matériels');
    return data;
  }

  function categoryLabel(value) {
    return categories.find(([key]) => key === value)?.[1] || value || '-';
  }

  function fillOptions(select, rows, options = {}) {
    select.innerHTML = options.emptyLabel ? `<option value="">${escapeHtml(options.emptyLabel)}</option>` : '';
    rows.forEach((row) => {
      const option = document.createElement('option');
      option.value = row.value || row.id || row[0];
      option.textContent = row.label || row.name || row.title || row[1] || row.value;
      select.appendChild(option);
    });
  }

  function loadFilters() {
    fillOptions(els.categoryFilter, categories.map(([value, label]) => ({ value, label })), { emptyLabel: 'Toutes' });
    fillOptions(fields.category, categories.map(([value, label]) => ({ value, label })));
    fillOptions(els.documentRelation, documentRelations.map(([value, label]) => ({ value, label })));
    fillOptions(els.linkTargetType, linkTypes.map(([value, label]) => ({ value, label })));
  }

  function renderTable() {
    if (!materials.length) {
      els.table.innerHTML = '<tr><td colspan="9">Aucune fourniture trouvée.</td></tr>';
      return;
    }
    els.table.innerHTML = materials.map((item) => {
      const doc = item.document_status || {};
      const stock = item.current_stock !== null && item.current_stock !== undefined
        ? `${item.current_stock} ${item.unit || ''}`.trim()
        : '-';
      return `
        <tr>
          <td>${escapeHtml(item.code || '-')}</td>
          <td><strong>${escapeHtml(item.name)}</strong></td>
          <td>${escapeHtml(categoryLabel(item.category))}</td>
          <td>${escapeHtml(item.brand || '-')}</td>
          <td>${escapeHtml(item.supplier?.name || '-')}</td>
          <td>${doc.total || 0} ${doc.has_safety_data_sheet ? ' FDS' : ''}${doc.has_technical_sheet ? ' FT' : ''}</td>
          <td>${escapeHtml(stock)}${item.low_stock ? ' · alerte' : ''}</td>
          <td>${item.active ? 'Actif' : 'Inactif'}</td>
          <td><button class="btn btn-secondary btn-sm" type="button" data-open-id="${escapeHtml(item.id)}">Ouvrir</button></td>
        </tr>
      `;
    }).join('');
  }

  function payload() {
    return {
      code: fields.code.value,
      name: fields.name.value,
      category: fields.category.value,
      subcategory: fields.subcategory.value,
      brand: fields.brand.value,
      supplier_id: fields.supplier.value || null,
      supplier_reference: fields.supplierReference.value,
      order_url: fields.orderUrl.value,
      unit: fields.unit.value,
      packaging: fields.packaging.value,
      purchase_price: fields.purchasePrice.value || null,
      minimum_stock: fields.minimumStock.value || null,
      current_stock: fields.currentStock.value || null,
      active: fields.active.checked,
      description: fields.description.value,
      notes: fields.notes.value,
      metadata: {
        dosage: fields.dosage.value,
        dosage_mode: fields.dosageMode.value,
        contact_time_minutes: fields.contactTime.value || null,
        material: fields.material.value,
        intended_use: fields.intendedUse.value,
        ppe_type: fields.ppeType.value,
        food_contact: fields.foodContact.checked,
        direct_food_contact: fields.directFoodContact.checked,
        dilution_station_compatible: fields.dilutionCompatible.checked,
        rinse_required: fields.rinseRequired.checked,
      },
    };
  }

  function fillForm(material = null) {
    selectedMaterial = material;
    fields.id.value = material?.id || '';
    fields.code.value = material?.code || '';
    fields.name.value = material?.name || '';
    fields.category.value = material?.category || 'cleaning_product';
    fields.subcategory.value = material?.subcategory || '';
    fields.brand.value = material?.brand || '';
    fields.supplier.value = material?.supplier_id || '';
    fields.supplierReference.value = material?.supplier_reference || '';
    fields.orderUrl.value = material?.order_url || '';
    fields.unit.value = material?.unit || '';
    fields.packaging.value = material?.packaging || '';
    fields.purchasePrice.value = material?.purchase_price || '';
    fields.minimumStock.value = material?.minimum_stock || '';
    fields.currentStock.value = material?.current_stock || '';
    fields.active.checked = material?.active !== false;
    fields.description.value = material?.description || '';
    fields.notes.value = material?.notes || '';
    const meta = material?.metadata || {};
    fields.dosage.value = meta.dosage || '';
    fields.dosageMode.value = meta.dosage_mode || '';
    fields.contactTime.value = meta.contact_time_minutes || '';
    fields.material.value = meta.material || '';
    fields.intendedUse.value = meta.intended_use || '';
    fields.ppeType.value = meta.ppe_type || '';
    fields.foodContact.checked = Boolean(meta.food_contact);
    fields.directFoodContact.checked = Boolean(meta.direct_food_contact);
    fields.dilutionCompatible.checked = Boolean(meta.dilution_station_compatible);
    fields.rinseRequired.checked = Boolean(meta.rinse_required);
    els.formTitle.textContent = material ? `Modifier ${material.name}` : 'Nouvelle fiche';
    els.archiveBtn.classList.toggle('hidden', !material || !canArchive);
    els.formCard.classList.remove('hidden');
  }

  function renderDetail(material) {
    selectedMaterial = material;
    els.detailTitle.textContent = material.name;
    els.detailSummary.innerHTML = `
      <article class="quality-list-item"><strong>Identification</strong><span>${escapeHtml(material.code || '-')} · ${escapeHtml(categoryLabel(material.category))}</span></article>
      <article class="quality-list-item"><strong>Fournisseur</strong><span>${escapeHtml(material.supplier?.name || '-')} ${material.supplier_reference ? `· ${escapeHtml(material.supplier_reference)}` : ''}</span></article>
      <article class="quality-list-item"><strong>Stock</strong><span>${escapeHtml(material.current_stock ?? '-')} ${escapeHtml(material.unit || '')}${material.low_stock ? ' · alerte stock faible' : ''}</span></article>
      <article class="quality-list-item"><strong>Utilisation</strong><span>${escapeHtml(material.description || material.notes || '-')}</span></article>
    `;
    els.documentsList.innerHTML = (material.documents || []).length
      ? material.documents.map((doc) => `
        <article class="quality-list-item">
          <strong>${escapeHtml(doc.title || doc.label || 'Document')}</strong>
          <span>${escapeHtml(doc.relation_type || doc.document_type || '-')} · ${escapeHtml(doc.status || '-')}</span>
        </article>
      `).join('')
      : '<div class="quality-muted">Aucun document maître rattaché.</div>';
    els.linksList.innerHTML = (material.links || []).length
      ? material.links.map((link) => `
        <article class="quality-list-item">
          <strong>${escapeHtml(linkTypes.find(([key]) => key === link.target_type)?.[1] || link.target_type)}</strong>
          <span>${escapeHtml(link.target_label || link.target_code || link.relation_type || 'Liaison active')}</span>
        </article>
      `).join('')
      : '<div class="quality-muted">Aucune liaison métier.</div>';
    els.detailCard.classList.remove('hidden');
  }

  async function loadMaterials() {
    const filters = {
      search: els.search.value,
      category: els.categoryFilter.value,
      supplier_id: els.supplierFilter.value,
      active: els.activeFilter.value,
      food_contact: els.foodContactFilter.value,
      limit: 100,
    };
    const data = await request(`/api/quality/supplies-materials${queryString(filters)}`);
    materials = data.materials || [];
    renderTable();
  }

  async function loadReferenceData() {
    const [supplierRows, masterDocs, zoneRows, equipmentRows, planRows, taskRows, docOutline] = await Promise.all([
      request('/api/suppliers'),
      request('/api/quality/master-documents?limit=200').catch(() => ({ documents: [] })),
      window.QualityDigitalTwinApi?.listZones?.().catch(() => []),
      window.QualityDigitalTwinApi?.listEquipments?.().catch(() => []),
      window.QualityCleaningApi?.listPlans?.({ limit: 200 }).catch(() => []),
      request('/api/quality/tasks?limit=200').catch(() => []),
      request('/api/quality/documentation/outline').catch(() => ({ sections: [] })),
    ]);
    suppliers = Array.isArray(supplierRows) ? supplierRows : [];
    documents = masterDocs.documents || [];
    zones = Array.isArray(zoneRows) ? zoneRows : [];
    equipments = Array.isArray(equipmentRows) ? equipmentRows : [];
    cleaningPlans = Array.isArray(planRows) ? planRows : [];
    tasks = Array.isArray(taskRows) ? taskRows : (taskRows.tasks || []);
    sections = docOutline.sections || [];
    fillOptions(els.supplierFilter, suppliers.map((supplier) => ({ value: supplier.id, label: `${supplier.code || ''} ${supplier.name || ''}`.trim() })), { emptyLabel: 'Tous' });
    fillOptions(fields.supplier, suppliers.map((supplier) => ({ value: supplier.id, label: `${supplier.code || ''} ${supplier.name || ''}`.trim() })), { emptyLabel: 'Aucun' });
    fillOptions(els.documentSelect, documents.map((doc) => ({ value: doc.id, label: `${doc.title} · ${doc.document_type || 'document'}` })), { emptyLabel: 'Choisir' });
    refreshTargetOptions();
  }

  function refreshTargetOptions() {
    const targetType = els.linkTargetType.value;
    const rows = {
      zone: zones.map((item) => ({ value: item.id, label: `${item.code || ''} ${item.name || ''}`.trim() })),
      equipment: equipments.map((item) => ({ value: item.id, label: `${item.code || ''} ${item.name || ''}`.trim() })),
      cleaning_plan: cleaningPlans.map((item) => ({ value: item.id, label: item.title })),
      quality_task: tasks.map((item) => ({ value: item.id, label: item.title })),
      documentation_section: sections.map((item) => ({ value: item.id, label: `${item.code || ''} ${item.title || ''}`.trim() })),
      pms_chapter: [],
    }[targetType] || [];
    fillOptions(els.linkTargetId, rows, { emptyLabel: targetType === 'pms_chapter' ? 'Code à saisir plus tard' : 'Choisir' });
    els.linkTargetId.disabled = targetType === 'pms_chapter';
  }

  async function openMaterial(id) {
    const data = await request(`/api/quality/supplies-materials/${encodeURIComponent(id)}`);
    fillForm(data.material);
    renderDetail(data.material);
  }

  async function saveMaterial(event) {
    event.preventDefault();
    if (!canWrite) return setFeedback('Droit écriture requis.', 'error');
    const id = fields.id.value;
    const data = await request(id ? `/api/quality/supplies-materials/${encodeURIComponent(id)}` : '/api/quality/supplies-materials', {
      method: id ? 'PATCH' : 'POST',
      body: JSON.stringify(payload()),
    });
    setFeedback('Fiche enregistrée.', 'success');
    await loadMaterials();
    renderDetail(data.material);
    fillForm(data.material);
  }

  async function archiveSelected() {
    if (!selectedMaterial || !canArchive) return;
    const confirmed = confirm(`Archiver ${selectedMaterial.name} ?`);
    if (!confirmed) return;
    await request(`/api/quality/supplies-materials/${encodeURIComponent(selectedMaterial.id)}`, { method: 'DELETE' });
    setFeedback('Fiche archivée.', 'success');
    els.formCard.classList.add('hidden');
    els.detailCard.classList.add('hidden');
    await loadMaterials();
  }

  async function addDocumentReference() {
    if (!selectedMaterial || !els.documentSelect.value) return;
    await request(`/api/quality/supplies-materials/${encodeURIComponent(selectedMaterial.id)}/documents`, {
      method: 'POST',
      body: JSON.stringify({
        document_id: els.documentSelect.value,
        relation_type: els.documentRelation.value,
      }),
    });
    await openMaterial(selectedMaterial.id);
  }

  async function addLink() {
    if (!selectedMaterial) return;
    await request(`/api/quality/supplies-materials/${encodeURIComponent(selectedMaterial.id)}/links`, {
      method: 'POST',
      body: JSON.stringify({
        target_type: els.linkTargetType.value,
        target_id: els.linkTargetType.value === 'pms_chapter' ? null : els.linkTargetId.value,
        relation_type: 'used_for',
      }),
    });
    await openMaterial(selectedMaterial.id);
  }

  async function runDiagnostics() {
    const data = await request('/api/quality/supplies-materials/diagnostics');
    els.diagnostics.innerHTML = Object.entries(data.diagnostics || {}).map(([key, rows]) => `
      <article class="quality-list-item">
        <strong>${escapeHtml(key.replaceAll('_', ' '))}</strong>
        <span>${Array.isArray(rows) ? rows.length : 0} élément(s)</span>
      </article>
    `).join('');
  }

  function bindEvents() {
    els.refreshBtn.addEventListener('click', () => loadMaterials().catch((err) => setFeedback(err.message, 'error')));
    els.addBtn.addEventListener('click', () => fillForm());
    els.addBtn.disabled = !canWrite;
    els.form.addEventListener('submit', (event) => saveMaterial(event).catch((err) => setFeedback(err.message, 'error')));
    els.cancelBtn.addEventListener('click', () => els.formCard.classList.add('hidden'));
    els.archiveBtn.addEventListener('click', () => archiveSelected().catch((err) => setFeedback(err.message, 'error')));
    els.table.addEventListener('click', (event) => {
      const button = event.target.closest('[data-open-id]');
      if (button) openMaterial(button.dataset.openId).catch((err) => setFeedback(err.message, 'error'));
    });
    [els.search, els.categoryFilter, els.supplierFilter, els.activeFilter, els.foodContactFilter].forEach((input) => {
      input.addEventListener('change', () => loadMaterials().catch((err) => setFeedback(err.message, 'error')));
    });
    els.search.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') loadMaterials().catch((err) => setFeedback(err.message, 'error'));
    });
    els.linkTargetType.addEventListener('change', refreshTargetOptions);
    els.addDocumentBtn.addEventListener('click', () => addDocumentReference().catch((err) => setFeedback(err.message, 'error')));
    els.addLinkBtn.addEventListener('click', () => addLink().catch((err) => setFeedback(err.message, 'error')));
    els.diagnosticsBtn.addEventListener('click', () => runDiagnostics().catch((err) => setFeedback(err.message, 'error')));
  }

  async function init() {
    loadFilters();
    bindEvents();
    await loadReferenceData();
    await loadMaterials();
    const initialId = new URLSearchParams(window.location.search).get('id');
    if (initialId) await openMaterial(initialId);
  }

  init().catch((err) => setFeedback(err.message, 'error'));
})();
