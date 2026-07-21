const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { CASHFLOW_PERMISSIONS, requireCashflowPermission } = require('../services/cashflow/permissions');
const { syncCashflowData, PENNYLANE_CASHFLOW_CAPABILITIES } = require('../services/cashflow/pennylaneCashflowService');
const {
  calculateCustomerBehaviour,
  getDashboard,
  getDistrimer,
  getForecast,
  getSettings,
  listBankTransactions,
  listCustomerReceivables,
  listPaidCustomerHistory,
  listSupplierPayables,
  sendForecastExport,
  settingsForDistrimer,
  simulateDistrimerPayment,
  updateSettings,
} = require('../services/cashflow/service');
const {
  createManualItem,
  deleteManualItem,
  listManualItems,
  updateManualItem,
} = require('../services/cashflow/manualForecastService');

const router = express.Router();

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function handleError(res, err) {
  const status = err.status || 500;
  const payload = { error: err.message || 'Erreur tresorerie' };
  if (status >= 500) {
    console.error('Erreur tresorerie :', {
      message: err.message,
      status,
      code: err.code || null,
    });
  } else {
    console.warn('Erreur fonctionnelle tresorerie :', {
      message: err.message,
      status,
      code: err.code || null,
    });
  }
  return res.status(status).json(payload);
}

router.use(authenticateToken, attachDbContext);

router.get('/cashflow/dashboard', requireCashflowPermission(CASHFLOW_PERMISSIONS.READ), async (req, res) => {
  try {
    return res.json(await getDashboard(req.dbPool, req.user.store_id, req.query));
  } catch (err) {
    return handleError(res, err);
  }
});

router.post('/cashflow/sync', requireCashflowPermission(CASHFLOW_PERMISSIONS.SYNC), async (req, res) => {
  try {
    const result = await syncCashflowData(req.dbPool, {
      storeId: req.user.store_id,
      userId: req.user.id,
    });
    return res.status(202).json({
      ok: true,
      result,
      pennylane: PENNYLANE_CASHFLOW_CAPABILITIES,
    });
  } catch (err) {
    return handleError(res, err);
  }
});

router.get('/cashflow/forecast', requireCashflowPermission(CASHFLOW_PERMISSIONS.READ), async (req, res) => {
  try {
    return res.json(await getForecast(req.dbPool, req.user.store_id, req.query));
  } catch (err) {
    return handleError(res, err);
  }
});

router.get('/cashflow/customer-receivables', requireCashflowPermission(CASHFLOW_PERMISSIONS.READ), async (req, res) => {
  try {
    const invoices = await listCustomerReceivables(req.dbPool, req.user.store_id);
    const history = await listPaidCustomerHistory(req.dbPool, req.user.store_id);
    return res.json({
      invoices,
      behaviours: calculateCustomerBehaviour(history),
    });
  } catch (err) {
    return handleError(res, err);
  }
});

router.get('/cashflow/supplier-payables', requireCashflowPermission(CASHFLOW_PERMISSIONS.READ), async (req, res) => {
  try {
    return res.json({ invoices: await listSupplierPayables(req.dbPool, req.user.store_id) });
  } catch (err) {
    return handleError(res, err);
  }
});

router.get('/cashflow/bank-transactions', requireCashflowPermission(CASHFLOW_PERMISSIONS.READ), async (req, res) => {
  try {
    return res.json({
      transactions: await listBankTransactions(req.dbPool, req.user.store_id, req.query),
      warning: 'Transactions bancaires Pennylane preparees mais aucun endpoint bancaire n est encore valide dans ce depot.',
    });
  } catch (err) {
    return handleError(res, err);
  }
});

router.get('/cashflow/distrimer', requireCashflowPermission(CASHFLOW_PERMISSIONS.READ), async (req, res) => {
  try {
    return res.json(await getDistrimer(req.dbPool, req.user.store_id));
  } catch (err) {
    return handleError(res, err);
  }
});

router.post('/cashflow/distrimer/simulate', requireCashflowPermission(CASHFLOW_PERMISSIONS.READ), async (req, res) => {
  try {
    const settings = await getSettings(req.dbPool, req.user.store_id);
    return res.json(simulateDistrimerPayment({
      currentExposure: req.body.current_exposure,
      plannedPurchases: req.body.planned_purchases,
      bankBalance: req.body.bank_balance,
      expectedInflows: req.body.expected_inflows,
      paymentAmount: req.body.payment_amount,
      deadline: req.body.deadline,
      settings: settingsForDistrimer(settings),
    }));
  } catch (err) {
    return handleError(res, err);
  }
});

router.get('/cashflow/manual-items', requireCashflowPermission(CASHFLOW_PERMISSIONS.READ), async (req, res) => {
  try {
    return res.json({ items: await listManualItems(req.dbPool, req.user.store_id) });
  } catch (err) {
    return handleError(res, err);
  }
});

router.post('/cashflow/manual-items', requireCashflowPermission(CASHFLOW_PERMISSIONS.MANAGE), async (req, res) => {
  try {
    const item = await createManualItem(req.dbPool, {
      storeId: req.user.store_id,
      userId: req.user.id,
      body: req.body,
    });
    return res.status(201).json({ item });
  } catch (err) {
    return handleError(res, err);
  }
});

router.put('/cashflow/manual-items/:id', requireCashflowPermission(CASHFLOW_PERMISSIONS.MANAGE), async (req, res) => {
  try {
    if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Identifiant mouvement invalide' });
    const item = await updateManualItem(req.dbPool, {
      storeId: req.user.store_id,
      id: req.params.id,
      body: req.body,
    });
    if (!item) return res.status(404).json({ error: 'Mouvement introuvable' });
    return res.json({ item });
  } catch (err) {
    return handleError(res, err);
  }
});

router.delete('/cashflow/manual-items/:id', requireCashflowPermission(CASHFLOW_PERMISSIONS.MANAGE), async (req, res) => {
  try {
    if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Identifiant mouvement invalide' });
    const deleted = await deleteManualItem(req.dbPool, {
      storeId: req.user.store_id,
      id: req.params.id,
    });
    if (!deleted) return res.status(404).json({ error: 'Mouvement introuvable' });
    return res.status(204).send();
  } catch (err) {
    return handleError(res, err);
  }
});

router.get('/cashflow/settings', requireCashflowPermission(CASHFLOW_PERMISSIONS.READ), async (req, res) => {
  try {
    return res.json({ settings: await getSettings(req.dbPool, req.user.store_id) });
  } catch (err) {
    return handleError(res, err);
  }
});

router.put('/cashflow/settings', requireCashflowPermission(CASHFLOW_PERMISSIONS.SETTINGS), async (req, res) => {
  try {
    return res.json({ settings: await updateSettings(req.dbPool, req.user.store_id, req.body) });
  } catch (err) {
    return handleError(res, err);
  }
});

router.get('/cashflow/export', requireCashflowPermission(CASHFLOW_PERMISSIONS.READ), async (req, res) => {
  try {
    const forecast = await getForecast(req.dbPool, req.user.store_id, req.query);
    return sendForecastExport(res, forecast, String(req.query.format || 'csv').toLowerCase());
  } catch (err) {
    return handleError(res, err);
  }
});

module.exports = router;
