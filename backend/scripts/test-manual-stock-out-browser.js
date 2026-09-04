const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const puppeteer = require('puppeteer');

const ARTICLE_ID = '22222222-2222-4222-8222-222222222222';
const LOT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

async function main() {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });

    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.stack || error.message));
    page.on('console', (message) => {
      const text = message.text();
      if (message.type() === 'error' && !text.startsWith('Failed to load resource:')) consoleErrors.push(text);
    });

    await page.evaluateOnNewDocument((articleId, lotId) => {
      localStorage.setItem('gc_token', 'browser-test-token');
      localStorage.setItem('gc_user', JSON.stringify({ email: 'stock@example.test', store_id: '11111111-1111-4111-8111-111111111111' }));
      window.confirm = () => true;
      window.__manualOutCalls = [];
      window.fetch = async (url, options = {}) => {
        const rawUrl = String(url);
        const method = options.method || 'GET';
        const body = options.body ? JSON.parse(options.body) : null;

        if (rawUrl.includes('/api/stock/manual-outs/reasons')) {
          return new Response(JSON.stringify({
            reasons: [
              { code: 'waste', label: 'Casse / perte', movement_type: 'waste_out' },
              { code: 'other', label: 'Autre', movement_type: 'manual_stock_out' },
            ],
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (rawUrl.includes('/api/stock/manual-outs') && method === 'GET') {
          return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (rawUrl.includes('/api/stock/manual-outs') && method === 'POST') {
          window.__manualOutCalls.push(body);
          return new Response(JSON.stringify({
            ok: true,
            movement: { id: '10000000-0000-4000-8000-000000000001', quantity: -2 },
            lot: { id: lotId, qty_remaining: 3 },
          }), { status: 201, headers: { 'Content-Type': 'application/json' } });
        }
        if (rawUrl.includes(`/api/stock/articles/${articleId}/lots`)) {
          return new Response(JSON.stringify([
            {
              id: lotId,
              article_id: articleId,
              lot_code: 'LOT-A',
              qty_initial: 5,
              qty_remaining: 5,
              unit_cost_ex_vat: 10,
              unit: 'kg',
            },
          ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (rawUrl.includes('/api/stock?')) {
          return new Response(JSON.stringify([
            {
              id: 'summary-1',
              article_id: articleId,
              plu: 'ART',
              designation: 'Langoustine 25/35',
              unit: 'kg',
              stock_quantity: 5,
              stock_value_ex_vat: 50,
              pma: 10,
            },
          ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
    }, ARTICLE_ID, LOT_ID);

    const htmlPath = path.resolve(__dirname, '../../frontend/stock.html');
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle0' });
    await page.waitForSelector(`button[data-action="manual-out"][data-article-id="${ARTICLE_ID}"]`, { timeout: 5000 });
    await page.click(`button[data-action="manual-out"][data-article-id="${ARTICLE_ID}"]`);
    await page.waitForSelector('#manual-stock-out-modal:not(.hidden)', { timeout: 5000 });
    await page.$eval('#manual-stock-out-quantity', (input) => {
      input.value = '2';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.select('#manual-stock-out-reason', 'waste');
    await page.type('#manual-stock-out-comment', 'Casse test');
    await page.click('#submit-manual-stock-out-btn');
    await page.waitForFunction(() => window.__manualOutCalls.length === 1, { timeout: 5000 });

    const payload = await page.evaluate(() => window.__manualOutCalls[0]);
    assert.strictEqual(payload.article_id, ARTICLE_ID);
    assert.strictEqual(payload.lot_id, LOT_ID);
    assert.strictEqual(payload.quantity, 2);
    assert.strictEqual(payload.reason, 'waste');
    assert.match(await page.$eval('#manual-stock-out-feedback', (node) => node.textContent), /Nouveau stock disponible : 3/);

    if (pageErrors.length || consoleErrors.length) {
      throw new Error(JSON.stringify({ pageErrors, consoleErrors }, null, 2));
    }
    console.log('OK manual stock out browser');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
