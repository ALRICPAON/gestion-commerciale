function createQualityBadge(label = 'Qualité') {
  const badge = document.createElement('span');
  badge.className = 'quality-badge';
  badge.textContent = label;
  return badge;
}

window.createQualityBadge = createQualityBadge;
