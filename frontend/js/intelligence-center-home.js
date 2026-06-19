const intelligenceToken = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
const intelligenceGrid = document.getElementById('intelligence-alerts-grid');
const intelligenceFeedback = document.getElementById('intelligence-center-feedback');
const intelligenceRefreshBtn = document.getElementById('refresh-intelligence-btn');

const VISIBLE_INTELLIGENCE_ALERTS = new Set([
  'loss_sales',
  'low_margins',
  'dlc_soon',
  'dlc_expired',
  'negative_stock',
]);

function levelLabel(level) {
  if (level === 'red') return 'Critique';
  if (level === 'orange') return 'Attention';
  return 'OK';
}

function setIntelligenceFeedback(message = '', type = 'error') {
  if (!intelligenceFeedback) return;
  intelligenceFeedback.textContent = message;
  intelligenceFeedback.className = message ? `page-feedback ${type}` : 'page-feedback hidden';
}

function renderAlert(alert) {
  const card = document.createElement('article');
  card.className = `intelligence-card level-${alert.level || 'green'}`;

  const header = document.createElement('div');
  header.className = 'intelligence-card-header';

  const title = document.createElement('h3');
  title.textContent = alert.title;
  const badge = document.createElement('span');
  badge.className = 'intelligence-level';
  badge.textContent = levelLabel(alert.level);
  header.append(title, badge);

  const count = document.createElement('strong');
  count.className = 'intelligence-count';
  count.textContent = String(alert.count || 0);

  const description = document.createElement('p');
  description.textContent = alert.available === false ? 'Données non disponibles pour le moment.' : alert.description;

  const actions = document.createElement('div');
  actions.className = 'intelligence-actions';

  const view = document.createElement('a');
  view.className = 'btn btn-secondary btn-sm';
  view.href = alert.view_url || '#';
  view.textContent = 'Voir';

  actions.append(view);
  card.append(header, count, description, actions);
  return card;
}

async function loadIntelligenceCenter() {
  if (!intelligenceGrid || !intelligenceToken) return;
  setIntelligenceFeedback('');
  intelligenceGrid.innerHTML = '<div class="intelligence-loading">Chargement du centre de surveillance...</div>';

  try {
    const response = await fetch(`${window.APP_CONFIG.API_BASE_URL}/api/intelligence-center`, {
      headers: { Authorization: `Bearer ${intelligenceToken}` },
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || 'Erreur centre de surveillance');
    }

    const alerts = Array.isArray(data.alerts)
      ? data.alerts.filter((alert) => VISIBLE_INTELLIGENCE_ALERTS.has(alert.id))
      : [];
    intelligenceGrid.innerHTML = '';
    alerts.forEach((alert) => intelligenceGrid.appendChild(renderAlert(alert)));

    if (alerts.length === 0) {
      intelligenceGrid.innerHTML = '<div class="intelligence-loading">Aucune alerte prioritaire disponible.</div>';
    }
  } catch (error) {
    intelligenceGrid.innerHTML = '';
    setIntelligenceFeedback(error.message || 'Erreur centre de surveillance');
  }
}

if (intelligenceRefreshBtn) {
  intelligenceRefreshBtn.addEventListener('click', loadIntelligenceCenter);
}

loadIntelligenceCenter();
