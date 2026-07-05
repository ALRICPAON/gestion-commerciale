(function () {
  const sessionUser = JSON.parse(localStorage.getItem('gc_user') || localStorage.getItem('grv2_user') || 'null');
  const authToken = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');

  if (!sessionUser || !authToken) {
    window.location.href = '../../login.html';
    return;
  }

  const userNameEl = document.getElementById('user-name');
  const homeBtn = document.getElementById('home-btn');
  const logoutBtn = document.getElementById('logout-btn');

  if (userNameEl) {
    userNameEl.textContent = sessionUser.email || 'Utilisateur';
  }

  if (homeBtn) {
    homeBtn.addEventListener('click', () => {
      window.location.href = '../../home.html';
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem('grv2_token');
      localStorage.removeItem('grv2_user');
      localStorage.removeItem('grv2_active_department');
      localStorage.removeItem('gc_token');
      localStorage.removeItem('gc_user');
      localStorage.removeItem('gc_active_department');
      window.location.href = '../../login.html';
    });
  }
})();
