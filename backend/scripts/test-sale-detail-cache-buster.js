const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'frontend', 'sale-detail.html'), 'utf8');

assert(html.includes('./css/pages/sale-detail.css?v=5'), 'sale-detail.html doit charger sale-detail.css?v=5');
assert(html.includes('./js/sale-detail.js?v=20'), 'sale-detail.html doit charger sale-detail.js?v=20');
assert(html.includes('./js/sale-stock-negative-flow.js?v=5'), 'sale-detail.html doit charger sale-stock-negative-flow.js?v=5');
assert(!html.includes('./js/sale-detail.js?v=18'), 'sale-detail.html ne doit plus charger sale-detail.js?v=18');
assert(!html.includes('./js/sale-detail.js?v=19'), 'sale-detail.html ne doit plus charger sale-detail.js?v=19');

console.log(JSON.stringify({ ok: true, css: './css/pages/sale-detail.css?v=5', script: './js/sale-detail.js?v=20' }, null, 2));
