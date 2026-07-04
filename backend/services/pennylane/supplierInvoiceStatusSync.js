const { PennylaneApiError, createPennylaneClient } = require('./client');

const VALIDATED_PAYMENT_STATUS = 'to_be_paid';

function redactSensitivePayload(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redactSensitivePayload);

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (/authorization|api[_-]?token|access[_-]?token|refresh[_-]?token|secret/i.test(key)) {
        return [key, '[REDACTED]'];
      }

      return [key, redactSensitivePayload(entry)];
    })
  );
}

function sanitizePennylaneError(error) {
  if (error instanceof PennylaneApiError) {
    return {
      message: error.message,
      status: error.status,
      code: error.code,
      responseBody: redactSensitivePayload(error.responseBody),
    };
  }

  return {
    message: error.message || 'Erreur Pennylane inattendue',
  };
}

async function syncValidatedSupplierInvoiceStatusToPennylane({
  invoiceId,
  pennylaneSupplierInvoiceId,
  storeId,
}) {
  if (!pennylaneSupplierInvoiceId) {
    return { ok: true, skipped: true, reason: 'PENNYLANE_SUPPLIER_INVOICE_ID_MISSING' };
  }

  const client = createPennylaneClient();
  const endpoint = `/supplier_invoices/${encodeURIComponent(pennylaneSupplierInvoiceId)}/payment_status`;

  try {
    const response = await client.put(endpoint, { payment_status: VALIDATED_PAYMENT_STATUS });
    console.log('[Pennylane supplier invoice status] validation ALTA envoyée', {
      invoice_id: invoiceId,
      pennylane_supplier_invoice_id: pennylaneSupplierInvoiceId,
      store_id: storeId,
      endpoint,
      payment_status: VALIDATED_PAYMENT_STATUS,
      http_status: response.status,
    });

    return {
      ok: true,
      skipped: false,
      pennylane_supplier_invoice_id: pennylaneSupplierInvoiceId,
      payment_status: VALIDATED_PAYMENT_STATUS,
      http_status: response.status,
    };
  } catch (error) {
    const sanitizedError = sanitizePennylaneError(error);
    console.error('[Pennylane supplier invoice status] erreur envoi statut', {
      invoice_id: invoiceId,
      pennylane_supplier_invoice_id: pennylaneSupplierInvoiceId,
      store_id: storeId,
      endpoint,
      target_payment_status: VALIDATED_PAYMENT_STATUS,
      error: sanitizedError,
    });

    error.pennylaneStatusSync = sanitizedError;
    throw error;
  }
}

module.exports = {
  VALIDATED_PAYMENT_STATUS,
  syncValidatedSupplierInvoiceStatusToPennylane,
};
