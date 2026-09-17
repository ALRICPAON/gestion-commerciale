const assert = require('assert');
const fs = require('fs');
const path = require('path');

const frontend = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'js', 'transport.js'), 'utf8');

assert(frontend.includes('async function openAuthenticatedPdf(url)'), 'transport dispatch must define authenticated PDF opener');
assert(frontend.includes('Authorization: `Bearer ${token}`'), 'authenticated PDF opener must send bearer token');
assert(frontend.includes('URL.createObjectURL(blob)'), 'authenticated PDF opener must open a blob URL');
assert(frontend.includes('URL.revokeObjectURL(objectUrl)'), 'authenticated PDF opener must release blob URL');
assert(frontend.includes('Ouvrir bon de commande'), 'preparation UI must expose a clear order PDF button');
assert(frontend.includes('data-action="open-preparation-order"'), 'preparation order button must use JS action');
assert(frontend.includes('preparation_order_url'), 'preparation UI must use the explicit order PDF URL field');
assert(!frontend.includes('document_url ? `<a href="${API_BASE_URL}'), 'preparation PDF must not be a direct API href');
assert(!/window\.open\(\s*`?\$\{?API_BASE_URL\}?\/api\/pdf-documents/.test(frontend), 'protected PDF API route must not be opened directly');

console.log('transport dispatch frontend static tests ok');
