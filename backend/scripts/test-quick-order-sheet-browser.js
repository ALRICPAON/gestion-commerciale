const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const puppeteer = require('puppeteer');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function uuid(prefix, index) {
  return `${prefix}0000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

const clients = Array.from({ length: 200 }, (_, index) => ({
  id: uuid('c', index + 1),
  code: `CL${String(index + 1).padStart(4, '0')}`,
  name: `Client ${index + 1}`,
  legal_name: `Client ${index + 1}`,
  city: index % 2 ? 'Lyon' : 'Paris',
  tariff_level: (index % 3) + 1,
  store_identifier: `S${index + 1}`,
}));

const products = Array.from({ length: 100 }, (_, index) => {
  const noSupplier = index === 5;
  const supplierNumber = (index % 3) + 1;
  return {
    uid: `product-${index + 1}`,
    column_uid: `product-${index + 1}`,
    article_id: uuid('a', index + 1),
    plu: `PLU${String(index + 1).padStart(4, '0')}`,
    designation: index === 0 ? 'Homard europeen 600/800' : index === 1 ? 'Langoustine 30/40' : `Article ${index + 1}`,
    family_name: 'Maree',
    sale_unit: index % 4 === 0 ? 'piece' : 'kg',
    price_unit: index % 4 === 0 ? 'piece' : 'kg',
    supplier_available_quantity: 100 + index,
    supplier_id: noSupplier ? null : uuid('f', supplierNumber),
    supplier_code: noSupplier ? '' : `FOU${supplierNumber}`,
    supplier_name: noSupplier ? '' : `Fournisseur ${supplierNumber}`,
    purchase_price_ht: 8 + index / 10,
    transport_cost_ht: 0.7,
    cost_rendered_ht: 8.7 + index / 10,
    sale_price_level_1_ht: 14 + index / 10,
    sale_price_level_2_ht: 13 + index / 10,
    sale_price_level_3_ht: 12 + index / 10,
    pricing_session_id: 'pricing-1',
    pricing_line_id: `pricing-line-${index + 1}`,
    display_order: index + 1,
  };
});

const articleSearchResults = [
  {
    id: uuid('a', 999),
    plu: 'SPECIAL',
    designation: 'Article special hors tarif',
    sale_unit: 'kg',
    unit: 'kg',
  },
];

const sheet = {
  id: uuid('s', 1),
  title: "Fiche d'appel clients",
  date: new Date().toISOString().slice(0, 10),
  sheet_date: new Date().toISOString().slice(0, 10),
  notes: 'Arrivage du jour',
  products,
  order_entries: {},
  generated_order_ids: [],
  updated_at: '2026-09-07T08:00:00.000Z',
};

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });

    const pageErrors = [];
    const consoleErrors = [];
    const networkErrors = [];

    page.on('pageerror', (error) => {
      pageErrors.push({ message: error.message, stack: error.stack });
    });
    page.on('console', (message) => {
      const text = message.text();
      if (message.type() === 'error' && !text.startsWith('Failed to load resource:') && !text.includes('network ambiguity')) {
        consoleErrors.push(text);
      }
    });
    page.on('requestfailed', (request) => {
      const url = request.url();
      if (url.includes('/api/')) {
        networkErrors.push({ url, failure: request.failure()?.errorText });
      }
    });

    await page.evaluateOnNewDocument((mockClients, mockSheet, mockArticles) => {
      const clone = (value) => JSON.parse(JSON.stringify(value));
      const byteLength = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
      localStorage.setItem('gc_token', 'browser-test-token');
      localStorage.setItem('gc_user', JSON.stringify({ email: 'test@example.test', store_id: 'store-1' }));
      localStorage.setItem('gc_active_department', JSON.stringify({ id: 'dept-1' }));
      window.confirm = () => true;
      window.prompt = () => '22.90';
      window.print = () => {
        window.__printCalled = true;
      };
      window.__apiCalls = [];
      window.__patchSizes = JSON.parse(localStorage.getItem('__qos_patch_sizes') || '[]');
      const storedSheet = localStorage.getItem('__qos_server_sheet');
      window.__serverSheet = storedSheet ? JSON.parse(storedSheet) : clone(mockSheet);
      const persistServerSheet = () => {
        localStorage.setItem('__qos_server_sheet', JSON.stringify(window.__serverSheet));
      };
      window.__failNextEntriesPatch = false;
      window.fetch = async (url, options = {}) => {
        const rawUrl = String(url);
        const method = options.method || 'GET';
        let body = null;
        try {
          body = options.body ? JSON.parse(options.body) : null;
        } catch (error) {
          body = options.body || null;
        }
        window.__apiCalls.push({ url: rawUrl, method, body, bytes: options.body ? byteLength(body) : 0 });

        if (rawUrl.includes('/api/clients')) {
          return new Response(JSON.stringify(mockClients), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (rawUrl.includes('/api/quick-order-sheets/by-date') && method === 'GET') {
          return new Response(JSON.stringify({ sheet: window.__serverSheet }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (rawUrl.includes('/api/quick-order-sheets/by-date') && method === 'PUT') {
          return new Response(JSON.stringify({ error: 'full PUT forbidden in incremental autosave test' }), { status: 413, headers: { 'Content-Type': 'application/json' } });
        }
        if (rawUrl.includes('/api/quick-order-sheets/') && rawUrl.includes('/entries') && method === 'PATCH') {
          window.__patchSizes.push(options.body ? byteLength(body) : 0);
          localStorage.setItem('__qos_patch_sizes', JSON.stringify(window.__patchSizes));
          if (window.__failNextEntriesPatch) {
            window.__failNextEntriesPatch = false;
            return new Response(JSON.stringify({ error: 'network ambiguity' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
          }
          for (const entry of body.entries || []) {
            if (!window.__serverSheet.order_entries[entry.client_id]) window.__serverSheet.order_entries[entry.client_id] = {};
            const hasValue = Number(String(entry.colis || 0).replace(',', '.')) > 0
              || Number(String(entry.kg || 0).replace(',', '.')) > 0
              || Number(String(entry.pieces || 0).replace(',', '.')) > 0;
            if (hasValue) {
              window.__serverSheet.order_entries[entry.client_id][entry.column_uid] = {
                colis: entry.colis || '',
                kg: entry.kg || '',
                pieces: entry.pieces || '',
              };
            } else {
              delete window.__serverSheet.order_entries[entry.client_id][entry.column_uid];
            }
          }
          window.__serverSheet.updated_at = new Date().toISOString();
          persistServerSheet();
          return new Response(JSON.stringify({ ok: true, sheet_id: window.__serverSheet.id, updated_entries: body.entries.length, order_entries: window.__serverSheet.order_entries }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (rawUrl.includes('/api/quick-order-sheets/') && rawUrl.includes('/metadata') && method === 'PATCH') {
          window.__serverSheet.notes = body.notes || '';
          window.__serverSheet.updated_at = new Date().toISOString();
          persistServerSheet();
          return new Response(JSON.stringify({ ok: true, sheet: { id: window.__serverSheet.id, notes: window.__serverSheet.notes, updated_at: window.__serverSheet.updated_at } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (rawUrl.includes('/api/quick-order-sheets/') && rawUrl.includes('/products/out-of-tariff') && method === 'POST') {
          const product = { ...body.product, supplier_id: null, supplier_code: '', supplier_name: '', out_of_tariff: true };
          window.__serverSheet.products.push(product);
          persistServerSheet();
          return new Response(JSON.stringify({ ok: true, product, sheet: window.__serverSheet }), { status: 201, headers: { 'Content-Type': 'application/json' } });
        }
        if (rawUrl.includes('/api/articles')) {
          return new Response(JSON.stringify(mockArticles), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (rawUrl.includes('/api/quick-order-sheets/generate-orders')) {
          window.__lastGenerateRequest = { body, bytes: options.body ? byteLength(body) : 0 };
          return new Response(JSON.stringify({ order_ids: ['order-1'], orders: [{ id: 'order-1', reference_number: 'CMD-1' }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
    }, clients, sheet, articleSearchResults);

    const htmlPath = path.resolve(__dirname, '../../frontend/quick-order-sheet.html');
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#primary-list [data-id]', { timeout: 5000 });

    await page.click('#client-view-btn');
    assert.strictEqual(await page.$eval('#selector-title', (node) => node.textContent.trim()), 'Clients');
    await page.type('#primary-search-input', 'Client 1');
    await page.click('#primary-list [data-id]');
    assert.match(await page.$eval('#entry-title', (node) => node.textContent), /Client/);

    await page.type('#secondary-search-input', 'Homard');
    await page.evaluate(() => {
      window.__apiCalls = [];
      window.__lastGenerateRequest = null;
    });
    await page.$eval('input[data-product-uid="product-1"][data-field="colis"]', (input) => {
      input.value = '2';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.$eval('input[data-product-uid="product-1"][data-field="kg"]', (input) => {
      input.value = '3.5';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.click('#generate-orders-btn');
    await sleep(300);

    let calls = await page.evaluate(() => window.__apiCalls);
    let entryPatches = calls.filter((call) => call.url.includes('/entries') && call.method === 'PATCH');
    assert(entryPatches.length >= 1, 'Autosave PATCH entries not observed');
    assert(entryPatches[0].bytes < 1024, `One-cell autosave too large: ${entryPatches[0].bytes}`);
    assert(entryPatches[0].body.entries.some((entry) => entry.column_uid === 'product-1' && entry.kg === '3.5'), 'Generate flush must save latest dirty quantity');
    assert(!('clients' in entryPatches[0].body), 'Incremental autosave must not send clients');
    assert(!('products' in entryPatches[0].body), 'Incremental autosave must not send products');
    assert(!calls.some((call) => call.url.includes('/api/quick-order-sheets/by-date') && call.method === 'PUT'), 'Autosave must not use full PUT');
    const generateCallIndex = calls.findIndex((call) => call.url.includes('/generate-orders') && call.method === 'POST');
    const patchCallIndex = calls.findIndex((call) => call.url.includes('/entries') && call.method === 'PATCH');
    assert(generateCallIndex > patchCallIndex, 'Generate must run after dirty entries flush');
    const generateCall = calls[generateCallIndex];
    assert(generateCall.bytes < 200, `Generate payload too large: ${generateCall.bytes}`);
    assert.strictEqual(generateCall.body.sheet_id, sheet.id);
    assert.strictEqual(generateCall.body.confirm_generate, true);
    assert.strictEqual(generateCall.body.force_regenerate, false);
    assert(!('clients' in generateCall.body), 'Generate must not send clients');
    assert(!('products' in generateCall.body), 'Generate must not send products');
    assert(!('order_entries' in generateCall.body), 'Generate must not send order_entries');
    assert(!('entries' in generateCall.body), 'Generate must not send entries');

    await page.click('#article-view-btn');
    await page.waitForSelector('#primary-list [data-id="product-1"]', { timeout: 5000 });
    assert.strictEqual(await page.$eval('#selector-title', (node) => node.textContent.trim()), 'Articles');
    await page.type('#primary-search-input', 'Homard');
    await page.click('#primary-list [data-id="product-1"]');
    await page.type('#secondary-search-input', 'Client 1');

    await page.evaluate(() => {
      window.__failNextEntriesPatch = true;
      window.__apiCalls = [];
    });
    await page.$eval('#secondary-search-input', (input) => {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.$eval('input[data-client-id="c0000000-0000-4000-8000-000000000002"][data-product-uid="product-1"][data-field="kg"]', (input) => {
      input.value = '12';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.click('#generate-orders-btn');
    await sleep(300);
    calls = await page.evaluate(() => window.__apiCalls);
    assert(calls.some((call) => call.url.includes('/entries') && call.method === 'PATCH'), 'Failed PATCH should be attempted');
    assert(!calls.some((call) => call.url.includes('/generate-orders') && call.method === 'POST'), 'Generate must be blocked when flush fails');
    assert.match(await page.$eval('#page-feedback', (node) => node.textContent), /certaines saisies ne sont pas encore enregistrees/);
    await page.$eval('input[data-client-id="c0000000-0000-4000-8000-000000000003"][data-product-uid="product-1"][data-field="kg"]', (input) => {
      input.value = '16';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(900);
    calls = await page.evaluate(() => window.__apiCalls);
    const retryPatch = calls.filter((call) => call.url.includes('/entries') && call.method === 'PATCH').at(-1);
    assert(retryPatch.body.entries.some((entry) => entry.client_id.endsWith('000000000002')), 'Retry must preserve failed dirty cell');
    assert(retryPatch.body.entries.some((entry) => entry.client_id.endsWith('000000000003')), 'Retry must include the new dirty cell');

    await page.evaluate(() => {
      window.__apiCalls = [];
    });
    await page.click('#client-view-btn');
    await page.$eval('#secondary-search-input', (input) => {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForSelector('input[data-field="kg"]', { timeout: 5000 });
    await page.$$eval('input[data-field="kg"]', (inputs) => {
      inputs.slice(0, 20).forEach((input, index) => {
        input.value = String(1 + index / 10);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });
    await sleep(900);
    calls = await page.evaluate(() => window.__apiCalls);
    const batchPatch = calls.find((call) => call.url.includes('/entries') && call.method === 'PATCH');
    assert(batchPatch, '20-cell batch PATCH not observed');
    assert(batchPatch.body.entries.length >= 20, '20 quick edits should be batched');
    assert(batchPatch.bytes < 10000, `20-cell batch too large: ${batchPatch.bytes}`);

    await page.$eval('#sheet-note-input', (input) => {
      input.value = 'Note fournisseur persistante';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(900);
    calls = await page.evaluate(() => window.__apiCalls);
    const metadataPatch = calls.find((call) => call.url.includes('/metadata') && call.method === 'PATCH');
    assert(metadataPatch, 'Metadata PATCH not observed');
    assert(metadataPatch.bytes < 512, `Metadata PATCH too large: ${metadataPatch.bytes}`);

    await page.$eval('#supplier-view-btn', (button) => button.click());
    await page.waitForSelector('#selector-title', { timeout: 5000 });
    assert.strictEqual(await page.$eval('#selector-title', (node) => node.textContent.trim()), 'Fournisseurs');
    await page.type('#primary-search-input', 'Fournisseur 1');
    await page.click('#primary-list [data-id]');
    assert.match(await page.$eval('#entry-title', (node) => node.textContent), /Fournisseur 1/);
    assert.match(await page.$eval('#entry-table-wrap', (node) => node.textContent), /Homard europeen/);
    await page.click('.supplier-detail summary');
    assert.match(await page.$eval('.supplier-detail-list', (node) => node.textContent), /Client/);

    await page.click('#add-out-of-tariff-btn').catch(() => {});
    await page.click('#client-view-btn');
    await page.click('#add-out-of-tariff-btn');
    await page.waitForSelector('#article-modal:not(.hidden)', { timeout: 5000 });
    await page.type('#article-search-input', 'special');
    await page.click('#article-search-btn');
    await page.waitForSelector('#article-results [data-result-index]', { timeout: 5000 });
    await page.click('#article-results [data-result-index]');
    await sleep(300);
    calls = await page.evaluate(() => window.__apiCalls);
    const outOfTariffCall = calls.find((call) => call.url.includes('/products/out-of-tariff') && call.method === 'POST');
    assert(outOfTariffCall, 'Out-of-tariff POST not observed');
    assert(!('clients' in outOfTariffCall.body), 'Out-of-tariff add must not send clients');
    assert(!('entries' in outOfTariffCall.body), 'Out-of-tariff add must not send entries matrix');

    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#primary-list [data-id]', { timeout: 5000 });
    assert.strictEqual(await page.$eval('#sheet-note-input', (node) => node.value), 'Note fournisseur persistante');
    const serverEntries = await page.evaluate(() => window.__serverSheet.order_entries);
    assert(serverEntries['c0000000-0000-4000-8000-000000000002']);

    await page.click('#client-view-btn');
    await page.click('#article-view-btn');
    await page.click('#supplier-view-btn');
    await page.$eval('#primary-search-input', (input) => {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.click('[data-filter="all"]');
    assert.match(await page.$eval('#primary-list', (node) => node.textContent), /Sans fournisseur/);

    await page.click('#print-sheet-btn');
    assert.strictEqual(await page.evaluate(() => window.__printCalled === true), true);
    assert(await page.$('#print-table-wrap table'), 'Printable table was not rendered');

    if (pageErrors.length || consoleErrors.length || networkErrors.length) {
      throw new Error(JSON.stringify({ pageErrors, consoleErrors, networkErrors }, null, 2));
    }
    const payloadSizes = await page.evaluate(() => window.__patchSizes);
    console.log(`quick-order-sheet browser incremental autosave test passed; PATCH sizes=${payloadSizes.join(',')}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
