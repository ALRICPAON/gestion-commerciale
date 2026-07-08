const fs = require('fs');
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
const storeSettingsRoutes = require('./routes/storeSettings');
const storeBrandingRoutes = require('./routes/storeBranding');
const communicationRoutes = require('./routes/communication');
const articlesStoreLevelRoutes = require('./routes/articlesStoreLevel');
const articlesExcelDetailRoutes = require('./routes/articlesExcelDetail');
const articlesExcelRoutes = require('./routes/articlesExcel');
const articlesRoutes = require('./routes/articles');
const suppliersRoutes = require('./routes/suppliers');
const clientsRoutes = require('./routes/clients');
const clientContactsRoutes = require('./routes/clientContacts');
const customerInvoicesRoutes = require('./routes/customerInvoices');
const customerCreditNotesRoutes = require('./routes/customerCreditNotes');
const pdfDocumentsRoutes = require('./routes/pdfDocuments');
const customerPriceListsRoutes = require('./routes/customerPriceLists');
const customerTariffEmailsRoutes = require('./routes/customerTariffEmails');
const purchaseReceptionUpgradeRoutes = require('./routes/purchaseReceptionUpgrade');
const supplierInvoiceManualMatchingRoutes = require('./routes/supplierInvoiceManualMatching');
const supplierInvoiceImportPatchRoutes = require('./routes/supplierInvoiceImportPatch');
const supplierArticleMappingsCrudRoutes = require('./routes/supplierArticleMappingsCrud');
const supplierArticleMappingsRoutes = require('./routes/supplierArticleMappings');
const supplierInvoicesRoutes = require('./routes/supplierInvoices');
const purchasesRoutes = require('./routes/purchases');
const saleUnitNormalizerRoutes = require('./routes/saleUnitNormalizer');
const deliveryNoteValidationForcedRoutes = require('./routes/deliveryNoteValidationForced');
const deliveryNotesNegoceEditableRoutes = require('./routes/deliveryNotesNegoceEditable');
const deliveryNotesEditableRoutes = require('./routes/deliveryNotesEditable');
const negoceFixesRoutes = require('./routes/negoceFixes');
const deliveryNoteCommunicationsRoutes = require('./routes/deliveryNoteCommunications');
const deliveryNotesRoutes = require('./routes/deliveryNotes');
const salesRoutes = require('./routes/sales');
const dashboardRoutes = require('./routes/dashboard');
const royaleMareeSettlementRoutes = require('./routes/royaleMareeSettlement');
const statisticsRoutes = require('./routes/statistics');
const stockRegularizationRoutes = require('./routes/stockRegularization');
const stockRoutes = require('./routes/stock');
const traceabilityRoutes = require('./routes/traceability');
const transformationCreationRoutes = require('./routes/transformationCreation');
const transformationListRoutes = require('./routes/transformationList');
const transformationDetailsRoutes = require('./routes/transformationDetails');
const transformationUpdateRoutes = require('./routes/transformationUpdate');
const transformationValidationRoutes = require('./routes/transformationValidation');
const transformationsRoutes = require('./routes/transformations');
const aiAgentRoutes = require('./routes/aiAgent');
const employeePlanningRoutes = require('./routes/employeePlanning');
const agentActionsRouter = require('./routes/agentActions');
const mcpServerRoutes = require('./routes/mcpServer');
const intelligenceCenterRoutes = require('./routes/intelligenceCenter');
const pennylaneIntegrationRoutes = require('./routes/pennylaneIntegration');
const pennylaneSupplierInvoicesRoutes = require('./routes/pennylaneSupplierInvoices');
const qualityRoutes = require('./routes/quality');

const app = express();
const PORT = process.env.PORT || 3002;
const STORE_LOGOS_DIR = path.join(__dirname, 'uploads', 'store-logos');
const SANITARY_PHOTOS_DIR = path.join(__dirname, 'uploads', 'sanitary-photos');

fs.mkdirSync(STORE_LOGOS_DIR, { recursive: true });
fs.mkdirSync(SANITARY_PHOTOS_DIR, { recursive: true });

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET manquant dans le fichier backend/.env');
  process.exit(1);
}

app.disable('x-powered-by');
app.set('trust proxy', 1);

const defaultCorsOrigins = [
  'http://localhost',
  'http://localhost:3002',
  'http://localhost:8080',
  'http://127.0.0.1:3002',
  'http://127.0.0.1:8080',
  'https://altamaree.fr',
  'https://www.altamaree.fr',
  'https://api.altamaree.fr',
];

function normalizeCorsOrigin(origin) {
  return String(origin || '').trim().replace(/\/+$/, '');
}

const allowedCorsOrigins = new Set([
  ...defaultCorsOrigins,
  ...(process.env.CORS_ALLOWED_ORIGINS || '').split(','),
]
  .map(normalizeCorsOrigin)
  .filter(Boolean));

const corsOptions = {
  origin(origin, callback) {
    const normalizedOrigin = normalizeCorsOrigin(origin);
    if (!origin || allowedCorsOrigins.has(normalizedOrigin)) {
      return callback(null, true);
    }

    console.warn('Origine CORS refusee', {
      origin,
      normalizedOrigin,
      allowedOrigins: Array.from(allowedCorsOrigins),
    });

    return callback(new Error('Origine CORS non autorisee'));
  },
  allowedHeaders: ['Authorization', 'Content-Type'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  preflightContinue: false,
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

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: [
        "'self'",
        'data:',
        'blob:',
        'https://altamaree.fr',
        'https://www.altamaree.fr',
        'https://api.altamaree.fr',
      ],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: null,
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use('/uploads/store-logos', express.static(STORE_LOGOS_DIR, {
  fallthrough: false,
  index: false,
  maxAge: '7d',
}));
app.use('/uploads/sanitary-photos', express.static(SANITARY_PHOTOS_DIR, {
  fallthrough: false,
  index: false,
  maxAge: '7d',
}));
app.use(express.json());
app.use('/mcp', apiRateLimiter);
app.use('/mcp', mcpServerRoutes);
app.use('/api/login', loginRateLimiter);
app.use('/api', apiRateLimiter);
app.use('/api', authRoutes);
app.use('/api', usersRoutes);
app.use('/api', storeSettingsRoutes);
app.use('/api', storeBrandingRoutes);
app.use('/api', communicationRoutes);
app.use('/api/articles', articlesExcelDetailRoutes);
app.use('/api/articles', articlesExcelRoutes);
app.use('/api/articles', articlesStoreLevelRoutes);
app.use('/api/articles', articlesRoutes);
app.use('/api', suppliersRoutes);
app.use('/api', clientsRoutes);
app.use('/api', clientContactsRoutes);
app.use('/api', customerInvoicesRoutes);
app.use('/api', customerCreditNotesRoutes);
app.use('/api', pdfDocumentsRoutes);
app.use('/api/customer-price-lists/email', customerTariffEmailsRoutes);
app.use('/api/customer-price-lists', customerPriceListsRoutes);
app.use('/api', purchaseReceptionUpgradeRoutes);
app.use('/api', supplierInvoiceManualMatchingRoutes);
app.use('/api', supplierInvoiceImportPatchRoutes);
app.use('/api', supplierArticleMappingsCrudRoutes);
app.use('/api', supplierArticleMappingsRoutes);
app.use('/api', supplierInvoicesRoutes);
app.use('/api', purchasesRoutes);
app.use('/api', saleUnitNormalizerRoutes);
app.use('/api', deliveryNoteValidationForcedRoutes);
app.use('/api', deliveryNotesNegoceEditableRoutes);
app.use('/api', deliveryNotesEditableRoutes);
app.use('/api', negoceFixesRoutes);
app.use('/api', deliveryNoteCommunicationsRoutes);
app.use('/api', deliveryNotesRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api', dashboardRoutes);
app.use('/api', royaleMareeSettlementRoutes);
app.use('/api', statisticsRoutes);
app.use('/api/stock', stockRegularizationRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/traceability', traceabilityRoutes);
app.use('/api/quality', qualityRoutes);
app.use('/api/transformations', transformationCreationRoutes);
app.use('/api/transformations', transformationListRoutes);
app.use('/api/transformations', transformationDetailsRoutes);
app.use('/api/transformations', transformationUpdateRoutes);
app.use('/api/transformations', transformationValidationRoutes);
app.use('/api/transformations', transformationsRoutes);
app.use('/api', aiAgentRoutes);
app.use('/api/employee-planning', employeePlanningRoutes);
app.use('/api/agent', agentActionsRouter);
app.use('/api', intelligenceCenterRoutes);
app.use('/api', pennylaneIntegrationRoutes);
app.use('/api', pennylaneSupplierInvoicesRoutes);
app.get('/', (req, res) => {
  res.send('API ALTA MARÉE fonctionne');
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
