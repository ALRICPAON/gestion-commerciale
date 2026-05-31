const path = require('path');

require('dotenv').config({
  path: path.join(__dirname, '.env'),
});

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { authenticateToken } = require('./middleware/auth');
const { attachDbContext } = require('./middleware/dbContext');
const { requireAdminOrManager } = require('./middleware/authorization');
const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const articlesStoreLevelRoutes = require('./routes/articlesStoreLevel');
const articlesExcelDetailRoutes = require('./routes/articlesExcelDetail');
const articlesExcelRoutes = require('./routes/articlesExcel');
const articlesRoutes = require('./routes/articles');
const suppliersRoutes = require('./routes/suppliers');
const clientsRoutes = require('./routes/clients');
const purchasesRoutes = require('./routes/purchases');
const saleUnitNormalizerRoutes = require('./routes/saleUnitNormalizer');
const deliveryNotesNegoceEditableRoutes = require('./routes/deliveryNotesNegoceEditable');
const deliveryNotesEditableRoutes = require('./routes/deliveryNotesEditable');
const negoceFixesRoutes = require('./routes/negoceFixes');
const deliveryNotesRoutes = require('./routes/deliveryNotes');
const salesRoutes = require('./routes/sales');
const stockRoutes = require('./routes/stock');

const app = express();
const PORT = process.env.PORT || 3002;

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET manquant dans le fichier backend/.env');
  process.exit(1);
}

app.disable('x-powered-by');
app.set('trust proxy', 1);

const allowedCorsOrigins = new Set(
  (
    process.env.CORS_ALLOWED_ORIGINS ||
    'http://localhost,http://localhost:3002,http://localhost:8080,http://127.0.0.1:3002,http://127.0.0.1:8080,https://scorpaseafood.fr,https://www.scorpaseafood.fr,https://api.scorpaseafood.fr'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
);

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedCorsOrigins.has(origin)) {
      return callback(null, true);
    }

    return callback(new Error('Origine CORS non autorisee'));
  },
  allowedHeaders: ['Authorization', 'Content-Type'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  optionsSuccessStatus: 204,
};

const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS',
  message: { error: 'Trop de requetes, reessaie plus tard' },
});

const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  skip: (req) => req.method === 'OPTIONS',
  message: { error: 'Trop de tentatives de connexion, reessaie plus tard' },
});

function isSaleEditDiagnosticRequest(req) {
  return ['PATCH', 'POST', 'DELETE'].includes(req.method)
    && /^\/api\/sales(\/lines\/[^/]+|\/[^/]+(\/lines)?)?$/.test(req.originalUrl.split('?')[0]);
}

function logOldRouteFallthrough(label) {
  return (req, res, next) => {
    if (isSaleEditDiagnosticRequest(req)) {
      console.info(label, {
        method: req.method,
        originalUrl: req.originalUrl,
        body: req.body,
      });
    }
    next();
  };
}

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: [
        "'self'",
        'data:',
        'blob:',
        'https://scorpaseafood.fr',
        'https://www.scorpaseafood.fr',
        'https://api.scorpaseafood.fr',
      ],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: null,
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(cors(corsOptions));
app.use(express.json());
app.use('/api/login', loginRateLimiter);
app.use('/api', apiRateLimiter);
app.use('/api', authRoutes);
app.use('/api', usersRoutes);
app.use('/api/articles', articlesExcelDetailRoutes);
app.use('/api/articles', articlesExcelRoutes);
app.use('/api/articles', articlesStoreLevelRoutes);
app.use('/api/articles', articlesRoutes);
app.use('/api', suppliersRoutes);
app.use('/api', clientsRoutes);
app.use('/api', purchasesRoutes);
app.get('/api/diagnostics/sales-documents/:id', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const result = await req.dbPool.query(
      `SELECT sd.id,
        sd.document_type,
        sd.status,
        sd.origin,
        sd.source_type,
        sd.source_order_id,
        sd.source_delivery_note_id,
        sd.invoice_id,
        sd.invoice_reference,
        sd.source_invoice_id,
        sd.invoiced_at,
        COUNT(invoice.id)::int AS linked_invoice_count,
        ARRAY_REMOVE(ARRAY_AGG(invoice.id), NULL) AS linked_invoice_ids,
        ARRAY_REMOVE(ARRAY_AGG(invoice.reference_number), NULL) AS linked_invoice_references
       FROM sales_documents sd
       LEFT JOIN sales_documents invoice
         ON invoice.source_delivery_note_id = sd.id
        AND invoice.store_id = sd.store_id
        AND invoice.document_type = 'INVOICE'
       WHERE sd.id = $1 AND sd.store_id = $2
       GROUP BY sd.id`,
      [req.params.id, req.user.store_id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Document introuvable' });
    console.info('SALES DOCUMENT DIAGNOSTIC', result.rows[0]);
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur diagnostic document vente :', err);
    return res.status(500).json({ error: err.message || 'Erreur diagnostic document vente' });
  }
});
app.use('/api', saleUnitNormalizerRoutes);
app.use('/api', deliveryNotesNegoceEditableRoutes);
app.use('/api', deliveryNotesEditableRoutes);
app.use('/api', logOldRouteFallthrough('OLD NEGOCE ROUTE HIT before negoceFixesRoutes'));
app.use('/api', negoceFixesRoutes);
app.use('/api', logOldRouteFallthrough('OLD NEGOCE ROUTE HIT before deliveryNotesRoutes'));
app.use('/api', deliveryNotesRoutes);
app.use('/api/sales', logOldRouteFallthrough('OLD SALES ROUTE HIT before salesRoutes'));
app.use('/api/sales', salesRoutes);
app.use('/api/stock', stockRoutes);
app.get('/', (req, res) => {
  res.send('API Scorpa Seafood / Gestion Commerciale fonctionne');
});

app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  console.error('Erreur Express :', err);

  if (err.message === 'Origine CORS non autorisee') {
    return res.status(403).json({ error: 'Origine CORS non autorisee' });
  }

  if (err.name === 'MulterError') {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop volumineux' : 'Erreur upload fichier';
    return res.status(400).json({ error: message });
  }

  if (err.status && err.status < 500) {
    return res.status(err.status).json({
      error: err.expose ? err.message : 'Requete invalide',
    });
  }

  return res.status(err.status || 500).json({
    error: err.status && err.expose ? err.message : 'Erreur serveur',
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Serveur lancé sur http://0.0.0.0:${PORT}`);
});
    