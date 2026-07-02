const { getPennylaneConfig } = require('./config');

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

function createPennylaneClient(config = getPennylaneConfig()) {
  async function request(endpoint, options = {}) {
    if (!config.apiToken) {
      throw new PennylaneApiError('Token API Pennylane manquant', {
        code: 'PENNYLANE_TOKEN_MISSING',
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetch(buildUrl(config, endpoint), {
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
        throw new PennylaneApiError('Timeout API Pennylane', {
          code: 'PENNYLANE_TIMEOUT',
        });
      }

      if (err instanceof PennylaneApiError) {
        throw err;
      }

      throw new PennylaneApiError('API Pennylane indisponible', {
        code: 'PENNYLANE_UNAVAILABLE',
        responseBody: { message: err.message },
      });
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