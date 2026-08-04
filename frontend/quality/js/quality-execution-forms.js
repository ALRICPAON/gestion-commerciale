(function () {
  const TEMPERATURE_FIELDS = Object.freeze([
    'parameter', 'type', 'zone', 'equipment', 'min_limit', 'max_limit', 'unit',
    'value', 'recorded_at', 'source', 'operator', 'comment', 'conformity',
    'corrective_action', 'evidence_photo_id', 'evidence_document_id', 'exceptional_reason',
  ]);
  const CLEANING_FIELDS = Object.freeze([
    'plan', 'zones', 'equipments', 'method', 'product', 'dosage_concentration',
    'contact_time_minutes', 'safety_instructions', 'started_at', 'ended_at', 'status',
    'visual_check_status', 'operator', 'comment', 'anomaly_comment',
    'corrective_action', 'evidence_photo_id', 'evidence_document_id', 'exceptional_reason',
  ]);

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function toDatetimeLocal(value) {
    const date = value ? new Date(value) : new Date();
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }

  function executionSource(qualityTaskId, occurrenceId) {
    return qualityTaskId || occurrenceId ? 'scheduled' : 'exceptional';
  }

  function requireExceptionalReason(payload) {
    if (payload.source !== 'exceptional') return null;
    if (payload.exceptional_reason || payload.comment) return null;
    return 'Motif obligatoire pour une saisie exceptionnelle.';
  }

  function applyExceptionalCopy(titleEl, submitEl, hasScheduledLink) {
    if (titleEl) titleEl.textContent = hasScheduledLink ? 'Execution du controle attendu' : 'Nouvelle saisie exceptionnelle';
    if (submitEl) submitEl.textContent = hasScheduledLink ? 'Enregistrer et completer le controle' : 'Enregistrer la saisie exceptionnelle';
  }

  function optionHtml(items, valueKey, labelFn, emptyLabel) {
    const empty = emptyLabel ? `<option value="">${escapeHtml(emptyLabel)}</option>` : '';
    return empty + (items || []).map((item) => `<option value="${escapeHtml(item[valueKey])}">${escapeHtml(labelFn(item))}</option>`).join('');
  }

  function ensureOption(select, value, label) {
    if (!select || !value) return;
    if ([...select.options].some((option) => String(option.value) === String(value))) return;
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label || value;
    select.appendChild(option);
  }

  function targetNames(items, fallback) {
    const names = (Array.isArray(items) ? items : []).map((item) => item.name || item.code || item.id).filter(Boolean);
    return names.join(', ') || fallback || '-';
  }

  function numberOrNull(value) {
    if (value === '' || value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  function setReadonly(control, locked) {
    if (!control) return;
    if (control.tagName === 'SELECT') control.disabled = locked;
    else control.readOnly = locked;
  }

  function evidenceHtml(kind) {
    return `
      <input data-field="evidence_photo_id" type="hidden" data-quality-field="evidence_photo_id">
      <input data-field="evidence_document_id" type="hidden" data-quality-field="evidence_document_id">
      <label>Photo / preuve photo<input data-field="evidence_photo_file" class="form-input" type="file" accept="image/*" capture="environment"><small data-field="evidence_photo_preview" class="quality-muted">Aucune photo selectionnee.</small></label>
      <label>Piece jointe / preuve<input data-field="evidence_document_file" class="form-input" type="file"><small data-field="evidence_document_preview" class="quality-muted">Aucun document selectionne.</small></label>
      <input data-field="evidence_kind" type="hidden" value="${escapeHtml(kind)}">
    `;
  }

  function evidenceOwner(fields) {
    const equipmentId = fields.equipment_id?.value || '';
    const zoneId = fields.zone_id?.value || '';
    return { equipment_id: equipmentId, zone_id: zoneId };
  }

  function bindEvidencePreview(field) {
    const photoInput = field('evidence_photo_file');
    const photoPreview = field('evidence_photo_preview');
    const documentInput = field('evidence_document_file');
    const documentPreview = field('evidence_document_preview');
    photoInput?.addEventListener('change', () => {
      const file = photoInput.files?.[0];
      photoPreview.textContent = file ? `${file.name} - ${Math.round(file.size / 1024)} Ko` : 'Aucune photo selectionnee.';
    });
    documentInput?.addEventListener('change', () => {
      const file = documentInput.files?.[0];
      documentPreview.textContent = file ? `${file.name} - ${Math.round(file.size / 1024)} Ko` : 'Aucun document selectionne.';
    });
  }

  async function uploadEvidenceFiles({ operationsApi, field, owner, caption }) {
    const photo = field('evidence_photo_file')?.files?.[0] || null;
    const document = field('evidence_document_file')?.files?.[0] || null;
    if (photo) {
      const body = new FormData();
      body.append('file', photo);
      if (owner.equipment_id) body.append('equipment_id', owner.equipment_id);
      if (owner.zone_id) body.append('zone_id', owner.zone_id);
      body.append('caption', caption || 'Preuve operationnelle qualite');
      const uploaded = await operationsApi.uploadEvidencePhoto(body);
      field('evidence_photo_id').value = uploaded.evidence_photo_id || uploaded.photo?.id || '';
    }
    if (document) {
      const body = new FormData();
      body.append('file', document);
      if (owner.equipment_id) body.append('equipment_id', owner.equipment_id);
      if (owner.zone_id) body.append('zone_id', owner.zone_id);
      body.append('name', document.name || 'Preuve operationnelle qualite');
      const uploaded = await operationsApi.uploadEvidenceDocument(body);
      field('evidence_document_id').value = uploaded.evidence_document_id || uploaded.document?.id || '';
    }
  }

  function createTemperatureExecutionForm({ form, titleEl = null, submitEl = null, types = [], zones = [], equipments = [], operationsApi, user = {}, onSubmitted = null, onError = null } = {}) {
    let context = {};
    form.dataset.qualitySharedForm = 'temperature';
    form.innerHTML = `
      <input data-field="quality_task_id" type="hidden">
      <input data-field="occurrence_id" type="hidden">
      <input data-field="parameter_id" type="hidden">
      <label>Parametre<input data-field="parameter_label" class="form-input" readonly data-quality-field="parameter"></label>
      <label>Parametre / type *<select data-field="type_code" class="form-input" required data-quality-field="type"></select></label>
      <label>Zone<select data-field="zone_id" class="form-input" data-quality-field="zone"></select></label>
      <label>Equipement<select data-field="equipment_id" class="form-input" data-quality-field="equipment"></select></label>
      <label>Seuil mini<input data-field="min_limit" class="form-input" type="number" step="0.01" readonly data-quality-field="min_limit"></label>
      <label>Seuil maxi<input data-field="max_limit" class="form-input" type="number" step="0.01" readonly data-quality-field="max_limit"></label>
      <label>Unite<input data-field="unit" class="form-input" value="C" data-quality-field="unit"></label>
      <label>Valeur mesuree *<input data-field="value" class="form-input" type="number" step="0.01" required data-quality-field="value"></label>
      <label>Date/heure *<input data-field="recorded_at" class="form-input" type="datetime-local" required data-quality-field="recorded_at"></label>
      <label>Origine<input data-field="source_label" class="form-input" readonly data-quality-field="source"></label>
      <label>Operateur<input data-field="operator" class="form-input" readonly data-quality-field="operator"></label>
      <label>Conformite calculee<input data-field="conformity" class="form-input" readonly data-quality-field="conformity"></label>
      <label class="quality-form-wide">Commentaire<textarea data-field="comment" class="form-input" data-quality-field="comment"></textarea></label>
      <label class="quality-form-wide">Action corrective<textarea data-field="corrective_action" class="form-input" data-quality-field="corrective_action"></textarea></label>
      ${evidenceHtml('temperature')}
      <label class="quality-form-wide">Motif exceptionnel<textarea data-field="exceptional_reason" class="form-input" data-quality-field="exceptional_reason"></textarea></label>
      <div data-field="alert" class="page-feedback hidden quality-form-wide"></div>
      <div class="quality-actions quality-form-wide"><button data-field="submit" class="btn btn-primary" type="submit">Enregistrer</button><button data-field="reset" class="btn btn-secondary" type="button">Reinitialiser</button></div>
    `;

    const field = (name) => form.querySelector(`[data-field="${name}"]`);
    bindEvidencePreview(field);
    field('type_code').innerHTML = optionHtml(types, 'code', (type) => type.label || type.code, 'Choisir un type');
    field('zone_id').innerHTML = optionHtml(zones, 'id', (zone) => `${zone.code || ''} ${zone.name || zone.id}`.trim(), 'Toutes zones');
    field('equipment_id').innerHTML = optionHtml(equipments, 'id', (equipment) => `${equipment.code || ''} ${equipment.name || equipment.id}`.trim(), 'Tous equipements');

    function showAlert(message = '') {
      const alert = field('alert');
      alert.textContent = message;
      alert.className = message ? 'page-feedback error quality-form-wide' : 'page-feedback hidden quality-form-wide';
      if (message && onError) onError(message);
    }

    function updateConformity() {
      const value = numberOrNull(field('value').value);
      const min = numberOrNull(field('min_limit').value);
      const max = numberOrNull(field('max_limit').value);
      let label = 'Non calculee';
      if (value !== null && ((min !== null && value < min) || (max !== null && value > max))) label = 'Non conforme';
      else if (value !== null) label = 'Conforme';
      field('conformity').value = label;
    }

    function setContext(next = {}) {
      context = next || {};
      const hasScheduledLink = Boolean(context.quality_task_id || context.occurrence_id);
      ensureOption(field('type_code'), context.type_code, context.type_label || context.type_code);
      ensureOption(field('zone_id'), context.zone_id, context.zone_name || context.zone_code || context.zone_id);
      ensureOption(field('equipment_id'), context.equipment_id, context.equipment_name || context.equipment_code || context.equipment_id);
      field('quality_task_id').value = context.quality_task_id || '';
      field('occurrence_id').value = context.occurrence_id || '';
      field('parameter_id').value = context.parameter_id || context.limit_id || context.source_entity_id || '';
      field('parameter_label').value = context.parameter_label || context.task_title || context.title || context.parameter_id || context.limit_id || context.source_entity_id || 'Saisie exceptionnelle';
      field('type_code').value = context.type_code || '';
      field('zone_id').value = context.zone_id || '';
      field('equipment_id').value = context.equipment_id || '';
      field('min_limit').value = context.min_limit ?? context.min_value ?? '';
      field('max_limit').value = context.max_limit ?? context.max_value ?? '';
      field('unit').value = context.unit || 'C';
      field('value').value = '';
      field('recorded_at').value = toDatetimeLocal(context.recorded_at);
      field('source_label').value = hasScheduledLink ? 'Controle planifie' : 'Saisie exceptionnelle';
      field('operator').value = user.email || user.name || 'Utilisateur connecte';
      field('comment').value = context.comment || '';
      field('corrective_action').value = context.corrective_action || '';
      field('evidence_photo_id').value = '';
      field('evidence_document_id').value = '';
      field('evidence_photo_file').value = '';
      field('evidence_document_file').value = '';
      field('evidence_photo_preview').textContent = 'Aucune photo selectionnee.';
      field('evidence_document_preview').textContent = 'Aucun document selectionne.';
      field('exceptional_reason').value = context.exceptional_reason || '';
      field('exceptional_reason').closest('label').classList.toggle('hidden', hasScheduledLink);
      ['type_code', 'zone_id', 'equipment_id', 'min_limit', 'max_limit', 'unit'].forEach((name) => setReadonly(field(name), Boolean(context.locked)));
      applyExceptionalCopy(titleEl, submitEl || field('submit'), hasScheduledLink);
      updateConformity();
      showAlert('');
    }

    function getPayload() {
      const source = executionSource(field('quality_task_id').value, field('occurrence_id').value);
      return {
        type_code: field('type_code').value,
        parameter_id: field('parameter_id').value || null,
        value: numberOrNull(field('value').value),
        unit: field('unit').value || 'C',
        recorded_at: field('recorded_at').value ? new Date(field('recorded_at').value).toISOString() : new Date().toISOString(),
        source,
        exceptional_reason: source === 'exceptional' ? field('exceptional_reason').value || field('comment').value || null : null,
        occurrence_id: field('occurrence_id').value || null,
        quality_task_id: field('quality_task_id').value || null,
        zone_id: field('zone_id').value || null,
        equipment_id: field('equipment_id').value || null,
        comment: field('comment').value || null,
        method_used: context.method_used || null,
        corrective_action: field('corrective_action').value || null,
        evidence_photo_id: field('evidence_photo_id').value || null,
        evidence_document_id: field('evidence_document_id').value || null,
      };
    }

    function validate(payload = getPayload()) {
      if (!payload.type_code) return 'Type de temperature obligatoire.';
      if (payload.value === null) return 'La temperature mesuree est obligatoire.';
      return requireExceptionalReason(payload);
    }

    async function submit(event) {
      if (event) event.preventDefault();
      const payload = getPayload();
      const error = validate(payload);
      if (error) return showAlert(error);
      try {
        await uploadEvidenceFiles({ operationsApi, field, owner: evidenceOwner({ zone_id: field('zone_id'), equipment_id: field('equipment_id') }), caption: `Preuve temperature ${payload.type_code}` });
        payload.evidence_photo_id = field('evidence_photo_id').value || null;
        payload.evidence_document_id = field('evidence_document_id').value || null;
        const result = await submitTemperatureExecution({ operationsApi, payload });
        if (onSubmitted) await onSubmitted(result, payload);
        return result;
      } catch (error) {
        showAlert(error.message || 'Erreur enregistrement temperature');
        return null;
      }
    }

    form.addEventListener('submit', submit);
    field('reset').addEventListener('click', () => setContext({ recorded_at: new Date().toISOString() }));
    field('value').addEventListener('input', updateConformity);
    setContext({ recorded_at: new Date().toISOString() });

    return { form, field, getPayload, setContext, submit, validate, fields: TEMPERATURE_FIELDS };
  }

  function createCleaningExecutionForm({ form, titleEl = null, submitEl = null, plans = [], operationsApi, user = {}, onSubmitted = null, onError = null } = {}) {
    let context = {};
    form.dataset.qualitySharedForm = 'cleaning';
    form.innerHTML = `
      <input data-field="quality_task_id" type="hidden">
      <input data-field="occurrence_id" type="hidden">
      <label>Plan *<select data-field="cleaning_plan_id" class="form-input" required data-quality-field="plan"></select></label>
      <label>Zones<textarea data-field="zones" class="form-input" readonly data-quality-field="zones"></textarea></label>
      <label>Equipements<textarea data-field="equipments" class="form-input" readonly data-quality-field="equipments"></textarea></label>
      <label class="quality-form-wide">Methode<textarea data-field="method" class="form-input" readonly data-quality-field="method"></textarea></label>
      <label>Produit<input data-field="product_name" class="form-input" readonly data-quality-field="product"></label>
      <label>Dosage<input data-field="dosage_concentration" class="form-input" readonly data-quality-field="dosage_concentration"></label>
      <label>Temps de contact<input data-field="contact_time_minutes" class="form-input" readonly data-quality-field="contact_time_minutes"></label>
      <label class="quality-form-wide">EPI / securite<textarea data-field="safety_instructions" class="form-input" readonly data-quality-field="safety_instructions"></textarea></label>
      <label>Debut<input data-field="started_at" class="form-input" type="datetime-local" data-quality-field="started_at"></label>
      <label>Fin<input data-field="ended_at" class="form-input" type="datetime-local" data-quality-field="ended_at"></label>
      <label>Statut<select data-field="status" class="form-input" data-quality-field="status"><option value="done">Realise</option><option value="partial">Partiel</option><option value="not_done">Non realise</option><option value="issue">Incident</option></select></label>
      <label>Controle visuel<select data-field="visual_check_status" class="form-input" data-quality-field="visual_check_status"><option value="conform">Conforme</option><option value="non_conform">Non conforme</option><option value="not_applicable">Non applicable</option></select></label>
      <label>Origine<input data-field="source_label" class="form-input" readonly></label>
      <label>Operateur<input data-field="operator" class="form-input" readonly data-quality-field="operator"></label>
      <label class="quality-form-wide">Commentaire<textarea data-field="comment" class="form-input" data-quality-field="comment"></textarea></label>
      <label class="quality-form-wide">Anomalie<textarea data-field="anomaly_comment" class="form-input" data-quality-field="anomaly_comment"></textarea></label>
      <label class="quality-form-wide">Action corrective<textarea data-field="corrective_action" class="form-input" data-quality-field="corrective_action"></textarea></label>
      ${evidenceHtml('cleaning')}
      <label class="quality-form-wide">Motif exceptionnel<textarea data-field="exceptional_reason" class="form-input" data-quality-field="exceptional_reason"></textarea></label>
      <div data-field="alert" class="page-feedback hidden quality-form-wide"></div>
      <div class="quality-actions quality-form-wide"><button data-field="submit" class="btn btn-primary" type="submit">Enregistrer</button><button data-field="reset" class="btn btn-secondary" type="button">Reinitialiser</button></div>
    `;

    const field = (name) => form.querySelector(`[data-field="${name}"]`);
    bindEvidencePreview(field);
    field('cleaning_plan_id').innerHTML = optionHtml(plans, 'id', (plan) => plan.title || plan.id, 'Choisir un plan');

    function showAlert(message = '') {
      const alert = field('alert');
      alert.textContent = message;
      alert.className = message ? 'page-feedback error quality-form-wide' : 'page-feedback hidden quality-form-wide';
      if (message && onError) onError(message);
    }

    function selectedPlan() {
      return plans.find((plan) => String(plan.id) === String(field('cleaning_plan_id').value)) || {};
    }

    function fillPlanDetails(plan = selectedPlan()) {
      field('zones').value = targetNames(plan.zones, plan.zone_name);
      field('equipments').value = targetNames(plan.equipments, plan.equipment_name);
      field('method').value = plan.method || '';
      field('product_name').value = plan.product_name || '';
      field('dosage_concentration').value = plan.dosage_concentration || '';
      field('contact_time_minutes').value = plan.contact_time_minutes ? `${plan.contact_time_minutes} min` : '';
      field('safety_instructions').value = plan.safety_instructions || '';
    }

    function setContext(next = {}) {
      context = next || {};
      const plan = context.plan || plans.find((item) => String(item.id) === String(context.cleaning_plan_id || context.plan_id)) || context;
      const hasScheduledLink = Boolean(context.quality_task_id || context.occurrence_id);
      ensureOption(field('cleaning_plan_id'), context.cleaning_plan_id || context.plan_id || plan.id, plan.title || context.title || context.cleaning_plan_id || context.plan_id);
      field('quality_task_id').value = context.quality_task_id || '';
      field('occurrence_id').value = context.occurrence_id || '';
      field('cleaning_plan_id').value = context.cleaning_plan_id || context.plan_id || plan.id || '';
      field('started_at').value = toDatetimeLocal(context.started_at);
      field('ended_at').value = toDatetimeLocal(context.ended_at || context.performed_at);
      field('status').value = context.status || 'done';
      field('visual_check_status').value = context.visual_check_status || 'conform';
      field('source_label').value = hasScheduledLink ? 'Controle planifie' : 'Saisie exceptionnelle';
      field('operator').value = user.email || user.name || 'Utilisateur connecte';
      field('comment').value = context.comment || '';
      field('anomaly_comment').value = context.anomaly_comment || '';
      field('corrective_action').value = context.corrective_action || '';
      field('evidence_photo_id').value = '';
      field('evidence_document_id').value = '';
      field('evidence_photo_file').value = '';
      field('evidence_document_file').value = '';
      field('evidence_photo_preview').textContent = 'Aucune photo selectionnee.';
      field('evidence_document_preview').textContent = 'Aucun document selectionne.';
      field('exceptional_reason').value = context.exceptional_reason || '';
      field('exceptional_reason').closest('label').classList.toggle('hidden', hasScheduledLink);
      setReadonly(field('cleaning_plan_id'), Boolean(context.locked));
      fillPlanDetails(plan);
      applyExceptionalCopy(titleEl, submitEl || field('submit'), hasScheduledLink);
      showAlert('');
    }

    function getPayload() {
      const source = executionSource(field('quality_task_id').value, field('occurrence_id').value);
      return {
        cleaning_plan_id: field('cleaning_plan_id').value,
        quality_task_id: field('quality_task_id').value || null,
        occurrence_id: field('occurrence_id').value || null,
        started_at: field('started_at').value ? new Date(field('started_at').value).toISOString() : null,
        ended_at: field('ended_at').value ? new Date(field('ended_at').value).toISOString() : null,
        performed_at: field('ended_at').value ? new Date(field('ended_at').value).toISOString() : new Date().toISOString(),
        status: field('status').value,
        visual_check_status: field('visual_check_status').value,
        anomaly_comment: field('anomaly_comment').value || null,
        corrective_action: field('corrective_action').value || null,
        evidence_photo_id: field('evidence_photo_id').value || null,
        evidence_document_id: field('evidence_document_id').value || null,
        source,
        exceptional_reason: source === 'exceptional' ? field('exceptional_reason').value || field('comment').value || null : null,
        comment: field('comment').value || null,
      };
    }

    function validate(payload = getPayload()) {
      if (!payload.cleaning_plan_id) return 'Plan de nettoyage obligatoire.';
      if (['not_done', 'issue'].includes(payload.status) && !payload.comment && !payload.anomaly_comment) return 'Une observation est obligatoire pour un nettoyage non conforme ou non realise.';
      return requireExceptionalReason(payload);
    }

    async function submit(event) {
      if (event) event.preventDefault();
      const payload = getPayload();
      const error = validate(payload);
      if (error) return showAlert(error);
      try {
        const plan = selectedPlan();
        const owner = { equipment_id: plan.equipment_id || plan.equipments?.[0]?.id || '', zone_id: plan.zone_id || plan.zones?.[0]?.id || '' };
        await uploadEvidenceFiles({ operationsApi, field, owner, caption: `Preuve nettoyage ${plan.title || payload.cleaning_plan_id}` });
        payload.evidence_photo_id = field('evidence_photo_id').value || null;
        payload.evidence_document_id = field('evidence_document_id').value || null;
        const result = await submitCleaningExecution({ operationsApi, payload });
        if (onSubmitted) await onSubmitted(result, payload);
        return result;
      } catch (error) {
        showAlert(error.message || 'Erreur enregistrement nettoyage');
        return null;
      }
    }

    form.addEventListener('submit', submit);
    field('cleaning_plan_id').addEventListener('change', () => fillPlanDetails());
    field('reset').addEventListener('click', () => setContext({ ended_at: new Date().toISOString() }));
    setContext({ ended_at: new Date().toISOString() });

    return { form, field, getPayload, setContext, submit, validate, fields: CLEANING_FIELDS };
  }

  async function submitTemperatureExecution({ operationsApi, payload }) {
    if (!operationsApi?.executeTemperature) throw new Error('API operationnelle temperature indisponible');
    return operationsApi.executeTemperature(payload);
  }

  async function submitCleaningExecution({ operationsApi, payload }) {
    if (!operationsApi?.executeCleaning) throw new Error('API operationnelle nettoyage indisponible');
    return operationsApi.executeCleaning(payload);
  }

  window.QualityExecutionForms = {
    CLEANING_FIELDS,
    TEMPERATURE_FIELDS,
    applyExceptionalCopy,
    createCleaningExecutionForm,
    createTemperatureExecutionForm,
    executionSource,
    requireExceptionalReason,
    submitCleaningExecution,
    submitTemperatureExecution,
    uploadEvidenceFiles,
  };
})();
