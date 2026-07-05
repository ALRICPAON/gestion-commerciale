(function () {
  const api = window.QualityDigitalTwinApi;
  const sessionUser = JSON.parse(localStorage.getItem('gc_user') || localStorage.getItem('grv2_user') || 'null');
  const authToken = localStorage.getItem('gc_token') || localStorage.getItem('grv2_token');
  if (!sessionUser || !authToken) { window.location.href = '../../login.html'; return; }
  const canManage = window.hasQualityPermission?.(sessionUser, 'quality.equipment.manage');
  const $ = (id) => document.getElementById(id);
  const els = { list: $('zone-list'), feedback: $('zone-feedback'), formCard: $('zone-form-card'), form: $('zone-form'), formTitle: $('zone-form-title'), id: $('zone-id'), code: $('zone-code'), name: $('zone-name'), type: $('zone-form-type'), surface: $('zone-surface'), capacity: $('zone-capacity'), status: $('zone-form-status'), description: $('zone-description'), search: $('zone-search'), filterStatus: $('zone-status'), filterType: $('zone-type'), includeArchived: $('zone-archived'), addBtn: $('zone-add-btn'), cancelBtn: $('zone-cancel-btn') };
  let zones = [];
  function setFeedback(message = '', type = '') { els.feedback.textContent = message; els.feedback.className = message ? `page-feedback ${type}`.trim() : 'page-feedback hidden'; }
  function filters() { return { search: els.search.value, status: els.filterStatus.value, type: els.filterType.value, include_archived: els.includeArchived.checked ? 'true' : '' }; }
  function resetForm() { els.form.reset(); els.id.value = ''; els.status.value = 'active'; els.formTitle.textContent = 'Nouvelle zone'; els.formCard.classList.remove('hidden'); }
  function fillForm(zone) { els.id.value = zone.id; els.code.value = zone.code || ''; els.name.value = zone.name || ''; els.type.value = zone.type || ''; els.surface.value = zone.surface_area || ''; els.capacity.value = zone.capacity || ''; els.status.value = zone.status || 'active'; els.description.value = zone.description || ''; els.formTitle.textContent = `Modifier ${zone.name}`; els.formCard.classList.remove('hidden'); }
  function payload() { return { code: els.code.value, name: els.name.value, type: els.type.value, surface_area: els.surface.value, capacity: els.capacity.value, status: els.status.value, description: els.description.value }; }
  function render() {
    if (!zones.length) { els.list.innerHTML = '<div class="quality-empty-state">Aucune zone qualité trouvée.</div>'; return; }
    els.list.innerHTML = zones.map((zone) => `<article class="quality-card"><span class="quality-badge">${zone.status}</span><h3>${zone.name}</h3><p><strong>${zone.code}</strong> · ${zone.type}</p><p class="quality-muted">${zone.description || ''}</p><p class="quality-muted">Surface : ${zone.surface_area || '-'} m² · Capacité : ${zone.capacity || '-'}</p><div class="quality-actions"><button class="btn btn-secondary" data-action="edit" data-id="${zone.id}">Modifier</button><button class="btn btn-secondary" data-action="inactive" data-id="${zone.id}">Désactiver</button><button class="btn btn-secondary" data-action="archive" data-id="${zone.id}">Archiver</button><button class="btn btn-secondary" data-action="delete" data-id="${zone.id}">Supprimer</button></div></article>`).join('');
    if (!canManage) els.list.querySelectorAll('button').forEach((button) => { button.disabled = true; });
  }
  async function load() { setFeedback('Chargement des zones...'); try { zones = await api.listZones(filters()); setFeedback(''); render(); } catch (error) { setFeedback(error.message, 'error'); } }
  els.addBtn.disabled = !canManage; els.addBtn.addEventListener('click', resetForm); els.cancelBtn.addEventListener('click', () => els.formCard.classList.add('hidden'));
  [els.search, els.filterStatus, els.filterType, els.includeArchived].forEach((el) => { el.addEventListener('input', load); el.addEventListener('change', load); });
  els.form.addEventListener('submit', async (event) => { event.preventDefault(); if (!canManage) return; try { await api.saveZone(payload(), els.id.value || null); els.formCard.classList.add('hidden'); await load(); } catch (error) { setFeedback(error.message, 'error'); } });
  els.list.addEventListener('click', async (event) => { const button = event.target.closest('button[data-action]'); if (!button || !canManage) return; const zone = zones.find((item) => item.id === button.dataset.id); if (!zone) return; if (button.dataset.action === 'edit') return fillForm(zone); if (button.dataset.action === 'delete' && !window.confirm('Supprimer cette zone ? Elle sera archivée si elle est liée à un équipement.')) return; try { if (button.dataset.action === 'inactive') await api.setZoneStatus(zone.id, 'inactive'); if (button.dataset.action === 'archive') await api.setZoneStatus(zone.id, 'archived'); if (button.dataset.action === 'delete') { const result = await api.deleteZone(zone.id); setFeedback(result.message || 'Zone traitée', result.mode === 'archived' ? 'quality-warning' : ''); } await load(); } catch (error) { setFeedback(error.message, 'error'); } });
  load();
})();
