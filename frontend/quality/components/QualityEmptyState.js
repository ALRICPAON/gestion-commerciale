function createQualityEmptyState(message = 'Module en cours de construction') {
  const emptyState = document.createElement('div');
  emptyState.className = 'quality-empty-state';
  emptyState.textContent = message;
  return emptyState;
}

window.createQualityEmptyState = createQualityEmptyState;
