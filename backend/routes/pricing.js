const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const { PDFParse } = require('pdf-parse');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { requireAdminOrManager } = require('../middleware/authorization');
const pricing = require('../services/pricingService');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function context(req) {
  return { user_id: req.user?.id || null, source: 'ui' };
}

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function logPricingRouteError(req, error, action, extra = {}) {
  const status = error.status || 500;
  if (status < 500) return;
  console.error('Erreur route pricing', {
    action,
    endpoint: `${req.method} ${req.originalUrl || req.path}`,
    import_line_id: extra.import_line_id || req.params?.lineId || null,
    store_id: req.user?.store_id || null,
    article_id: extra.article_id || req.body?.article_id || null,
    pg_code: error.code || null,
    constraint: error.constraint || null,
    message: error.message || 'Erreur inattendue',
  });
}

function looksLikePrice(value) {
  const text = clean(value);
  if (!text) return false;
  const normalized = text.replace(/\s/g, '').replace(',', '.').replace(/[€]/g, '');
  return /^\d{1,4}(?:\.\d{1,4})?$/.test(normalized) && Number(normalized) > 0 && Number(normalized) < 10000;
}

function normalizePrice(value) {
  const text = clean(value);
  if (!text) return null;
  return text.replace(/\s/g, '').replace(',', '.').replace(/[€]/g, '');
}

function rowFromCells(cells, fallbackText, extra = {}) {
  const compact = cells.map((cell) => clean(cell)).filter(Boolean);
  if (!compact.length) return null;
  const priceIndex = compact.map(looksLikePrice).lastIndexOf(true);
  const warnings = [];
  if (priceIndex < 0) warnings.push('prix introuvable');
  const designationCells = priceIndex >= 0 ? compact.filter((_, index) => index !== priceIndex) : compact;
  const designation = clean(designationCells.join(' ')) || clean(fallbackText);
  if (!designation) return null;
  return {
    supplier_designation_original: designation,
    purchase_price_ht: priceIndex >= 0 ? normalizePrice(compact[priceIndex]) : null,
    raw_source_text: clean(fallbackText) || compact.join(' '),
    warnings,
    ...extra,
  };
}

function rowsFromCsv(text, filename = null) {
  return String(text || '').split(/\r?\n/).map((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return null;
    return rowFromCells(trimmed.split(/[;\t,]/), trimmed, {
      row_number: index + 1,
      source_filename: filename,
    });
  }).filter(Boolean);
}

function rowsFromWorkbook(buffer, filename = null) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: false });
  return rows.map((row, index) => rowFromCells(Array.isArray(row) ? row : [], Array.isArray(row) ? row.join(' ') : '', {
    row_number: index + 1,
    source_filename: filename,
    source_metadata: { sheet_name: sheetName },
  })).filter(Boolean);
}

async function rowsFromPdf(buffer, filename = null) {
  const parser = new PDFParse({ data: buffer });
  try {
    const parsed = await parser.getText();
    return String(parsed.text || '')
      .split(/\r?\n/)
      .map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return null;
        return rowFromCells(trimmed.split(/\s{2,}|[;\t]/), trimmed, {
          row_number: index + 1,
          source_filename: filename,
          source_metadata: { parser: 'pdf-parse', pages: parsed.total || null },
        });
      })
      .filter(Boolean);
  } finally {
    await parser.destroy();
  }
}

async function fileRows(file) {
  if (!file) return [];
  const name = String(file.originalname || '').toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return rowsFromWorkbook(file.buffer, file.originalname);
  if (name.endsWith('.pdf')) return rowsFromPdf(file.buffer, file.originalname);
  return rowsFromCsv(file.buffer.toString('utf8'), file.originalname);
}

router.use(authenticateToken, attachDbContext);

router.get('/tariff-levels', async (req, res) => {
  try {
    res.json(await pricing.listTariffLevels(req.dbPool, req.user.store_id, req.query));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur niveaux tarifaires' });
  }
});

router.get('/sessions', async (req, res) => {
  try {
    res.json(await pricing.listPricingSessions(req.dbPool, req.user.store_id, req.query));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur sessions tarification' });
  }
});

router.get('/sessions/current', async (req, res) => {
  try {
    res.json(await pricing.getCurrentPricingSession(req.dbPool, req.user.store_id, req.query));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur session courante' });
  }
});

router.post('/sessions', requireAdminOrManager, async (req, res) => {
  try {
    const result = await pricing.createPricingSession(req.dbPool, req.user.store_id, req.body, context(req));
    res.status(201).json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur creation session tarification' });
  }
});

router.post('/sessions/duplicate', requireAdminOrManager, async (req, res) => {
  try {
    const result = await pricing.duplicatePricingSession(req.dbPool, req.user.store_id, req.body, context(req));
    res.status(201).json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur duplication tarification' });
  }
});

router.post('/sessions/:id/revision', requireAdminOrManager, async (req, res) => {
  try {
    const result = await pricing.createRevisionFromPublishedSession(req.dbPool, req.user.store_id, { ...req.body, source_session_id: req.params.id }, context(req));
    res.status(201).json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur creation revision tarification' });
  }
});

router.get('/sessions/:id', async (req, res) => {
  try {
    res.json(await pricing.getPricingSession(req.dbPool, req.user.store_id, { id: req.params.id, ...req.query }));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur detail tarification' });
  }
});

router.post('/sessions/:id/publish', requireAdminOrManager, async (req, res) => {
  try {
    res.json(await pricing.publishPricingSession(req.dbPool, req.user.store_id, { ...req.body, pricing_session_id: req.params.id }, context(req)));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur publication tarification' });
  }
});

router.get('/lines', async (req, res) => {
  try {
    res.json(await pricing.listPricingLines(req.dbPool, req.user.store_id, req.query));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur lignes tarification' });
  }
});

router.post('/lines', requireAdminOrManager, async (req, res) => {
  try {
    const result = await pricing.addPricingLine(req.dbPool, req.user.store_id, req.body, context(req));
    res.status(201).json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur ajout ligne tarification' });
  }
});

router.patch('/lines/:id', requireAdminOrManager, async (req, res) => {
  try {
    res.json(await pricing.updatePricingLine(req.dbPool, req.user.store_id, { ...req.body, pricing_line_id: req.params.id }, context(req)));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur modification ligne tarification' });
  }
});

router.delete('/lines/:id', requireAdminOrManager, async (req, res) => {
  try {
    res.json(await pricing.removePricingLine(req.dbPool, req.user.store_id, { pricing_line_id: req.params.id }, context(req)));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur suppression ligne tarification' });
  }
});

router.get('/history/:articleId', async (req, res) => {
  try {
    res.json(await pricing.getArticlePricingHistory(req.dbPool, req.user.store_id, { ...req.query, article_id: req.params.articleId }));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur historique tarification' });
  }
});

router.get('/resolve-price', async (req, res) => {
  try {
    res.json(await pricing.resolvePublishedPrice(req.dbPool, req.user.store_id, req.query));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur resolution prix' });
  }
});

router.get('/supplier-imports', async (req, res) => {
  try {
    res.json(await pricing.listSupplierPriceImports(req.dbPool, req.user.store_id, req.query));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur imports fournisseurs' });
  }
});

router.get('/supplier-imports/:id', async (req, res) => {
  try {
    res.json(await pricing.getSupplierPriceImport(req.dbPool, req.user.store_id, { id: req.params.id }));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur import fournisseur' });
  }
});

router.post('/supplier-imports', requireAdminOrManager, upload.single('file'), async (req, res) => {
  try {
    const body = req.file ? { ...req.body, lines: await fileRows(req.file), original_filename: req.file.originalname, source_type: req.file.originalname.toLowerCase().endsWith('.pdf') ? 'pdf' : 'file' } : req.body;
    const result = await pricing.createSupplierPriceImport(req.dbPool, req.user.store_id, body, context(req));
    res.status(201).json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur creation import fournisseur' });
  }
});

router.get('/supplier-import-lines', async (req, res) => {
  try {
    res.json(await pricing.listSupplierPriceImportLines(req.dbPool, req.user.store_id, req.query));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur lignes import fournisseur' });
  }
});

router.get('/supplier-import-lines/unresolved', async (req, res) => {
  try {
    res.json(await pricing.listSupplierPriceImportLines(req.dbPool, req.user.store_id, { ...req.query, unresolved: true }));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur lignes import a traiter' });
  }
});

router.get('/supplier-import-lines/articles/search', async (req, res) => {
  try {
    res.json(await pricing.searchArticlesForSupplierMapping(req.dbPool, req.user.store_id, req.query));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur recherche article' });
  }
});

router.post('/supplier-import-lines/:lineId/confirm', requireAdminOrManager, async (req, res) => {
  try {
    res.json(await pricing.confirmSupplierImportLineMapping(req.dbPool, req.user.store_id, { ...req.body, import_line_id: req.params.lineId }, context(req)));
  } catch (error) {
    logPricingRouteError(req, error, 'supplier_import_line.confirm', { import_line_id: req.params.lineId, article_id: req.body?.article_id });
    res.status(error.status || 500).json({ error: error.message || 'Erreur confirmation ligne import' });
  }
});

router.post('/supplier-import-lines/:lineId/override', requireAdminOrManager, async (req, res) => {
  try {
    res.json(await pricing.overrideSupplierImportLineMapping(req.dbPool, req.user.store_id, { ...req.body, import_line_id: req.params.lineId }, context(req)));
  } catch (error) {
    logPricingRouteError(req, error, 'supplier_import_line.override', { import_line_id: req.params.lineId, article_id: req.body?.article_id });
    res.status(error.status || 500).json({ error: error.message || 'Erreur changement ligne import' });
  }
});

router.post('/supplier-import-lines/:lineId/ignore', requireAdminOrManager, async (req, res) => {
  try {
    res.json(await pricing.ignoreSupplierImportLine(req.dbPool, req.user.store_id, { ...req.body, import_line_id: req.params.lineId }, context(req)));
  } catch (error) {
    logPricingRouteError(req, error, 'supplier_import_line.ignore', { import_line_id: req.params.lineId });
    res.status(error.status || 500).json({ error: error.message || 'Erreur ligne import ignoree' });
  }
});

router.post('/supplier-imports/:id/apply', requireAdminOrManager, async (req, res) => {
  try {
    res.json(await pricing.applySupplierImportToSession(req.dbPool, req.user.store_id, { ...req.body, import_id: req.params.id }, context(req)));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur application import fournisseur' });
  }
});

router.get('/supplier-mappings', async (req, res) => {
  try {
    res.json(await pricing.searchSupplierArticleMappings(req.dbPool, req.user.store_id, req.query));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur mappings fournisseur' });
  }
});

router.post('/supplier-mappings', requireAdminOrManager, async (req, res) => {
  try {
    const mapping = await pricing.upsertSupplierArticleMapping(req.dbPool, req.user.store_id, req.body, context(req));
    res.status(201).json(mapping);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur mapping fournisseur' });
  }
});

module.exports = router;
