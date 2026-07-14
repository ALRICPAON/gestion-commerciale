const assert = require('assert');

const router = require('../routes/quality');
const zonesRoutes = require('../routes/quality/zones');
const equipmentsRoutes = require('../routes/quality/equipments');
const documentationRoutes = require('../routes/quality/documentation');

assert(router && Array.isArray(router.stack), 'Le routeur Qualite doit demarrer');

const mountedRouters = router.stack.filter((layer) => layer.name === 'router' && layer.handle?.stack);

function mountedOnce(label, predicate) {
  const count = mountedRouters.filter(predicate).length;
  assert.strictEqual(count, 1, `${label} doit etre monte une seule fois`);
}

mountedOnce('zones', (layer) => layer.handle === zonesRoutes);
mountedOnce('equipements', (layer) => layer.handle === equipmentsRoutes);
mountedOnce('documentation', (layer) => layer.handle === documentationRoutes);

const documentationRouter = documentationRoutes;
assert(documentationRouter && Array.isArray(documentationRouter.stack), 'Le routeur Documentation doit etre charge');

const documentationRoutePaths = documentationRouter.stack
  .filter((layer) => layer.route)
  .map((layer) => layer.route.path);

assert(documentationRoutePaths.includes('/default'), 'Documentation /default doit etre montee');
assert(documentationRoutePaths.includes('/sections/:sectionId/tables'), 'CRUD tableaux par chapitre doit etre monte');
assert(documentationRoutePaths.includes('/tables/template-library'), 'Bibliotheque tableaux doit etre montee');
assert(documentationRoutePaths.includes('/diagrams/template-library'), 'Bibliotheque diagrammes doit rester montee');

console.log('quality router startup tests ok');
