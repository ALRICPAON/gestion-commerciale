const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const puppeteer = require('puppeteer');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const session0809 = {
  id: 'session-0809',
  pricing_date: '2026-09-08',
  status: 'draft',
  version_number: 1,
  is_active_publication: false,
};

const line0809 = {
  id: 'line-0809',
  pricing_session_id: 'session-0809',
  article_id: 'article-1',
  plu_snapshot: 'HOM',
  designation_snapshot: 'Homard europeen 600/800',
  supplier_id: 'supplier-1',
  supplier_name: 'Fournisseur 1',
  purchase_price_ht: 14,
  transport_cost_ht: 0.5,
  cost_rendered_ht: 14.5,
  sale_unit: 'kg',
  price_unit: 'kg',
  tariffs: [{ tariff_level_id: 'tariff-1', legacy_level: 1, price_ht: 21.9 }],
};

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', (error) => pageErrors.push({ message: error.message, stack: error.stack }));
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) consoleErrors.push(message.text());
    });

    await page.evaluateOnNewDocument((session, line) => {
      localStorage.setItem('gc_token', 'pricing-test-token');
      localStorage.setItem('gc_user', JSON.stringify({ email: 'test@example.test', store_id: 'store-1' }));
      window.__apiCalls = [];
      window.fetch = async (url, options = {}) => {
        const rawUrl = String(url);
        const method = options.method || 'GET';
        const body = options.body ? JSON.parse(options.body) : null;
        window.__apiCalls.push({ url: rawUrl, method, body });

        if (rawUrl.includes('/api/suppliers')) return new Response(JSON.stringify([{ id: 'supplier-1', name: 'Fournisseur 1' }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        if (rawUrl.includes('/api/pricing/tariff-levels')) return new Response(JSON.stringify({ results: [{ id: 'tariff-1', legacy_level: 1, name: 'Tarif 1' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        if (rawUrl.includes('/api/pricing/sessions?')) {
          const requestedDate = new URL(rawUrl, window.location.href).searchParams.get('date');
          if (requestedDate === '2026-09-08') return new Response(JSON.stringify({ results: [session] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          return new Response(JSON.stringify({ results: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (rawUrl.includes('/api/pricing/sessions/session-0809') && method === 'GET') {
          return new Response(JSON.stringify({ exists: true, session, lines: [line] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (rawUrl.includes('/api/pricing/sessions/duplicate') && method === 'POST') {
          const created = { ...session, id: `session-${body.pricing_date}`, pricing_date: body.pricing_date, status: 'draft' };
          return new Response(JSON.stringify({ exists: true, session: created, lines: [{ ...line, id: `line-${body.pricing_date}`, pricing_session_id: created.id }], duplicated_line_count: 1 }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (rawUrl.includes('/api/pricing/lines/') && method === 'PATCH') {
          return new Response(JSON.stringify({ ...line, id: rawUrl.split('/').pop(), tariffs: body.tariffs }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (rawUrl.includes('/api/pricing/sessions/') && rawUrl.includes('/publish') && method === 'POST') {
          return new Response(JSON.stringify({ exists: true, session: { ...session, status: 'published', is_active_publication: true }, lines: [line], mirror: { sheet_id: 'sheet-0809' } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
    }, session0809, line0809);

    const htmlPath = path.resolve(__dirname, '../../frontend/pricing.html');
    await page.goto(`${pathToFileURL(htmlPath).href}?date=2026-09-08`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#pricing-lines-body [data-line-id="line-0809"]', { timeout: 5000 });
    assert.equal(await page.$eval('#pricing-date-input', (input) => input.value), '2026-09-08');

    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#pricing-lines-body [data-line-id="line-0809"]', { timeout: 5000 });
    assert.equal(await page.$eval('#pricing-date-input', (input) => input.value), '2026-09-08');

    await page.$eval('#pricing-lines-body [data-tariff-level-id="tariff-1"]', (input) => {
      input.value = '22.90';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(1300);
    let calls = await page.evaluate(() => window.__apiCalls);
    const patch = calls.find((call) => call.url.includes('/api/pricing/lines/line-0809') && call.method === 'PATCH');
    assert(patch, 'autosave 08/09 line PATCH missing');
    assert.equal(patch.body.tariffs[0].price_ht, '22.90');
    assert(!calls.some((call) => JSON.stringify(call).includes('2026-09-07') && call.method !== 'GET'), 'autosave future date must not write into 07/09');

    await page.$eval('#pricing-date-input', (input) => {
      input.value = '2026-09-10';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(300);
    await page.click('#duplicate-session-btn');
    await page.waitForSelector('#pricing-lines-body [data-line-id="line-2026-09-10"]', { timeout: 5000 });
    calls = await page.evaluate(() => window.__apiCalls);
    const duplicate = calls.find((call) => call.url.includes('/api/pricing/sessions/duplicate') && call.method === 'POST');
    assert.equal(duplicate.body.pricing_date, '2026-09-10');

    const publishDisabled = await page.$eval('#publish-btn', (button) => button.disabled);
    assert.equal(publishDisabled, false, 'future draft publication button must remain enabled');

    if (pageErrors.length || consoleErrors.length) {
      throw new Error(JSON.stringify({ pageErrors, consoleErrors }, null, 2));
    }
    console.log('OK pricing future date browser');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
