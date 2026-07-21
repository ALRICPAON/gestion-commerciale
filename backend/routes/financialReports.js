const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const { renderHtmlToPdf, sendPdf } = require('../services/pdf/pdfRenderer');
const {
  FINANCIAL_REPORT_PERMISSIONS,
  requireFinancialReportPermission,
} = require('../services/financialReporting/permissions');
const {
  comparison,
  getTrialBalance,
  incomeStatement,
  listMappings,
  normalizePeriod,
  syncTrialBalance,
  updateMapping,
} = require('../services/financialReporting/service');

const router = express.Router();

function bool(value) {
  return value === true || String(value || '').toLowerCase() === 'true';
}

function handleError(res, err) {
  const status = err.status || 500;
  if (status >= 500) {
    console.error('Erreur reporting financier :', {
      message: err.message,
      status,
      code: err.code || null,
    });
  } else {
    console.warn('Erreur fonctionnelle reporting financier :', {
      message: err.message,
      status,
      code: err.code || null,
    });
  }
  return res.status(status).json({
    error: err.message || 'Erreur reporting financier',
    code: err.code || null,
  });
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (!/[;"\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function reportCsv(report) {
  const rows = [
    ['Section', 'Sous-section', 'Compte', 'Libelle', 'Debit', 'Credit', 'Solde', 'Montant reporting'],
  ];
  for (const section of report.sections || []) {
    for (const account of section.accounts || []) {
      rows.push([
        section.section_label,
        section.display_label,
        account.formatted_account_number,
        account.account_label,
        account.total_debit,
        account.total_credit,
        account.net_balance,
        account.amount,
      ]);
    }
  }
  return rows.map((row) => row.map(csvEscape).join(';')).join('\n');
}

function money(value) {
  return Number(value || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function reportHtml(report, compare = null) {
  const sections = (report.sections || []).map((section) => `
    <h2>${section.section_label} - ${section.display_label}</h2>
    <table>
      <thead><tr><th>Compte</th><th>Libelle</th><th>Debit</th><th>Credit</th><th>Solde</th><th>Montant</th></tr></thead>
      <tbody>
        ${(section.accounts || []).map((account) => `
          <tr>
            <td>${account.formatted_account_number || account.account_number}</td>
            <td>${account.account_label || ''}</td>
            <td class="num">${money(account.total_debit)}</td>
            <td class="num">${money(account.total_credit)}</td>
            <td class="num">${money(account.net_balance)}</td>
            <td class="num">${money(account.amount)}</td>
          </tr>
        `).join('')}
        <tr class="total"><td colspan="5">Total</td><td class="num">${money(section.amount)}</td></tr>
      </tbody>
    </table>
  `).join('');
  const comparisonRows = compare ? Object.entries(compare.calculations || {}).map(([key, row]) => `
    <tr><td>${key}</td><td class="num">${money(row.current)}</td><td class="num">${money(row.previous)}</td><td class="num">${money(row.delta)}</td><td class="num">${row.delta_percent === null ? '-' : `${money(row.delta_percent)} %`}</td></tr>
  `).join('') : '';

  return `<!doctype html>
  <html lang="fr">
    <head>
      <meta charset="utf-8" />
      <style>
        @page { size: A4 portrait; margin: 12mm; }
        body { font-family: Arial, sans-serif; color: #111; }
        header { display: flex; justify-content: space-between; gap: 16px; border-bottom: 2px solid #0F2744; padding-bottom: 8px; margin-bottom: 14px; }
        h1 { margin: 0; color: #0F2744; font-size: 18pt; }
        h2 { margin: 14px 0 6px; font-size: 11pt; color: #114B7A; }
        p { margin: 3px 0; }
        table { width: 100%; border-collapse: collapse; font-size: 8pt; margin-bottom: 8px; }
        th, td { border: 1px solid #d0d5dd; padding: 4px; text-align: left; }
        th { background: #eef3f8; }
        .num { text-align: right; }
        .total td { font-weight: 700; background: #f8fafc; }
        .notice { margin-top: 18px; font-size: 8pt; color: #555; }
      </style>
    </head>
    <body>
      <header>
        <div>
          <h1>ALTA MAREE - Reporting financier</h1>
          <p>Periode : ${report.period_start || '-'} au ${report.period_end || '-'}</p>
          <p>Genere le ${new Date().toLocaleString('fr-FR')}</p>
        </div>
        <strong>${report.provisional ? 'Provisoire' : 'Definitif'}</strong>
      </header>
      <h2>Indicateurs</h2>
      <table>
        <tbody>
          <tr><td>Chiffre d affaires HT</td><td class="num">${money(report.calculations?.revenue)}</td></tr>
          <tr><td>Marge brute</td><td class="num">${money(report.calculations?.gross_margin)}</td></tr>
          <tr><td>EBE estime</td><td class="num">${money(report.calculations?.ebitda)}</td></tr>
          <tr><td>Resultat net estime</td><td class="num">${money(report.calculations?.net_result)}</td></tr>
        </tbody>
      </table>
      ${comparisonRows ? `<h2>Comparatif</h2><table><thead><tr><th>Indicateur</th><th>Actuel</th><th>Precedent</th><th>Ecart</th><th>Ecart %</th></tr></thead><tbody>${comparisonRows}</tbody></table>` : ''}
      <h2>Compte de resultat</h2>
      ${sections || '<p>Aucune ligne comptable disponible.</p>'}
      <p class="notice">Document de gestion provisoire, ne remplace pas les comptes annuels.</p>
    </body>
  </html>`;
}

router.use(authenticateToken, attachDbContext);

router.get(
  '/reports/financial/trial-balance',
  requireFinancialReportPermission(FINANCIAL_REPORT_PERMISSIONS.READ),
  async (req, res) => {
    try {
      const period = normalizePeriod(req.query);
      const result = await getTrialBalance(req.dbPool, {
        storeId: req.user.store_id,
        ...period,
        refresh: bool(req.query.refresh),
      });
      return res.json(result);
    } catch (err) {
      return handleError(res, err);
    }
  }
);

router.get(
  '/reports/financial/income-statement',
  requireFinancialReportPermission(FINANCIAL_REPORT_PERMISSIONS.READ),
  async (req, res) => {
    try {
      const period = normalizePeriod(req.query);
      const report = await incomeStatement(req.dbPool, {
        storeId: req.user.store_id,
        ...period,
        refresh: bool(req.query.refresh),
      });
      return res.json(report);
    } catch (err) {
      return handleError(res, err);
    }
  }
);

router.get(
  '/reports/financial/comparison',
  requireFinancialReportPermission(FINANCIAL_REPORT_PERMISSIONS.READ),
  async (req, res) => {
    try {
      const period = normalizePeriod(req.query);
      const compare = await comparison(req.dbPool, {
        storeId: req.user.store_id,
        ...period,
        comparisonPeriodStart: req.query.comparison_period_start,
        comparisonPeriodEnd: req.query.comparison_period_end,
      });
      return res.json(compare);
    } catch (err) {
      return handleError(res, err);
    }
  }
);

router.post(
  '/reports/financial/sync',
  requireFinancialReportPermission(FINANCIAL_REPORT_PERMISSIONS.SYNC),
  async (req, res) => {
    try {
      const period = normalizePeriod(req.body);
      const result = await syncTrialBalance(req.dbPool, {
        storeId: req.user.store_id,
        ...period,
      });
      return res.status(201).json(result);
    } catch (err) {
      return handleError(res, err);
    }
  }
);

router.get(
  '/reports/financial/mappings',
  requireFinancialReportPermission(FINANCIAL_REPORT_PERMISSIONS.READ),
  async (req, res) => {
    try {
      return res.json({ mappings: await listMappings(req.dbPool, req.user.store_id) });
    } catch (err) {
      return handleError(res, err);
    }
  }
);

router.put(
  '/reports/financial/mappings/:id',
  requireFinancialReportPermission(FINANCIAL_REPORT_PERMISSIONS.ADMIN),
  async (req, res) => {
    try {
      const mapping = await updateMapping(req.dbPool, {
        id: req.params.id,
        storeId: req.user.store_id,
        patch: req.body,
      });
      if (!mapping) return res.status(404).json({ error: 'Mapping introuvable' });
      return res.json({ mapping });
    } catch (err) {
      return handleError(res, err);
    }
  }
);

router.get(
  '/reports/financial/export',
  requireFinancialReportPermission(FINANCIAL_REPORT_PERMISSIONS.READ),
  async (req, res) => {
    try {
      const period = normalizePeriod(req.query);
      const report = await incomeStatement(req.dbPool, {
        storeId: req.user.store_id,
        ...period,
        refresh: bool(req.query.refresh),
      });
      const format = String(req.query.format || 'csv').toLowerCase();
      if (format === 'pdf') {
        const compare = req.query.comparison_period_start && req.query.comparison_period_end
          ? await comparison(req.dbPool, {
              storeId: req.user.store_id,
              ...period,
              comparisonPeriodStart: req.query.comparison_period_start,
              comparisonPeriodEnd: req.query.comparison_period_end,
            })
          : null;
        const pdf = await renderHtmlToPdf(reportHtml(report, compare), { format: 'A4' });
        return sendPdf(res, pdf, `reporting-financier-${period.periodStart}-${period.periodEnd}.pdf`);
      }
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="reporting-financier-${period.periodStart}-${period.periodEnd}.csv"`);
      return res.send(`\ufeff${reportCsv(report)}`);
    } catch (err) {
      return handleError(res, err);
    }
  }
);

module.exports = router;
