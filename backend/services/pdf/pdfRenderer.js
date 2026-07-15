const puppeteer = require('puppeteer');

let browserPromise = null;
let browserInstance = null;

function isRecoverableBrowserError(err) {
  const name = String(err?.name || '');
  const message = String(err?.message || '');
  return [
    'ConnectionClosedError',
    'TargetCloseError',
    'Protocol error',
    'Session closed',
    'Connection closed',
    'Target closed',
    'Browser closed',
    'Page closed',
  ].some((needle) => name.includes(needle) || message.includes(needle));
}

function launchBrowser() {
  console.info('[pdfRenderer] Lancement Chromium pour generation PDF');

  const launchPromise = puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  })
    .then((browser) => {
      browserInstance = browser;
      browser.once('disconnected', () => {
        console.warn('[pdfRenderer] Chromium deconnecte, reinitialisation du navigateur PDF');
        if (browserInstance === browser) {
          browserInstance = null;
          browserPromise = null;
        }
      });
      return browser;
    })
    .catch((err) => {
      console.error('[pdfRenderer] Echec lancement Chromium', err);
      if (browserPromise === launchPromise) {
        browserPromise = null;
      }
      browserInstance = null;
      throw err;
    });

  browserPromise = launchPromise;
  return launchPromise;
}

async function getBrowser() {
  if (browserPromise) {
    const browser = await browserPromise;
    if (browser?.isConnected()) {
      return browser;
    }

    console.warn('[pdfRenderer] Chromium non connecte detecte avant rendu PDF, relance necessaire');
    browserPromise = null;
    browserInstance = null;
  }

  return launchBrowser();
}

async function closeBrowserQuietly(browser, reason) {
  if (!browser) return;
  try {
    if (browser.isConnected()) {
      await browser.close();
    }
  } catch (err) {
    console.warn(`[pdfRenderer] Fermeture Chromium ignoree apres ${reason}`, err.message);
  } finally {
    if (browserInstance === browser) {
      browserInstance = null;
    }
    browserPromise = null;
  }
}

async function closePageQuietly(page) {
  if (!page) return;
  try {
    if (!page.isClosed()) {
      await page.close();
    }
  } catch (err) {
    console.warn('[pdfRenderer] Fermeture page PDF ignoree', err.message);
  }
}

async function closeSharedBrowserForTest() {
  await closeBrowserQuietly(browserInstance, 'test reconnexion PDF');
}

async function renderHtmlToPdf(html, options = {}) {
  return renderHtmlToPdfAttempt(html, options, false);
}

async function renderHtmlToPdfAttempt(html, options = {}, hasRetried = false) {
  let browser = null;
  let page = null;
  try {
    browser = await getBrowser();
    page = await browser.newPage();
    await page.setContent(html, { waitUntil: ['domcontentloaded', 'networkidle0'], timeout: 30000 });
    await page.emulateMediaType('print');
    if (options.beforePdfScript) {
      await page.evaluate((source) => {
        const run = new Function(source);
        run();
      }, options.beforePdfScript);
    }
    return await page.pdf({
      format: options.format || 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: options.margin || { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
    });
  } catch (err) {
    if (!hasRetried && isRecoverableBrowserError(err)) {
      console.warn('[pdfRenderer] Connexion Chromium fermee pendant rendu PDF, relance et retry unique', {
        name: err.name,
        message: err.message,
      });
      await closeBrowserQuietly(browser, 'connexion fermee');
      return renderHtmlToPdfAttempt(html, options, true);
    }

    console.error('[pdfRenderer] Echec definitif generation PDF', {
      name: err.name,
      message: err.message,
      retried: hasRetried,
    });
    throw err;
  } finally {
    await closePageQuietly(page);
  }
}

function sendPdf(res, buffer, filename) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', buffer.length);
  res.send(buffer);
}

module.exports = {
  closeSharedBrowserForTest,
  renderHtmlToPdf,
  sendPdf,
};
