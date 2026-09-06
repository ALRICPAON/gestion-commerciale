const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const puppeteer = require('puppeteer');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setCacheEnabled(false);
    await page.setViewport({ width: 1366, height: 768 });

    const pageErrors = [];
    const consoleErrors = [];

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
      window.__apiCalls = [];
      window.__patches = [];

      const state = {
        line: {
          id: 'line-1',
          article_id: '',
          article_plu: '',
          article_label: '',
          selected_lot_id: null,
          package_count: 0,
          weight_per_package: 0,
          total_weight: 0,
          sold_quantity: 0,
          sale_unit: 'kg',
          unit_sale_price_ht: 0,
          vat_rate: 5.5,
          line_amount_ht: 0,
          line_amount_ttc: 0,
          line_status: 'pending',
          traceability_snapshot: {},
        },
      };

      const sale = {
        id: 'sale-1',
        client_id: 'client-1',
        client_name: 'Restaurant Bleu',
        client_tariff_level: 1,
        client_vat_rate: 5.5,
        client_is_vat_exempt: false,
        document_date: '2026-09-06',
        document_type: 'ORDER',
        status: 'draft',
        origin: 'manual',
        reference_number: 'CMD-TEST',
        notes: '',
      };

      const article = {
        id: 'article-1',
        article_id: 'article-1',
        plu: 'BAR',
        designation: 'Bar de ligne',
        sale_unit: 'kg',
        unit: 'kg',
        sale_price_level_1_ht: 21.9,
        sale_price_ex_vat: 21.9,
        stock_quantity: 12,
        lot_code: 'LOT-A',
        supplier_lot_number: 'SUP-A',
        next_dlc: '2026-10-10',
      };

      const lot = {
        id: 'lot-1',
        lot_code: 'LOT-A',
        supplier_lot_number: 'SUP-A',
        qty_remaining: 12,
        dlc: '2026-10-10',
        latin_name: 'Dicentrarchus labrax',
        fao_zone: '27',
        sous_zone: 'VII',
        fishing_gear: 'Chalut',
        production_method: 'Pêche',
        allergens: 'Poisson',
      };

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
          return new Response(JSON.stringify([{ id: 'client-1', name: 'Restaurant Bleu', tariff_level: 1, vat_rate: 5.5, is_vat_exempt: false }]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (rawUrl.includes('/api/sales/sale-1') && method === 'GET') {
          return new Response(JSON.stringify({ sale, lines: [state.line] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (rawUrl.includes('/api/articles/search')) {
          return new Response(JSON.stringify([article]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (rawUrl.includes('/api/stock/lots')) {
          return new Response(JSON.stringify([lot]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (rawUrl.includes('/api/sales/lines/line-1') && method === 'PATCH') {
          window.__patches.push(body);
          await new Promise((resolve) => setTimeout(resolve, 120));
          state.line = {
            ...state.line,
            ...body,
            selected_lot_id: body.selected_lot_id,
            unit_sale_price_ht: body.unit_sale_price_ht,
            line_amount_ht: Number((body.total_weight * body.unit_sale_price_ht).toFixed(2)),
            line_amount_ttc: Number((body.total_weight * body.unit_sale_price_ht * 1.055).toFixed(2)),
            traceability_snapshot: body.selected_lot_id ? lot : {},
          };
          return new Response(JSON.stringify({ ok: true, line: state.line }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
    });

    const htmlPath = path.resolve(__dirname, '../../frontend/sale-detail.html');
    await page.goto(`${pathToFileURL(htmlPath).href}?id=sale-1`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('tr[data-line-id="line-1"] .line-plu', { timeout: 5000 });

    await page.type('tr[data-line-id="line-1"] .line-plu', 'BAR');
    await page.$eval('tr[data-line-id="line-1"] .line-plu', (input) => input.dispatchEvent(new Event('blur', { bubbles: true })));
    await page.waitForFunction(() => document.querySelector('tr[data-line-id="line-1"]')?.dataset.articleId === 'article-1');

    await page.click('tr[data-line-id="line-1"] [data-action="choose-lot"]');
    await page.waitForSelector('#lot-modal:not(.hidden) tr[data-lot-id="lot-1"]', { timeout: 5000 });
    await page.evaluate(() => {
      window.__lotBodyClicks = 0;
      document.querySelector('#lot-modal-table-body')?.addEventListener('click', () => {
        window.__lotBodyClicks += 1;
      });
    });
    await page.$eval('#lot-modal tr[data-lot-id="lot-1"] td', (cell) => cell.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await sleep(250);
    const incompleteState = await page.evaluate(() => ({
      feedback: document.querySelector('#sale-lines-feedback')?.textContent || '',
      selectedLotId: document.querySelector('tr[data-line-id="line-1"]')?.dataset.selectedLotId || '',
      lotButtonText: document.querySelector('tr[data-line-id="line-1"] .line-lot-btn')?.textContent || '',
      patches: window.__patches.length,
      clickCount: window.__lotBodyClicks,
      lotRows: [...document.querySelectorAll('#lot-modal tr[data-lot-id]')].map((row) => ({ id: row.dataset.lotId, text: row.textContent })),
    }));
    assert(
      incompleteState.feedback.includes('Complétez la ligne'),
      `selection lot incomplete doit afficher un message clair: ${JSON.stringify(incompleteState)}`
    );
    assert.strictEqual(await page.evaluate(() => window.__patches.length), 0, 'ligne incomplete ne doit pas etre autosauvegardee');
    assert.match(await page.$eval('#sale-lines-feedback', (node) => node.textContent), /Complétez la ligne/);
    assert.match(await page.$eval('tr[data-line-id="line-1"] .line-lot-btn', (button) => button.textContent), /LOT-A/);

    await page.$eval('tr[data-line-id="line-1"] .line-package-count', (input) => {
      input.value = '2';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.$eval('tr[data-line-id="line-1"] .line-weight-per-package', (input) => {
      input.value = '3';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.$eval('tr[data-line-id="line-1"] .line-unit-price-ht', (input) => {
      input.value = '22.90';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await page.click('tr[data-line-id="line-1"] [data-action="choose-lot"]');
    await page.waitForSelector('#lot-modal:not(.hidden) tr[data-lot-id="lot-1"]', { timeout: 5000 });
    await page.$eval('#lot-modal tr[data-lot-id="lot-1"] td', (cell) => {
      cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page.waitForFunction(() => window.__patches.length === 1);
    await sleep(250);
    assert.strictEqual(await page.evaluate(() => window.__patches.length), 1, 'selection lot double-action ne doit sauvegarder qu une fois');

    const autoPatch = await page.evaluate(() => window.__patches[0]);
    assert.strictEqual(autoPatch.selected_lot_id, 'lot-1');
    assert.strictEqual(autoPatch.unit_sale_price_ht, 22.9);
    assert.strictEqual(autoPatch.manual_price_override, true);
    assert.strictEqual(autoPatch.package_count, 2);
    assert.strictEqual(autoPatch.weight_per_package, 3);
    assert.strictEqual(autoPatch.total_weight, 6);

    await page.waitForFunction(() => document.querySelector('tr[data-line-id="line-1"]')?.dataset.selectedLotId === 'lot-1');
    assert.match(await page.$eval('tr[data-line-id="line-1"] .line-lot-btn', (button) => button.textContent), /LOT-A/);
    assert.strictEqual(Number(await page.$eval('tr[data-line-id="line-1"] .line-package-count', (input) => input.value)), 2);
    assert.strictEqual(Number(await page.$eval('tr[data-line-id="line-1"] .line-weight-per-package', (input) => input.value)), 3);
    assert.strictEqual(Number(await page.$eval('tr[data-line-id="line-1"] .line-total-weight', (input) => input.value)), 6);
    assert.strictEqual(Number(await page.$eval('tr[data-line-id="line-1"] .line-unit-price-ht', (input) => input.value)), 22.9);
    assert.match(await page.$eval('tr[data-line-id="line-1"] .trace-cell', (cell) => cell.title), /Dicentrarchus labrax/);

    await page.click('tr[data-line-id="line-1"] [data-action="save-line"]');
    await page.waitForFunction(() => window.__patches.length === 2);
    assert.strictEqual(await page.evaluate(() => window.__patches.length), 2, 'bouton OK doit rester une sauvegarde manuelle explicite');

    for (const viewport of [
      { width: 1366, height: 768 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewport(viewport);
      const metrics = await page.evaluate(() => ({
        bodyScrollWidth: document.documentElement.scrollWidth,
        bodyClientWidth: document.documentElement.clientWidth,
        tableWidth: document.querySelector('.sale-lines-table')?.getBoundingClientRect().width || 0,
        wrapWidth: document.querySelector('.sale-lines-wrap')?.getBoundingClientRect().width || 0,
        actionsRight: document.querySelector('.sale-lines-table td:nth-child(14)')?.getBoundingClientRect().right || 0,
        viewportWidth: window.innerWidth,
      }));
      assert(metrics.bodyScrollWidth <= metrics.bodyClientWidth + 1, `pas de scroll horizontal global a ${viewport.width}px`);
      assert(metrics.tableWidth >= 1200, `tableau trop etroit a ${viewport.width}px`);
      assert(metrics.wrapWidth >= viewport.width - 40, `tableau ne prend pas la largeur utile a ${viewport.width}px: ${JSON.stringify(metrics)}`);
      assert(metrics.actionsRight <= metrics.viewportWidth + 2, `actions non accessibles a ${viewport.width}px`);
    }

    assert.deepStrictEqual(pageErrors, []);
    assert.deepStrictEqual(consoleErrors, []);

    console.log(JSON.stringify({ ok: true, autosave_patches: await page.evaluate(() => window.__patches.length), viewports: [1366, 1440, 1920] }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
