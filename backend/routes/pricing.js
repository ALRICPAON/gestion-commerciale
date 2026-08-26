const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');

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

function rowsFromCsv(text) {
  return String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const cells = line.split(/[;\t,]/).map((cell) => cell.trim()).filter(Boolean);
    if (cells.length >= 2) {
      return {
        supplier_designation_original: cells.slice(0, -1).join(' '),
        purchase_price_ht: cells[cells.length - 1],
      };
    }
    return { supplier_designation_original: line };
  });
}

function rowsFromWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: false });
  return rows.map((row) => {
    const cells = Array.isArray(row) ? row.map((cell) => clean(cell)).filter(Boolean) : [];
    if (!cells.length) return null;
    return {
      supplier_designation_original: cells.slice(0, -1).join(' ') || cells[0],
      purchase_price_ht: cells.length > 1 ? cells[cells.length - 1] : null,
    };
  }).filter(Boolean);
}

function fileRows(file) {
  if (!file) return [];
  const name = String(file.originalname || '').toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return rowsFromWorkbook(file.buffer);
  return rowsFromCsv(file.buffer.toString('utf8'));
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
    const body = req.file ? { ...req.body, lines: fileRows(req.file), original_filename: req.file.originalname, source_type: 'file' } : req.body;
    const result = await pricing.createSupplierPriceImport(req.dbPool, req.user.store_id, body, context(req));
    res.status(201).json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Erreur creation import fournisseur' });
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
