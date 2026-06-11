const intelligenceToken = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
const intelligenceGrid = document.getElementById('intelligence-alerts-grid');
const intelligenceFeedback = document.getElementById('intelligence-center-feedback');
const intelligenceRefreshBtn = document.getElementById('refresh-intelligence-btn');
const ALTA_ALERT_STORAGE_KEY = 'alta_intelligence_alert';

function levelLabel(level) {
  if (level === 'red') return 'Rouge';
  if (level === 'orange') return 'Orange';
  return 'Vert';
}

function setIntelligenceFeedback(message = '', type = 'error') {
  if (!intelligenceFeedback) return;
  intelligenceFeedback.textContent = message;
  intelligenceFeedback.className = message ? `page-feedback ${type}` : 'page-feedback hidden';
}

function alertForAlta(alert) {
  return {
    id: alert.id,
    title: alert.title,
    level: alert.level,
    level_label: levelLabel(alert.level),
    count: alert.count || 0,
    description: alert.description,
    prompt: alert.alta_prompt || `Analyse l'alerte ${alert.title}`,
    items: (alert.items || []).slice(0, 10),
  };
}

function openAlertWithAlta(alert) {
  try {
    sessionStorage.setItem(ALTA_ALERT_STORAGE_KEY, JSON.stringify(alertForAlta(alert)));
  } catch (error) {
    console.error('Impossible de préparer l’alerte pour ALTA :', error);
  }

  window.location.href = './assistant-ia.html?from=intelligence-center';
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

  const analyze = document.createElement('button');
  analyze.className = 'btn btn-primary btn-sm';
  analyze.type = 'button';
  analyze.textContent = 'Analyser avec ALTA';
  analyze.addEventListener('click', () => openAlertWithAlta(alert));

  actions.append(view, analyze);
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

    const alerts = Array.isArray(data.alerts) ? data.alerts : [];
    intelligenceGrid.innerHTML = '';
    alerts.forEach((alert) => intelligenceGrid.appendChild(renderAlert(alert)));

    if (alerts.length === 0) {
      intelligenceGrid.innerHTML = '<div class="intelligence-loading">Aucune alerte disponible.</div>';
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
