(function () {
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

  window.QualityExecutionForms = {
    applyExceptionalCopy,
    executionSource,
    requireExceptionalReason,
  };
})();
