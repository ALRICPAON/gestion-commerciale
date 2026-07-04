const { getPennylaneConfig } = require('./config');

const DEBUG_RESPONSE_PREVIEW_CHARS = 6000;

class PennylaneApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'PennylaneApiError';
    this.status = options.status || null;
    this.code = options.code || null;
    this.responseBody = options.responseBody || null;
  }
}

function buildUrl(config, endpoint) {
  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${config.apiBaseUrl}${normalizedEndpoint}`;
}

async function parseResponseBody(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json().catch(() => null);
  }

  const text = await response.text().catch(() => '');
  return text ? { raw: text.slice(0, 1000) } : null;
}

function withJsonBody(options, body) {
  if (body === undefined) return options;

  return {
    ...options,
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  };
}

function shouldDebugSupplierInvoiceLines(endpoint) {
  return String(endpoint || '').includes('/supplier_invoices/') && String(endpoint || '').includes('/invoice_lines');
}

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

function payloadKeys(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  return Object.keys(payload);
}

function nestedPayloadKeys(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};

  return Object.fromEntries(
    Object.entries(payload)
      .filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value))
      .slice(0, 10)
      .map(([key, value]) => [key, payloadKeys(value)])
  );
}

function previewJsonPayload(payload) {
  if (payload === undefined) return null;

  try {
    return JSON.stringify(redactSensitivePayload(payload)).slice(0, DEBUG_RESPONSE_PREVIEW_CHARS);
  } catch {
    return '[UNSERIALIZABLE_PAYLOAD]';
  }
}

function extractDebugListCount(payload) {
  if (!payload || typeof payload !== 'object') return 0;
  if (Array.isArray(payload)) return payload.length;
  if (Array.isArray(payload.items)) return payload.items.length;
  if (Array.isArray(payload.data)) return payload.data.length;
  if (Array.isArray(payload.invoice_lines)) return payload.invoice_lines.length;
  if (Array.isArray(payload.supplier_invoice_lines)) return payload.supplier_invoice_lines.length;
  if (Array.isArray(payload.lines)) return payload.lines.length;
  if (payload.data && typeof payload.data === 'object') return extractDebugListCount(payload.data);
  if (payload.invoice_lines && typeof payload.invoice_lines === 'object') return extractDebugListCount(payload.invoice_lines);
  if (payload.supplier_invoice_lines && typeof payload.supplier_invoice_lines === 'object') {
    return extractDebugListCount(payload.supplier_invoice_lines);
  }
  return 0;
}

function logSupplierInvoiceLinesDebug({ endpoint, url, status, body, error }) {
  const payload = {
    scope: 'pennylane_supplier_invoice_lines_http',
    endpoint_called: endpoint,
    url_called: url,
    status_http: status || null,
    response_top_level_keys: payloadKeys(body),
    response_nested_keys: nestedPayloadKeys(body),
    extracted_lines_count_before_mapping: extractDebugListCount(body),
    raw_response_preview: previewJsonPayload(body),
    error: error
      ? {
          message: error.message,
          status: error.status || null,
          code: error.code || null,
        }
      : null,
  };

  const line = `[DEBUG Pennylane supplier invoice_lines HTTP] ${JSON.stringify(payload)}`;
  if (error || (status && status >= 400)) {
    console.error(line);
  } else {
    console.log(line);
  }
}

function createPennylaneClient(config = getPennylaneConfig()) {
  async function request(endpoint, options = {}) {
    if (!config.apiToken) {
      throw new PennylaneApiError('Token API Pennylane manquant', {
        code: 'PENNYLANE_TOKEN_MISSING',
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    const url = buildUrl(config, endpoint);
    const debugSupplierInvoiceLines = shouldDebugSupplierInvoiceLines(endpoint);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${config.apiToken}`,
          'X-Use-2026-API-Changes': 'true',
          ...(options.headers || {}),
        },
      });
      const body = await parseResponseBody(response);

      if (debugSupplierInvoiceLines) {
        logSupplierInvoiceLinesDebug({
          endpoint,
          url,
          status: response.status,
          body,
        });
      }

      if (!response.ok) {
        throw new PennylaneApiError('Erreur API Pennylane', {
          status: response.status,
          responseBody: body,
        });
      }

      return {
        status: response.status,
        body,
      };
    } catch (err) {
      if (err.name === 'AbortError') {
        const timeoutError = new PennylaneApiError('Timeout API Pennylane', {
          code: 'PENNYLANE_TIMEOUT',
        });
        if (debugSupplierInvoiceLines) {
          logSupplierInvoiceLinesDebug({ endpoint, url, status: null, body: null, error: timeoutError });
        }
        throw timeoutError;
      }

      if (err instanceof PennylaneApiError) {
        throw err;
      }

      const unavailableError = new PennylaneApiError('API Pennylane indisponible', {
        code: 'PENNYLANE_UNAVAILABLE',
        responseBody: { message: err.message },
      });
      if (debugSupplierInvoiceLines) {
        logSupplierInvoiceLinesDebug({ endpoint, url, status: null, body: unavailableError.responseBody, error: unavailableError });
      }
      throw unavailableError;
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    get(endpoint) {
      return request(endpoint, { method: 'GET' });
    },
    post(endpoint, body) {
      return request(endpoint, withJsonBody({ method: 'POST' }, body));
    },
    put(endpoint, body) {
      return request(endpoint, withJsonBody({ method: 'PUT' }, body));
    },
  };
}

module.exports = {
  PennylaneApiError,
  createPennylaneClient,
};