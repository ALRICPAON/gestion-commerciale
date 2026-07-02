const DEFAULT_API_BASE_URL = 'https://app.pennylane.com/api/external/v2';
const DEFAULT_TEST_ENDPOINT = '/customer_invoices?limit=1&use_2026_api_changes=true';
const DEFAULT_TIMEOUT_MS = 10000;
const ALLOWED_ENVIRONMENTS = new Set(['sandbox', 'production']);

function normalizeEnabled(value) {
  return ['true', '1', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function normalizeEnvironment(value) {
  const environment = String(value || 'sandbox').trim().toLowerCase();
  return ALLOWED_ENVIRONMENTS.has(environment) ? environment : 'sandbox';
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_API_BASE_URL).trim().replace(/\/+$/, '');
}

function normalizeEndpoint(value) {
  const endpoint = String(value || DEFAULT_TEST_ENDPOINT).trim();
  return endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
}

function getApiToken(env, environment) {
  if (env.PENNYLANE_API_TOKEN) {
    return String(env.PENNYLANE_API_TOKEN).trim();
  }

  if (environment === 'production') {
    return String(env.PENNYLANE_PRODUCTION_TOKEN || '').trim();
  }

  return String(env.PENNYLANE_SANDBOX_TOKEN || '').trim();
}

function getPennylaneConfig(env = process.env) {
  const environment = normalizeEnvironment(env.PENNYLANE_ENV);

  return {
    enabled: normalizeEnabled(env.PENNYLANE_ENABLED),
    environment,
    apiToken: getApiToken(env, environment),
    apiBaseUrl: normalizeBaseUrl(env.PENNYLANE_API_BASE_URL),
    testEndpoint: normalizeEndpoint(env.PENNYLANE_TEST_ENDPOINT),
    timeoutMs: Number(env.PENNYLANE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  };
}

module.exports = {
  DEFAULT_API_BASE_URL,
  DEFAULT_TEST_ENDPOINT,
  getPennylaneConfig,
};
