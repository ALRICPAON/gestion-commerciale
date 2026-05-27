const path = require('path');

require('dotenv').config({
  path: path.join(__dirname, '.env'),
});

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const suppliersRoutes = require('./routes/suppliers');
const afMapRoutes = require('./routes/afMap');
const purchasesRoutes = require('./routes/purchases');
const articleRoutes = require('./routes/articles');
const traceabilityRoutes = require('./routes/traceability');
const recipesRoutes = require('./routes/recipes');
const fabricationsRoutes = require('./routes/fabrications');
const labelsRoutes = require('./routes/labels');
const comptaRoutes = require('./routes/compta');
const inventoryRoutes = require('./routes/inventory');
const stockRoutes = require('./routes/stock');
const salesRoutes = require('./routes/sales');
const transformationsRoutes = require('./routes/transformations');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET manquant dans le fichier backend/.env');
  process.exit(1);
}

app.disable('x-powered-by');
app.set('trust proxy', 1);

const allowedCorsOrigins = new Set(
  (process.env.CORS_ALLOWED_ORIGINS || 'https://app.rayonv2.fr,http://localhost:8080,http://127.0.0.1:8080')
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

const uploadRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 80,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS',
  message: { error: 'Trop de televersements, reessaie plus tard' },
});

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://app.rayonv2.fr'],
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
app.use('/api/purchase-lines/:id/upload-photo', uploadRateLimiter);
app.use('/api/purchases/import-document', uploadRateLimiter);
app.use('/api/inventory/preview-import', uploadRateLimiter);
app.use('/api/inventory/import-sales-document', uploadRateLimiter);
app.use('/api', apiRateLimiter);
app.use('/api', authRoutes);
app.use('/api', usersRoutes);
app.use('/api', suppliersRoutes);
app.use('/api', afMapRoutes);
app.use('/api', purchasesRoutes);
app.use('/api/articles', articleRoutes);
app.use('/api/traceability', traceabilityRoutes);
app.use('/api/recipes', recipesRoutes);
app.use('/api/fabrications', fabricationsRoutes);
app.use('/api/labels', labelsRoutes);
app.use('/api/compta', comptaRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/transformations', transformationsRoutes);

app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  dotfiles: 'deny',
  index: false,
  setHeaders: (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
  },
}));

app.get('/', (req, res) => {
  res.send('API Gestion Rayons V2 fonctionne 🚀');
});

// Articles routes have been moved to routes/articles.js

// Purchases routes have been moved to routes/purchases.js

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
    
