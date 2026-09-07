const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const puppeteer = require('puppeteer');

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    const pageErrors = [];
    const consoleErrors = [];
    const apiCalls = [];

    page.on('pageerror', (error) => pageErrors.push({ message: error.message, stack: error.stack }));
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
        consoleErrors.push(message.text());
      }
    });

    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('gc_token', 'browser-test-token');
      localStorage.setItem('gc_user', JSON.stringify({
        email: 'test@example.test',
        store_id: 'store-1',
        departments: [{ id: 'dept-1', name: 'Vente', code: 'VEN' }],
      }));
      localStorage.setItem('gc_active_department', JSON.stringify({ id: 'dept-1', name: 'Vente', code: 'VEN' }));

      let savedUnitPrice = 21.9;
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

        if (rawUrl.includes('/api/clients/client-1/affiliates')) {
          return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (rawUrl.includes('/api/clients?status=active')) {
          return new Response(JSON.stringify([{
            id: 'client-1',
            name: 'Restaurant Bleu',
            tariff_level: 1,
            vat_rate: 5.5,
            is_vat_exempt: false,
          }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (rawUrl.includes('/api/sales/sale-1') && method === 'GET') {
          return new Response(JSON.stringify({
            sale: {
              id: 'sale-1',
              client_id: 'client-1',
              client_name: 'Restaurant Bleu',
              client_tariff_level: 1,
              client_vat_rate: 5.5,
              client_is_vat_exempt: false,
              document_date: '2026-09-06',
              document_type: 'ORDER',
              status: 'draft',
              origin: 'quick_order_sheet',
              reference_number: 'CMD-TEST',
              notes: '',
            },
            lines: [{
              id: 'line-1',
              article_id: 'article-1',
              article_plu: 'BAR',
              article_label: 'Bar',
              package_count: 1,
              weight_per_package: 1,
              total_weight: 1,
              sold_quantity: 1,
              sale_unit: 'kg',
              unit_sale_price_ht: savedUnitPrice,
              vat_rate: 5.5,
              line_amount_ht: savedUnitPrice,
              line_amount_ttc: Number((savedUnitPrice * 1.055).toFixed(2)),
              line_status: 'pending',
              traceability_snapshot: {},
            }],
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (rawUrl.includes('/api/sales/lines/line-1') && method === 'PATCH') {
          savedUnitPrice = body.unit_sale_price_ht;
          return new Response(JSON.stringify({
            ok: true,
            line: {
              id: 'line-1',
              unit_sale_price_ht: savedUnitPrice,
              line_amount_ht: savedUnitPrice,
              line_amount_ttc: Number((savedUnitPrice * 1.055).toFixed(2)),
            },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
    });

    const htmlPath = path.resolve(__dirname, '../../frontend/sale-detail.html');
    await page.goto(`${pathToFileURL(htmlPath).href}?id=sale-1`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('tr[data-line-id="line-1"] .line-unit-price-ht', { timeout: 5000 });

    const initialPrice = await page.$eval('tr[data-line-id="line-1"] .line-unit-price-ht', (input) => input.value);
    assert.strictEqual(Number(initialPrice), 21.9);

    await page.$eval('tr[data-line-id="line-1"] .line-unit-price-ht', (input) => {
      input.value = '22.90';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.click('tr[data-line-id="line-1"] [data-action="save-line"]');
    await page.waitForFunction(() => window.__apiCalls.some((call) => call.url.includes('/api/sales/lines/line-1') && call.method === 'PATCH'));

    const patch = await page.evaluate(() => window.__apiCalls.find((call) => call.url.includes('/api/sales/lines/line-1') && call.method === 'PATCH'));
    assert.strictEqual(patch.body.unit_sale_price_ht, 22.9);
    assert.strictEqual(patch.body.manual_price_override, true);

    await page.waitForFunction(() => Number(document.querySelector('tr[data-line-id="line-1"] .line-unit-price-ht')?.value) === 22.9);
    const refreshedPrice = await page.$eval('tr[data-line-id="line-1"] .line-unit-price-ht', (input) => input.value);
    assert.strictEqual(Number(refreshedPrice), 22.9);

    assert.deepStrictEqual(pageErrors, []);
    assert.deepStrictEqual(consoleErrors, []);
    apiCalls.push(...await page.evaluate(() => window.__apiCalls));
    assert(apiCalls.some((call) => call.url.includes('/api/sales/sale-1') && call.method === 'GET'), 'sale-detail doit etre recharge apres sauvegarde');

    console.log(JSON.stringify({ ok: true, patch: patch.body, refreshed_price: Number(refreshedPrice) }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
