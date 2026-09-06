const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'frontend', 'sale-detail.html'), 'utf8');

assert(html.includes('./js/sale-detail.js?v=19'), 'sale-detail.html doit charger sale-detail.js?v=19');
assert(!html.includes('./js/sale-detail.js?v=18'), 'sale-detail.html ne doit plus charger sale-detail.js?v=18');

console.log(JSON.stringify({ ok: true, script: './js/sale-detail.js?v=19' }, null, 2));
