(function () {
  function fileLabel(file, emptyLabel) {
    return file ? `${file.name} - ${Math.round(file.size / 1024)} Ko` : emptyLabel;
  }

  function bindPreview({ photoInput, photoPreview, documentInput, documentPreview }) {
    photoInput?.addEventListener('change', () => {
      if (photoPreview) photoPreview.textContent = fileLabel(photoInput.files?.[0], 'Aucune photo selectionnee.');
    });
    documentInput?.addEventListener('change', () => {
      if (documentPreview) documentPreview.textContent = fileLabel(documentInput.files?.[0], 'Aucun document selectionne.');
    });
  }

  function ownerFromContext(context = {}) {
    const equipmentId = context.equipment_id || context.equipmentId || '';
    const zoneId = context.zone_id || context.zoneId || '';
    return {
      equipment_id: equipmentId,
      zone_id: zoneId,
      task_id: context.task_id || context.quality_task_id || '',
      occurrence_id: context.occurrence_id || '',
      source_entity_type: context.source_entity_type || '',
      source_entity_id: context.source_entity_id || context.parameter_id || context.cleaning_plan_id || '',
    };
  }

  function appendOwner(formData, owner = {}) {
    ['equipment_id', 'zone_id', 'task_id', 'occurrence_id', 'source_entity_type', 'source_entity_id'].forEach((key) => {
      if (owner[key]) formData.append(key, owner[key]);
    });
  }

  async function uploadAll({ operationsApi, photoInput, documentInput, owner, caption, documentName }) {
    const uploaded = { photo: null, document: null };
    const photo = photoInput?.files?.[0] || null;
    const document = documentInput?.files?.[0] || null;
    if (photo) {
      const body = new FormData();
      body.append('file', photo);
      appendOwner(body, owner);
      body.append('caption', caption || 'Preuve operationnelle qualite');
      uploaded.photo = await operationsApi.uploadEvidencePhoto(body);
    }
    if (document) {
      const body = new FormData();
      body.append('file', document);
      appendOwner(body, owner);
      body.append('name', documentName || document.name || 'Preuve operationnelle qualite');
      uploaded.document = await operationsApi.uploadEvidenceDocument(body);
    }
    return {
      uploaded,
      evidence_photo_id: uploaded.photo?.evidence_photo_id || uploaded.photo?.photo?.id || '',
      evidence_document_id: uploaded.document?.evidence_document_id || uploaded.document?.document?.id || '',
    };
  }

  async function cleanupUploaded({ operationsApi, uploaded }) {
    const photoId = uploaded?.photo?.evidence_photo_id || uploaded?.photo?.photo?.id || null;
    const documentId = uploaded?.document?.evidence_document_id || uploaded?.document?.document?.id || null;
    await Promise.all([
      photoId ? operationsApi.deleteEvidencePhoto(photoId).catch(() => null) : null,
      documentId ? operationsApi.deleteEvidenceDocument(documentId).catch(() => null) : null,
    ]);
  }

  window.QualityProofUploader = {
    bindPreview,
    cleanupUploaded,
    ownerFromContext,
    uploadAll,
  };
})();
