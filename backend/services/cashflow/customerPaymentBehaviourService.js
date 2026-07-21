const { addDays, isoDate } = require('./forecastService');

function average(values) {
  const valid = values.map(Number).filter((value) => Number.isFinite(value));
  if (!valid.length) return null;
  return Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length);
}

function daysBetween(start, end) {
  if (!start || !end) return null;
  const a = new Date(`${isoDate(start)}T00:00:00.000Z`);
  const b = new Date(`${isoDate(end)}T00:00:00.000Z`);
  const days = Math.round((b - a) / (24 * 60 * 60 * 1000));
  return Number.isFinite(days) ? days : null;
}

function calculateCustomerBehaviour(invoices = []) {
  const byClient = new Map();
  for (const invoice of invoices) {
    const key = invoice.client_id || invoice.client_name || 'unknown';
    if (!byClient.has(key)) byClient.set(key, []);
    byClient.get(key).push(invoice);
  }

  return Array.from(byClient.entries()).map(([clientId, rows]) => {
    const paidRows = rows.filter((row) => row.paid_at || row.payment_date);
    const invoiceToPayment = paidRows.map((row) => daysBetween(row.invoice_date || row.document_date, row.paid_at || row.payment_date));
    const dueToPayment = paidRows.map((row) => daysBetween(row.due_date || row.deadline, row.paid_at || row.payment_date));
    return {
      client_id: clientId === 'unknown' ? null : clientId,
      client_name: rows[0]?.client_name || rows[0]?.counterparty_name || 'Client',
      invoice_count: rows.length,
      paid_invoice_count: paidRows.length,
      average_invoice_to_payment_days: average(invoiceToPayment),
      average_due_delay_days: average(dueToPayment),
      reliability: paidRows.length >= 5 ? 'elevee' : (paidRows.length >= 2 ? 'moyenne' : 'faible'),
    };
  });
}

function forecastCustomerPaymentDate(invoice = {}, settings = {}) {
  if (invoice.expected_payment_date || invoice.due_date || invoice.deadline) {
    return isoDate(invoice.expected_payment_date || invoice.due_date || invoice.deadline);
  }
  const delay = Number(
    invoice.custom_delay_days
    ?? invoice.average_invoice_to_payment_days
    ?? invoice.theoretical_delay_days
    ?? settings.defaultCustomerDelayDays
    ?? 30
  );
  return addDays(invoice.invoice_date || invoice.document_date || new Date(), delay);
}

module.exports = {
  calculateCustomerBehaviour,
  daysBetween,
  forecastCustomerPaymentDate,
};
