const SECTION_LABELS = {
  operating_revenue: 'Produits d exploitation',
  operating_expenses: 'Charges d exploitation',
  financial_result: 'Resultat financier',
  exceptional_result: 'Resultat exceptionnel',
  income_tax: 'Impots sur les benefices',
  to_classify: 'Comptes a classer',
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

function accountClass(line = {}) {
  return accountNumber(line).charAt(0);
}

function isProfitAndLossAccount(line = {}) {
  return ['6', '7'].includes(accountClass(line));
}

function accountSense(line = {}) {
  const cls = accountClass(line);
  if (cls === '6') return 'charge';
  if (cls === '7') return 'produit';
  return 'hors_resultat';
}

function inferredToClassifyMapping(line = {}) {
  const cls = accountClass(line);
  if (cls === '6') {
    return {
      account_prefix: '6',
      section_code: 'to_classify',
      subsection_code: 'charges_to_classify',
      display_label: 'Comptes a classer - charges',
      calculation_sign: -1,
      display_order: 9000,
      inferred: true,
    };
  }
  if (cls === '7') {
    return {
      account_prefix: '7',
      section_code: 'to_classify',
      subsection_code: 'products_to_classify',
      display_label: 'Comptes a classer - produits',
      calculation_sign: 1,
      display_order: 9010,
      inferred: true,
    };
  }
  return null;
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
    is_to_classify: Boolean(mapping.inferred) || mapping.section_code === 'to_classify',
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
    sense: accountSense(line),
    is_to_classify: Boolean(mapping.inferred),
  });
}

function groupTrialBalance(lines = [], mappings = []) {
  const buckets = new Map();
  const unknownAccounts = [];
  const ignoredAccounts = [];
  let classifiedCount = 0;
  let toClassifyCount = 0;
  let profitAndLossCount = 0;

  for (const line of lines) {
    const isProfitAndLoss = isProfitAndLossAccount(line);
    if (isProfitAndLoss) profitAndLossCount += 1;
    let mapping = matchMapping(line, mappings);
    if (!mapping) {
      mapping = inferredToClassifyMapping(line);
    }
    if (!mapping) {
      ignoredAccounts.push({
        account_number: line.account_number,
        formatted_account_number: line.formatted_account_number || line.account_number,
        account_label: line.account_label,
        total_debit: num(line.total_debit),
        total_credit: num(line.total_credit),
        net_balance: rounded(line.net_balance ?? (num(line.total_credit) - num(line.total_debit))),
        sense: accountSense(line),
      });
      continue;
    }
    if (mapping.inferred) {
      toClassifyCount += 1;
      unknownAccounts.push({
        account_number: line.account_number,
        formatted_account_number: line.formatted_account_number || line.account_number,
        account_label: line.account_label,
        total_debit: num(line.total_debit),
        total_credit: num(line.total_credit),
        net_balance: rounded(line.net_balance ?? (num(line.total_credit) - num(line.total_debit))),
        amount: rounded((line.net_balance ?? (num(line.total_credit) - num(line.total_debit))) * Number(mapping.calculation_sign || 1)),
        sense: accountSense(line),
      });
    } else if (isProfitAndLoss) {
      classifiedCount += 1;
    }
    const key = `${mapping.section_code}:${mapping.subsection_code || 'general'}:${mapping.display_label}`;
    if (!buckets.has(key)) buckets.set(key, emptyBucket(mapping));
    addLineToBucket(buckets.get(key), line, mapping);
  }

  return {
    sections: Array.from(buckets.values()).sort((a, b) => a.display_order - b.display_order),
    unknown_accounts: unknownAccounts,
    ignored_accounts: ignoredAccounts,
    class_6_7_count: profitAndLossCount,
    classified_count: classifiedCount,
    to_classify_count: toClassifyCount,
  };
}

function profitAndLossTotalsFromLines(lines = []) {
  return lines.reduce((totals, line) => {
    const debit = num(line.total_debit);
    const credit = num(line.total_credit);
    if (accountClass(line) === '6') {
      totals.charges = rounded(totals.charges + debit - credit);
      totals.account_count += 1;
    } else if (accountClass(line) === '7') {
      totals.products = rounded(totals.products + credit - debit);
      totals.account_count += 1;
    }
    totals.result = rounded(totals.products - totals.charges);
    return totals;
  }, { charges: 0, products: 0, result: 0, account_count: 0 });
}

function profitAndLossTotalsFromSections(sections = []) {
  const totals = { charges: 0, products: 0, result: 0, account_count: 0 };
  for (const section of sections) {
    for (const account of section.accounts || []) {
      if (account.sense === 'charge' || accountClass(account) === '6') {
        totals.charges = rounded(totals.charges + num(account.amount));
        totals.account_count += 1;
      } else if (account.sense === 'produit' || accountClass(account) === '7') {
        totals.products = rounded(totals.products + num(account.amount));
        totals.account_count += 1;
      }
    }
  }
  totals.result = rounded(totals.products - totals.charges);
  return totals;
}

function consistencyControl(lines = [], sections = [], grouped = {}) {
  const pennylane = profitAndLossTotalsFromLines(lines);
  const alta = profitAndLossTotalsFromSections(sections);
  const gaps = {
    charges: rounded(alta.charges - pennylane.charges),
    products: rounded(alta.products - pennylane.products),
    result: rounded(alta.result - pennylane.result),
    account_count: alta.account_count - pennylane.account_count,
  };
  const isConforme = Math.abs(gaps.charges) < 0.01
    && Math.abs(gaps.products) < 0.01
    && Math.abs(gaps.result) < 0.01
    && gaps.account_count === 0;
  return {
    status: isConforme ? 'conforme' : 'ecart',
    pennylane,
    alta,
    gaps,
    class_6_7_count: grouped.class_6_7_count || 0,
    classified_count: grouped.classified_count || 0,
    to_classify_count: grouped.to_classify_count || 0,
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
  const consistency = consistencyControl(lines, sections, grouped);

  const revenue = subsectionTotal(sections, 'revenue');
  const operatingRevenue = sectionTotal(sections, 'operating_revenue');
  const goodsPurchases = subsectionTotal(sections, 'goods_purchases');
  const otherPurchases = subsectionTotal(sections, 'purchases');
  const purchases = rounded(goodsPurchases + otherPurchases);
  const stockVariation = subsectionTotal(sections, 'stock_variation');
  const purchasesConsumed = rounded(purchases + stockVariation);
  const grossMargin = rounded(revenue - purchasesConsumed);
  const marginRate = revenue ? rounded((grossMargin / revenue) * 100) : null;
  const externalServices = subsectionTotal(sections, 'external_services');
  const otherExternalServices = subsectionTotal(sections, 'other_external_services');
  const transport = subsectionTotal(sections, 'transport');
  const externalCharges = rounded(externalServices + otherExternalServices + transport);
  const taxes = subsectionTotal(sections, 'taxes');
  const wages = subsectionTotal(sections, 'wages');
  const socialCharges = subsectionTotal(sections, 'social_charges');
  const staffCosts = rounded(wages + socialCharges + subsectionTotal(sections, 'staff_costs'));
  const depreciation = subsectionTotal(sections, 'depreciation');
  const otherOperatingExpenses = sumBy(sections, (section) => (
    section.section_code === 'operating_expenses'
    && ![
      'goods_purchases',
      'purchases',
      'stock_variation',
      'external_services',
      'other_external_services',
      'transport',
      'taxes',
      'wages',
      'social_charges',
      'staff_costs',
      'depreciation',
    ].includes(section.subsection_code)
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
  const netResult = consistency.alta.result;
  const periodEndDate = periodEnd ? new Date(`${periodEnd}T23:59:59Z`) : null;
  const provisional = !snapshot || snapshot.status !== 'success' || !periodEndDate || periodEndDate >= now;

  return {
    period_start: periodStart || snapshot?.period_start || null,
    period_end: periodEnd || snapshot?.period_end || null,
    snapshot,
    convention: 'Solde comptable = credit - debit. Les correspondances de charges transforment ce solde en montant de charge positif; les resultats soustraient ensuite ces charges.',
    provisional,
    incomplete: grouped.unknown_accounts.length > 0 || lines.length === 0 || consistency.status !== 'conforme',
    kpis: {
      revenue,
      purchases,
      gross_margin: grossMargin,
      margin_rate: marginRate,
      operating_charges: rounded(operatingExpenses - purchasesConsumed),
      ebitda,
      operating_result: operatingResult,
      current_result: currentResult,
      net_result: netResult,
    },
    calculations: {
      revenue,
      operating_revenue: operatingRevenue,
      goods_purchases: goodsPurchases,
      other_purchases: otherPurchases,
      purchases,
      stock_variation: stockVariation,
      purchases_consumed: purchasesConsumed,
      gross_margin: grossMargin,
      margin_rate: marginRate,
      external_services: externalServices,
      other_external_services: otherExternalServices,
      transport,
      external_charges: externalCharges,
      taxes,
      wages,
      social_charges: socialCharges,
      staff_costs: staffCosts,
      ebitda,
      depreciation,
      operating_result: operatingResult,
      financial_result: financialResult,
      current_result: currentResult,
      exceptional_result: exceptionalResult,
      income_tax: incomeTax,
      net_result: netResult,
      total_charges: consistency.alta.charges,
      total_products: consistency.alta.products,
    },
    sections,
    unknown_accounts: grouped.unknown_accounts,
    ignored_accounts: grouped.ignored_accounts,
    consistency_control: consistency,
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
  consistencyControl,
  groupTrialBalance,
  matchMapping,
};
