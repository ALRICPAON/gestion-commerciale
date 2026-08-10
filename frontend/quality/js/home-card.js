(function () {
  const sessionUser = JSON.parse(localStorage.getItem('gc_user') || localStorage.getItem('grv2_user') || 'null');
  const homeContent = document.querySelector('.home-content');

  if (!sessionUser || !homeContent) {
    return;
  }

  const isPrivileged = ['admin', 'responsable'].includes(sessionUser.role);

  const canReadQuality = window.hasQualityPermission
    ? window.hasQualityPermission(sessionUser, 'quality.read') || window.hasQualityPermission(sessionUser, 'quality.document.read')
    : isPrivileged;
  const canReadSupplies = window.hasQualityPermission
    ? window.hasQualityPermission(sessionUser, 'supplies_materials.read') || isPrivileged
    : isPrivileged;

  if (!canReadQuality && !canReadSupplies) {
    return;
  }

  let section = document.getElementById('quality-title')?.closest('.home-section');
  let grid = section?.querySelector('.home-module-grid');
  if (!section || !grid) {
    section = document.createElement('section');
    section.className = 'home-section';
    section.setAttribute('aria-labelledby', 'quality-title');
    section.innerHTML = `
      <div class="home-section-header">
        <span class="section-kicker">Q</span>
        <h2 id="quality-title">Qualité</h2>
      </div>
      <div class="dashboard-grid home-module-grid"></div>
    `;
    grid = section.querySelector('.home-module-grid');
    const administrationSection = document.getElementById('administration-title')?.closest('.home-section');
    homeContent.insertBefore(section, administrationSection || null);
  }

  const cards = [
    canReadQuality && !grid.querySelector('[data-module="quality"]') ? `<a class="module-card" href="./quality/pages/dashboard.html" data-module="quality">
        <span class="module-icon" aria-hidden="true">QMS</span>
        <h3>Qualité</h3>
        <p>Module en cours de construction.</p>
      </a>` : '',
    canReadQuality && !grid.querySelector('[data-module="quality-documentation"]') ? `<a class="module-card" href="./quality/pages/documentation.html" data-module="quality-documentation">
        <span class="module-icon" aria-hidden="true">DOC</span>
        <h3>Documentation Qualité</h3>
        <p>Dossier d'agrément, PMS, HACCP, procédures, annexes et export PDF.</p>
      </a>` : '',
    canReadSupplies && !grid.querySelector('[data-module="supplies-materials"]') ? `<a class="module-card" href="./supplies-materials.html" data-module="supplies-materials">
        <span class="module-icon" aria-hidden="true">FM</span>
        <h3>Fournitures & matériels</h3>
        <p>Consommables, emballages, EPI et petits matériels reliés au PMS.</p>
      </a>` : '',
  ].filter(Boolean);
  if (cards.length) grid.insertAdjacentHTML('beforeend', cards.join(''));
})();
