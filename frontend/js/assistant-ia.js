const API_BASE_URL = window.APP_CONFIG.API_BASE_URL;
const token = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
const sessionUser = JSON.parse(localStorage.getItem('gc_user') || localStorage.getItem('grv2_user') || 'null');
const ALTA_PENDING_AI_PROMPT_KEY = 'alta_pending_ai_prompt';

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

async function runPendingAutoAnalysis() {
  const pendingPrompt = sessionStorage.getItem(ALTA_PENDING_AI_PROMPT_KEY);
  if (!pendingPrompt) {
    console.log('[ALTA AI] no pending prompt');
    return;
  }

  console.log('[ALTA AI] pending prompt found');
  sessionStorage.removeItem(ALTA_PENDING_AI_PROMPT_KEY);
  console.log('[ALTA AI] sending auto analysis');
  await askAssistant(pendingPrompt);
  console.log('[ALTA AI] auto analysis done');
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

  runPendingAutoAnalysis();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
