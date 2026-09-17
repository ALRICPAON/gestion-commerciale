const assert = require('assert');
const fs = require('fs');
const path = require('path');

const frontend = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'js', 'transport.js'), 'utf8');
const deliveryColumnsIndex = frontend.indexOf('const deliveryColumns = [');
const preparationColumnsIndex = frontend.indexOf('const prepColumns = [');
const deliveryButtonIndex = frontend.indexOf('data-action="open-delivery-note"');
const orderButtonIndex = frontend.indexOf('data-action="open-preparation-order"');

assert(frontend.includes('async function openAuthenticatedPdf(url)'), 'transport dispatch must define authenticated PDF opener');
assert(frontend.includes('Authorization: `Bearer ${token}`'), 'authenticated PDF opener must send bearer token');
assert(frontend.includes('URL.createObjectURL(blob)'), 'authenticated PDF opener must open a blob URL');
assert(frontend.includes('URL.revokeObjectURL(objectUrl)'), 'authenticated PDF opener must release blob URL');
assert(frontend.includes('function openDeliveryNotePdf(id)'), 'delivery note PDF helper must be explicit');
assert(frontend.includes('function openSaleOrderPdf(id)'), 'sale order PDF helper must be explicit');
assert(frontend.includes('/api/pdf-documents/delivery-notes/${encodeURIComponent(id)}/pdf'), 'delivery note helper must use the delivery note route');
assert(frontend.includes('/api/pdf-documents/sales/${encodeURIComponent(id)}/pdf'), 'sale order helper must use the sale order route');
assert(frontend.includes('Ouvrir BL'), 'client delivery UI must expose a clear delivery note button');
assert(frontend.includes('Ouvrir bon de commande'), 'preparation UI must expose a clear order PDF button');
assert(frontend.includes('data-action="open-delivery-note"'), 'delivery note button must use its dedicated JS action');
assert(frontend.includes('data-action="open-preparation-order"'), 'preparation order button must use JS action');
assert(deliveryColumnsIndex < deliveryButtonIndex && deliveryButtonIndex < preparationColumnsIndex, 'delivery note button must only be rendered in client deliveries');
assert(preparationColumnsIndex < orderButtonIndex, 'sale order button must be rendered in preparations');
assert(frontend.includes('data-source-order-id='), 'preparation order button must carry the resolved order id');
assert(frontend.includes("openDeliveryNotePdf(button.dataset.sourceId)"), 'delivery note action must pass the document id to the BL helper');
assert(frontend.includes("openSaleOrderPdf(button.dataset.sourceOrderId)"), 'order action must pass only the resolved order id');
assert(!/openDeliveryNotePdf\(button\.dataset\.sourceOrderId\)/.test(frontend), 'delivery note buttons must never use an order id');
assert(!/openSaleOrderPdf\(button\.dataset\.sourceId\)/.test(frontend), 'order buttons must never send an unresolved document id');
assert(!frontend.includes('document_url ? `<a href="${API_BASE_URL}'), 'preparation PDF must not be a direct API href');
assert(!/window\.open\(\s*`?\$\{?API_BASE_URL\}?\/api\/pdf-documents/.test(frontend), 'protected PDF API route must not be opened directly');
assert(!/token[^\n]*(delivery-notes|sales)|(?:delivery-notes|sales)[^\n]*token/.test(frontend), 'PDF routes must never include the token in the URL');

console.log('transport dispatch frontend static tests ok');
