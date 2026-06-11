const API_BASE_URL = window.APP_CONFIG.API_BASE_URL;
const token = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
const sessionUser = JSON.parse(localStorage.getItem('gc_user') || localStorage.getItem('grv2_user') || 'null');
const ALTA_ALERT_STORAGE_KEY = 'alta_intelligence_alert';

if (!token || !sessionUser) window.location.href = './login.html';

const els = {
  user: document.getElementById('user-name'),
  home: document.getElementById('home-btn'),
  logout: document.getElementById('logout-btn'),
  feedback: document.getElementById('ai-feedback'),
  history: document.getElementById('chat-history'),
  form: document.getElementById('chat-form'),
  input: document.getElementById('message-input'),
  send: document.getElementById('send-btn'),
  quickActions: document.querySelectorAll('[data-prompt]'),
};

const conversation = [];

function showFeedback(message = '', type = 'error') {
  els.feedback.textContent = message;
  els.feedback.className = message ? `page-feedback ${type}` : 'page-feedback hidden';
}

function renderMessage(role, content) {
  const article = document.createElement('article');
  article.className = `ai-message ${role === 'assistant' ? 'is-assistant' : 'is-user'}`;
  const meta = document.createElement('div');
  meta.className = 'ai-message-meta';
  meta.textContent = role === 'assistant' ? 'Assistant IA' : 'Vous';

  const body = document.createElement('div');
  body.className = 'ai-message-body';
  String(content || '').split(/\n{2,}/).forEach((paragraph) => {
    const p = document.createElement('p');
    p.textContent = paragraph.trim();
    body.appendChild(p);
  });

  article.appendChild(meta);
  article.appendChild(body);
  els.history.appendChild(article);
  els.history.scrollTop = els.history.scrollHeight;
}

function setLoading(isLoading) {
  els.send.disabled = isLoading;
  els.input.disabled = isLoading;
  els.quickActions.forEach((button) => {
    button.disabled = isLoading;
  });
  els.send.textContent = isLoading ? 'Analyse...' : 'Envoyer';
}

async function askAssistant(question) {
  const cleanQuestion = String(question || '').trim();
  if (!cleanQuestion) return;

  showFeedback('');
  renderMessage('user', cleanQuestion);
  conversation.push({ role: 'user', content: cleanQuestion });
  els.input.value = '';
  setLoading(true);

  try {
    const response = await fetch(`${API_BASE_URL}/api/ai-agent/chat`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        question: cleanQuestion,
        messages: conversation.slice(-12),
      }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || 'Erreur assistant IA');
    }

    const answer = data.answer || "L'assistant n'a pas renvoye de reponse.";
    conversation.push({ role: 'assistant', content: answer });
    renderMessage('assistant', answer);
  } catch (error) {
    showFeedback(error.message || 'Erreur assistant IA');
  } finally {
    setLoading(false);
    els.input.focus();
  }
}

function formatAlertItems(items = []) {
  if (!Array.isArray(items) || items.length === 0) return 'Aucun détail transmis.';

  return items
    .map((item, index) => {
      const parts = [
        item.label,
        item.detail,
        item.reference ? `réf. ${item.reference}` : null,
        item.date ? `date ${item.date}` : null,
      ].filter(Boolean);
      return `${index + 1}. ${parts.join(' - ')}`;
    })
    .join('\n');
}

function buildAlertPrompt(alert) {
  return [
    `Analyse cette alerte du Centre de surveillance : ${alert.title || 'Alerte'}.`,
    `Type : ${alert.id || 'non renseigné'}.`,
    `Niveau : ${alert.level_label || alert.level || 'non renseigné'}.`,
    `Compteur : ${alert.count ?? 0}.`,
    alert.description ? `Description : ${alert.description}.` : null,
    '',
    'Détails :',
    formatAlertItems(alert.items),
    '',
    'Donne-moi les causes possibles et les actions à faire. Ne considère pas que tu as modifié une donnée.',
  ].filter((line) => line !== null).join('\n');
}

function readIncomingAlert() {
  const raw = sessionStorage.getItem(ALTA_ALERT_STORAGE_KEY);
  if (!raw) return null;

  sessionStorage.removeItem(ALTA_ALERT_STORAGE_KEY);

  try {
    const alert = JSON.parse(raw);
    return alert && typeof alert === 'object' ? alert : null;
  } catch (error) {
    console.error('Alerte ALTA invalide :', error);
    return null;
  }
}

function logout() {
  ['gc_token', 'gc_user', 'gc_active_department', 'grv2_token', 'grv2_user', 'grv2_active_department'].forEach((key) => localStorage.removeItem(key));
  window.location.href = './login.html';
}

function init() {
  els.user.textContent = sessionUser.email || 'Utilisateur';
  renderMessage('assistant', "Bonjour, je suis l'Agent IA commercial ALTA MAREE. Je peux analyser les donnees disponibles en lecture seule et proposer des actions a confirmer manuellement.");

  els.home.addEventListener('click', () => {
    window.location.href = './home.html';
  });
  els.logout.addEventListener('click', logout);
  els.form.addEventListener('submit', (event) => {
    event.preventDefault();
    askAssistant(els.input.value);
  });
  els.quickActions.forEach((button) => {
    button.addEventListener('click', () => askAssistant(button.dataset.prompt));
  });

  const incomingAlert = readIncomingAlert();
  if (incomingAlert) {
    askAssistant(buildAlertPrompt(incomingAlert));
  }
}

init();
