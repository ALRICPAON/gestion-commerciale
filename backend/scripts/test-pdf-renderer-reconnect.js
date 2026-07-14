const { closeSharedBrowserForTest, renderHtmlToPdf } = require('../services/pdf/pdfRenderer');

const html = (step) => `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>Test PDF reconnexion ${step}</title>
</head>
<body>
  <h1>Test PDF reconnexion Puppeteer</h1>
  <p>Generation ${step} reussie avec accents francais : maree, qualite, agrement.</p>
</body>
</html>`;

async function main() {
  try {
    const first = await renderHtmlToPdf(html('1'));
    if (!first || first.length === 0) {
      throw new Error('Premier PDF vide');
    }
    console.log(`[pdfRenderer:test] Premier PDF genere (${first.length} octets)`);

    await closeSharedBrowserForTest();
    console.log('[pdfRenderer:test] Chromium ferme volontairement');

    const second = await renderHtmlToPdf(html('2'));
    if (!second || second.length === 0) {
      throw new Error('Deuxieme PDF vide apres reconnexion');
    }
    console.log(`[pdfRenderer:test] Deuxieme PDF genere apres reconnexion (${second.length} octets)`);
  } finally {
    await closeSharedBrowserForTest();
  }
}

main().catch((err) => {
  console.error('[pdfRenderer:test] Echec test reconnexion PDF', err);
  process.exitCode = 1;
});
