const puppeteer = require('puppeteer');

let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    });
  }
  return browserPromise;
}

async function renderHtmlToPdf(html, options = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: ['domcontentloaded', 'networkidle0'], timeout: 30000 });
    await page.emulateMediaType('print');
    return await page.pdf({
      format: options.format || 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: options.margin || { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
    });
  } finally {
    await page.close();
  }
}

function sendPdf(res, buffer, filename) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', buffer.length);
  res.send(buffer);
}

module.exports = {
  renderHtmlToPdf,
  sendPdf,
};
