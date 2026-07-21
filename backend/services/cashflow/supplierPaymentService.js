const CONFIRMED_PAYMENT_STATUSES = new Set(['paid_out', 'confirmed', 'found']);
const PENDING_PAYMENT_STATUSES = new Set(['initiated', 'pending', 'emitted']);
const CANCELLED_PAYMENT_STATUSES = new Set(['cancelled', 'failed', 'refunded']);

function normalizePaymentStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function classifySupplierPaymentStatus(status) {
  const normalized = normalizePaymentStatus(status);
  return {
    status: normalized || null,
    is_confirmed: CONFIRMED_PAYMENT_STATUSES.has(normalized),
    is_pending: PENDING_PAYMENT_STATUSES.has(normalized),
    is_cancelled: CANCELLED_PAYMENT_STATUSES.has(normalized),
  };
}

function calculateSupplierInvoicePaymentAmounts({ totalAmount = 0, payments = [], pennylaneRemainingAmount = null } = {}) {
  const confirmed = payments
    .filter((payment) => classifySupplierPaymentStatus(payment.status).is_confirmed)
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const pending = payments
    .filter((payment) => classifySupplierPaymentStatus(payment.status).is_pending)
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const remainingFromPennylane = pennylaneRemainingAmount === null || pennylaneRemainingAmount === undefined
    ? null
    : Number(pennylaneRemainingAmount);
  const remaining = Number.isFinite(remainingFromPennylane)
    ? Math.max(remainingFromPennylane, 0)
    : Math.max(Number(totalAmount || 0) - confirmed, 0);

  return {
    confirmed_paid_amount: Math.round(confirmed * 100) / 100,
    pending_payment_amount: Math.round(pending * 100) / 100,
    remaining_to_pay: Math.round(remaining * 100) / 100,
  };
}

module.exports = {
  CANCELLED_PAYMENT_STATUSES,
  CONFIRMED_PAYMENT_STATUSES,
  PENDING_PAYMENT_STATUSES,
  calculateSupplierInvoicePaymentAmounts,
  classifySupplierPaymentStatus,
};
