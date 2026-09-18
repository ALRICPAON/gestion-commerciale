const assert = require('assert');
const fs = require('fs');
const path = require('path');

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
assert(documentationRoutePaths.includes('/sections/:sectionId/attachments'), 'Upload multipart des pieces jointes doit etre monte');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const corsIndex = serverSource.indexOf('app.use(cors(corsOptions))');
const qualityIndex = serverSource.indexOf("app.use('/api/quality', qualityRoutes)");
const errorIndex = serverSource.indexOf('app.use((err, req, res, next) =>');
assert(corsIndex >= 0 && corsIndex < qualityIndex, 'CORS doit etre applique avant le routeur Qualite');
assert(errorIndex > qualityIndex, 'Le gestionnaire d erreurs doit rester apres le routeur Qualite');

console.log('quality router startup tests ok');
