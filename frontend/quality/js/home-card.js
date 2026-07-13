(function () {
  const sessionUser = JSON.parse(localStorage.getItem('gc_user') || localStorage.getItem('grv2_user') || 'null');
  const homeContent = document.querySelector('.home-content');

  if (!sessionUser || !homeContent || document.querySelector('[data-module="quality"]')) {
    return;
  }

  const canReadQuality = window.hasQualityPermission
    ? window.hasQualityPermission(sessionUser, 'quality.read') || window.hasQualityPermission(sessionUser, 'quality.document.read')
    : sessionUser.role === 'admin' || sessionUser.role === 'responsable';

  if (!canReadQuality) {
    return;
  }

  const section = document.createElement('section');
  section.className = 'home-section';
  section.setAttribute('aria-labelledby', 'quality-title');
  section.innerHTML = `
    <div class="home-section-header">
      <span class="section-kicker">Q</span>
      <h2 id="quality-title">Qualité</h2>
    </div>
    <div class="dashboard-grid home-module-grid">
      <a class="module-card" href="./quality/pages/dashboard.html" data-module="quality">
        <span class="module-icon" aria-hidden="true">QMS</span>
        <h3>Qualité</h3>
        <p>Module en cours de construction.</p>
      </a>
      <a class="module-card" href="./quality/pages/documentation.html" data-module="quality-documentation">
        <span class="module-icon" aria-hidden="true">DOC</span>
        <h3>Documentation QualitÃ©</h3>
        <p>Dossier d'agrÃ©ment, PMS, HACCP, procÃ©dures, annexes et export PDF.</p>
      </a>
    </div>
  `;

  const administrationSection = document.getElementById('administration-title')?.closest('.home-section');
  homeContent.insertBefore(section, administrationSection || null);
})();
