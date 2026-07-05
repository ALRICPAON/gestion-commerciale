function createQualityCard({ title = 'Qualité', text = '', status = '' } = {}) {
  const card = document.createElement('article');
  card.className = 'quality-card';

  const heading = document.createElement('h3');
  heading.textContent = title;
  card.appendChild(heading);

  if (text) {
    const body = document.createElement('p');
    body.textContent = text;
    card.appendChild(body);
  }

  if (status) {
    const badge = document.createElement('span');
    badge.className = 'quality-badge';
    badge.textContent = status;
    card.appendChild(badge);
  }

  return card;
}

window.createQualityCard = createQualityCard;
