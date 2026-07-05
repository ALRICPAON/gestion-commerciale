function createQualityScore(value = null) {
  const score = document.createElement('div');
  score.className = 'quality-score';
  score.textContent = value === null ? '-' : String(value);
  return score;
}

window.createQualityScore = createQualityScore;
