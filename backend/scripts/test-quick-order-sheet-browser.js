const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const puppeteer = require('puppeteer');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const clients = [
  {
    id: 'client-1',
    code: 'CL001',
    name: 'Restaurant Bleu',
    legal_name: 'Restaurant Bleu',
    city: 'Paris',
    tariff_level: 1,
    store_identifier: 'PAR',
  },
  {
    id: 'client-2',
    code: 'CL002',
    name: 'Comptoir Sud',
    legal_name: 'Comptoir Sud',
    city: 'Lyon',
    tariff_level: 2,
    store_identifier: 'LYO',
  },
];

const products = [
  {
    uid: 'product-1',
    column_uid: 'product-1',
    article_id: 'article-1',
    plu: 'BAR',
    designation: 'Bar ligne',
    family_name: 'Poissons',
    sale_unit: 'kg',
    price_unit: 'kg',
    supplier_available_quantity: 24,
    supplier_id: 'supplier-1',
    purchase_price_ht: 8.5,
    transport_cost_ht: 0.7,
    cost_rendered_ht: 9.2,
    sale_price_level_1_ht: 14,
    sale_price_level_2_ht: 13.5,
    sale_price_level_3_ht: 13,
    pricing_session_id: 'pricing-1',
    pricing_line_id: 'pricing-line-1',
  },
  {
    uid: 'product-2',
    column_uid: 'product-2',
    article_id: 'article-2',
    plu: 'SOL',
    designation: 'Sole portion',
    family_name: 'Poissons',
    sale_unit: 'piece',
    price_unit: 'piece',
    supplier_available_quantity: 18,
    supplier_id: 'supplier-2',
    purchase_price_ht: 6,
    transport_cost_ht: 0.5,
    cost_rendered_ht: 6.5,
    sale_price_level_1_ht: 10,
    sale_price_level_2_ht: 9.5,
    sale_price_level_3_ht: 9,
    pricing_session_id: 'pricing-1',
    pricing_line_id: 'pricing-line-2',
  },
];

const sheet = {
  id: 'sheet-1',
  title: "Fiche d'appel clients",
  date: new Date().toISOString().slice(0, 10),
  notes: 'Arrivage du jour',
  products,
  order_entries: {},
  generated_order_ids: [],
  updated_at: '2026-09-02T08:00:00.000Z',
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
    const apiCalls = [];

    page.on('pageerror', (error) => {
      pageErrors.push({ message: error.message, stack: error.stack });
    });
    page.on('console', (message) => {
      const text = message.text();
      if (message.type() === 'error' && !text.startsWith('Failed to load resource:')) {
        consoleErrors.push(text);
      }
    });
    page.on('requestfailed', (request) => {
      const url = request.url();
      if (url.includes('/api/')) {
        networkErrors.push({ url, failure: request.failure()?.errorText });
      }
    });

    await page.evaluateOnNewDocument((mockClients, mockSheet, mockProducts) => {
      localStorage.setItem('gc_token', 'browser-test-token');
      localStorage.setItem('gc_user', JSON.stringify({ email: 'test@example.test', store_id: 'store-1' }));
      localStorage.setItem('gc_active_department', JSON.stringify({ id: 'dept-1' }));
      window.confirm = () => true;
      window.print = () => {
        window.__printCalled = true;
      };
      window.__apiCalls = [];
      window.fetch = async (url, options = {}) => {
        const rawUrl = String(url);
        const method = options.method || 'GET';
        let body = null;
        try {
          body = options.body ? JSON.parse(options.body) : null;
        } catch (error) {
          body = options.body || null;
        }
        window.__apiCalls.push({ url: rawUrl, method, body });

        if (rawUrl.includes('/api/clients')) {
          return new Response(JSON.stringify(mockClients), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (rawUrl.includes('/api/quick-order-sheets/by-date') && method === 'GET') {
          return new Response(JSON.stringify({ sheet: mockSheet }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (rawUrl.includes('/api/quick-order-sheets/by-date') && method === 'PUT') {
          const updatedSheet = {
            ...mockSheet,
            order_entries: body.entries,
            products: body.products,
            notes: body.notes,
            updated_at: '2026-09-02T09:00:00.000Z',
          };
          return new Response(JSON.stringify({ sheet: updatedSheet }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (rawUrl.includes('/api/articles')) {
          return new Response(JSON.stringify(mockProducts), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (rawUrl.includes('/api/quick-order-sheets/generate-orders')) {
          return new Response(JSON.stringify({ order_ids: ['order-1'], orders: [{ id: 'order-1', reference_number: 'CMD-1' }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
    }, clients, sheet, products);

    const htmlPath = path.resolve(__dirname, '../../frontend/quick-order-sheet.html');
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#primary-list [data-id]', { timeout: 5000 });

    await page.click('#client-view-btn');
    assert.strictEqual(await page.$eval('#selector-title', (node) => node.textContent.trim()), 'Clients');

    await page.click('#article-view-btn');
    assert.strictEqual(await page.$eval('#selector-title', (node) => node.textContent.trim()), 'Articles');

    await page.click('#client-view-btn');
    await page.type('#primary-search-input', 'Bleu');
    await page.click('#primary-list [data-id="client-1"]');
    assert.match(await page.$eval('#entry-title', (node) => node.textContent), /Restaurant Bleu/);

    await page.type('#secondary-search-input', 'Bar');
    await page.$eval('input[data-client-id="client-1"][data-product-uid="product-1"][data-field="colis"]', (input) => {
      input.value = '2';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.$eval('input[data-client-id="client-1"][data-product-uid="product-1"][data-field="kg"]', (input) => {
      input.value = '3.5';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.$eval('input[data-client-id="client-1"][data-product-uid="product-1"][data-field="pieces"]', (input) => {
      input.value = '4';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await page.click('#article-view-btn');
    await page.waitForSelector('#primary-list [data-id="product-1"]', { timeout: 5000 });
    await page.type('#primary-search-input', 'Bar');
    await page.click('#primary-list [data-id="product-1"]');
    assert.match(await page.$eval('#entry-title', (node) => node.textContent), /Bar ligne/);
    await page.type('#secondary-search-input', 'Bleu');

    await sleep(900);
    apiCalls.push(...await page.evaluate(() => window.__apiCalls));
    const autosaveCall = apiCalls.find((call) => call.url.includes('/api/quick-order-sheets/by-date') && call.method === 'PUT');
    assert(autosaveCall, 'Autosave PUT not observed');
    const autosavedProduct = autosaveCall.body.products.find((product) => product.uid === 'product-1');
    assert.strictEqual(autosavedProduct.supplier_id, 'supplier-1');
    assert.strictEqual(autosavedProduct.purchase_price_ht, 8.5);
    assert.strictEqual(autosavedProduct.transport_cost_ht, 0.7);
    assert.strictEqual(autosavedProduct.cost_rendered_ht, 9.2);

    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#primary-list [data-id]', { timeout: 5000 });

    await page.click('#add-out-of-tariff-btn');
    await page.waitForSelector('#article-modal:not(.hidden)', { timeout: 5000 });
    await page.type('#article-search-input', 'sole');
    await page.click('#article-search-btn');
    await page.waitForSelector('#article-results [data-result-index]', { timeout: 5000 });
    await page.click('#close-article-modal-btn');
    await page.waitForSelector('#article-modal.hidden', { timeout: 5000 });

    await page.click('#print-sheet-btn');
    assert.strictEqual(await page.evaluate(() => window.__printCalled === true), true);
    assert(await page.$('#print-table-wrap table'), 'Printable table was not rendered');

    if (pageErrors.length || consoleErrors.length || networkErrors.length) {
      throw new Error(JSON.stringify({ pageErrors, consoleErrors, networkErrors }, null, 2));
    }
    console.log('quick-order-sheet browser runtime test passed');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
