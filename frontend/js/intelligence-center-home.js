const intelligenceToken = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
const intelligenceGrid = document.getElementById('intelligence-alerts-grid');
const intelligenceFeedback = document.getElementById('intelligence-center-feedback');
const intelligenceRefreshBtn = document.getElementById('refresh-intelligence-btn');
const ALTA_PENDING_AI_PROMPT_KEY = 'alta_pending_ai_prompt';
const ALTA_PENDING_AI_ALERT_PAYLOAD_KEY = 'alta_pending_ai_alert_payload';

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

function formatAlertDetail(item) {
  const parts = [
    item.label,
    item.detail,
    item.reference ? `ref. ${item.reference}` : null,
    item.date ? `date ${item.date}` : null,
  ].filter(Boolean);

  return `- ${parts.join(' - ') || 'Détail non renseigné'}`;
}

function buildAltaPrompt(alert) {
  const details = Array.isArray(alert.items) && alert.items.length > 0
    ? alert.items.slice(0, 10).map(formatAlertDetail).join('\n')
    : '- Aucun détail transmis par le Centre de surveillance.';

  return [
    'Analyse cette alerte du Centre de surveillance ALTA MARÉE :',
    `Type : ${alert.title || alert.id || 'Alerte non renseignée'}`,
    `Niveau : ${levelLabel(alert.level).toLowerCase()}`,
    `Nombre : ${alert.count || 0}`,
    alert.description ? `Description : ${alert.description}` : null,
    'Détails :',
    details,
    'Donne-moi les causes probables, les risques et les actions concrètes à faire.',
    'Si c est pertinent, propose aussi les clients à relancer et les produits à vendre en priorité.',
  ].filter(Boolean).join('\n');
}

function openAlertWithAlta(alert) {
  try {
    sessionStorage.setItem(ALTA_PENDING_AI_PROMPT_KEY, buildAltaPrompt(alert));
    sessionStorage.setItem(ALTA_PENDING_AI_ALERT_PAYLOAD_KEY, JSON.stringify(alert));
  } catch (error) {
    console.error('Impossible de préparer l’alerte pour ALTA :', error);
  }

  window.location.href = './assistant-ia.html?autoAnalyze=1';
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
