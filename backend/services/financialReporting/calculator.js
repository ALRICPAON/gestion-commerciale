const SECTION_LABELS = {
  operating_revenue: 'Produits d exploitation',
  operating_expenses: 'Charges d exploitation',
  financial_result: 'Resultat financier',
  exceptional_result: 'Resultat exceptionnel',
  income_tax: 'Impots sur les benefices',
  unmapped: 'Comptes non mappes',
};

function num(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rounded(value) {
  return Number(num(value).toFixed(2));
}

function accountNumber(line = {}) {
  return String(line.account_number || line.formatted_account_number || '').replace(/\s+/g, '');
}

function matchMapping(line, mappings = []) {
  const account = accountNumber(line);
  return mappings
    .filter((mapping) => account.startsWith(String(mapping.account_prefix || '')))
    .sort((a, b) => String(b.account_prefix).length - String(a.account_prefix).length)[0] || null;
}

function emptyBucket(mapping) {
  return {
    section_code: mapping.section_code,
    section_label: SECTION_LABELS[mapping.section_code] || mapping.section_code,
    subsection_code: mapping.subsection_code || 'general',
    display_label: mapping.display_label,
    display_order: Number(mapping.display_order || 0),
    total_debit: 0,
    total_credit: 0,
    raw_net_balance: 0,
    amount: 0,
    accounts: [],
  };
}

function addLineToBucket(bucket, line, mapping) {
  const totalDebit = num(line.total_debit);
  const totalCredit = num(line.total_credit);
  const rawNetBalance = rounded(line.net_balance ?? (totalCredit - totalDebit));
  const amount = rounded(rawNetBalance * Number(mapping.calculation_sign || 1));
  bucket.total_debit = rounded(bucket.total_debit + totalDebit);
  bucket.total_credit = rounded(bucket.total_credit + totalCredit);
  bucket.raw_net_balance = rounded(bucket.raw_net_balance + rawNetBalance);
  bucket.amount = rounded(bucket.amount + amount);
  bucket.accounts.push({
    account_number: line.account_number,
    formatted_account_number: line.formatted_account_number || line.account_number,
    account_label: line.account_label,
    total_debit: totalDebit,
    total_credit: totalCredit,
    net_balance: rawNetBalance,
    calculation_sign: Number(mapping.calculation_sign || 1),
    amount,
  });
}

function groupTrialBalance(lines = [], mappings = []) {
  const buckets = new Map();
  const unknownAccounts = [];

  for (const line of lines) {
    const mapping = matchMapping(line, mappings);
    if (!mapping) {
      unknownAccounts.push({
        account_number: line.account_number,
        formatted_account_number: line.formatted_account_number || line.account_number,
        account_label: line.account_label,
        total_debit: num(line.total_debit),
        total_credit: num(line.total_credit),
        net_balance: rounded(line.net_balance ?? (num(line.total_credit) - num(line.total_debit))),
      });
      continue;
    }
    const key = `${mapping.section_code}:${mapping.subsection_code || 'general'}:${mapping.display_label}`;
    if (!buckets.has(key)) buckets.set(key, emptyBucket(mapping));
    addLineToBucket(buckets.get(key), line, mapping);
  }

  return {
    sections: Array.from(buckets.values()).sort((a, b) => a.display_order - b.display_order),
    unknown_accounts: unknownAccounts,
  };
}

function sumBy(sections, predicate) {
  return rounded(sections.filter(predicate).reduce((sum, section) => sum + num(section.amount), 0));
}

function sectionTotal(sections, sectionCode) {
  return sumBy(sections, (section) => section.section_code === sectionCode);
}

function subsectionTotal(sections, subsectionCode) {
  return sumBy(sections, (section) => section.subsection_code === subsectionCode);
}

function calculateIncomeStatement({
  lines = [],
  mappings = [],
  snapshot = null,
  periodStart = null,
  periodEnd = null,
  now = new Date(),
}) {
  const grouped = groupTrialBalance(lines, mappings);
  const sections = grouped.sections;

  const revenue = subsectionTotal(sections, 'revenue');
  const operatingRevenue = sectionTotal(sections, 'operating_revenue');
  const purchases = subsectionTotal(sections, 'purchases');
  const stockVariation = subsectionTotal(sections, 'stock_variation');
  const purchasesConsumed = rounded(purchases + stockVariation);
  const grossMargin = rounded(revenue - purchasesConsumed);
  const marginRate = revenue ? rounded((grossMargin / revenue) * 100) : null;
  const externalCharges = subsectionTotal(sections, 'external_charges');
  const taxes = subsectionTotal(sections, 'taxes');
  const staffCosts = subsectionTotal(sections, 'staff_costs');
  const depreciation = subsectionTotal(sections, 'depreciation');
  const otherOperatingExpenses = sumBy(sections, (section) => (
    section.section_code === 'operating_expenses'
    && !['purchases', 'stock_variation', 'external_charges', 'taxes', 'staff_costs', 'depreciation'].includes(section.subsection_code)
  ));
  const operatingExpenses = sectionTotal(sections, 'operating_expenses');
  const ebitda = rounded(operatingRevenue - purchasesConsumed - externalCharges - taxes - staffCosts - otherOperatingExpenses);
  const operatingResult = rounded(operatingRevenue - operatingExpenses);
  const financialIncome = subsectionTotal(sections, 'financial_income');
  const financialExpenses = subsectionTotal(sections, 'financial_expenses');
  const financialResult = rounded(financialIncome - financialExpenses);
  const currentResult = rounded(operatingResult + financialResult);
  const exceptionalIncome = subsectionTotal(sections, 'exceptional_income');
  const exceptionalExpenses = subsectionTotal(sections, 'exceptional_expenses');
  const exceptionalResult = rounded(exceptionalIncome - exceptionalExpenses);
  const incomeTax = sectionTotal(sections, 'income_tax');
  const netResult = rounded(currentResult + exceptionalResult - incomeTax);
  const periodEndDate = periodEnd ? new Date(`${periodEnd}T23:59:59Z`) : null;
  const provisional = !snapshot || snapshot.status !== 'success' || !periodEndDate || periodEndDate >= now;

  return {
    period_start: periodStart || snapshot?.period_start || null,
    period_end: periodEnd || snapshot?.period_end || null,
    snapshot,
    convention: 'Solde brut = credit - debit. Les mappings de charges utilisent calculation_sign = -1 pour produire un montant de charge positif; les resultats soustraient ensuite ces charges.',
    provisional,
    incomplete: grouped.unknown_accounts.length > 0 || lines.length === 0,
    kpis: {
      revenue,
      gross_margin: grossMargin,
      margin_rate: marginRate,
      operating_charges: rounded(operatingExpenses - purchasesConsumed),
      ebitda,
      net_result: netResult,
    },
    calculations: {
      revenue,
      operating_revenue: operatingRevenue,
      purchases,
      stock_variation: stockVariation,
      purchases_consumed: purchasesConsumed,
      gross_margin: grossMargin,
      margin_rate: marginRate,
      external_charges: externalCharges,
      taxes,
      staff_costs: staffCosts,
      ebitda,
      depreciation,
      operating_result: operatingResult,
      financial_result: financialResult,
      current_result: currentResult,
      exceptional_result: exceptionalResult,
      income_tax: incomeTax,
      net_result: netResult,
    },
    sections,
    unknown_accounts: grouped.unknown_accounts,
  };
}

function compareReports(current, previous) {
  const keys = Object.keys(current?.calculations || {});
  const calculations = Object.fromEntries(keys.map((key) => {
    const currentValue = num(current.calculations[key]);
    const previousValue = num(previous?.calculations?.[key]);
    const delta = rounded(currentValue - previousValue);
    return [key, {
      current: currentValue,
      previous: previousValue,
      delta,
      delta_percent: previousValue ? rounded((delta / Math.abs(previousValue)) * 100) : null,
    }];
  }));

  return {
    current,
    previous,
    calculations,
  };
}

module.exports = {
  calculateIncomeStatement,
  compareReports,
  groupTrialBalance,
  matchMapping,
};
