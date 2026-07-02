const { PennylaneApiError, createPennylaneClient } = require('./client');
const { getPennylaneConfig } = require('./config');

function sanitizePennylaneResponse(response) {
  if (!response) return null;

  return {
    status: response.status || null,
    body: response.body || response.responseBody || null,
  };
}

function failureResult(config, message, response = null) {
  return {
    connected: false,
    environment: config.environment,
    message,
    pennylane_response: sanitizePennylaneResponse(response),
  };
}

async function testPennylaneConnection() {
  const config = getPennylaneConfig();

  if (!config.enabled) {
    return failureResult(config, 'Integration Pennylane desactivee cote backend.');
  }

  if (!config.apiToken) {
    return failureResult(config, 'Token API Pennylane manquant dans les variables d environnement.');
  }

  try {
    const client = createPennylaneClient(config);
    const response = await client.get(config.testEndpoint);

    return {
      connected: true,
      environment: config.environment,
      message: 'Connexion Pennylane OK.',
      pennylane_response: sanitizePennylaneResponse(response),
    };
  } catch (err) {
    if (err instanceof PennylaneApiError) {
      if (err.status === 401) {
        return failureResult(config, 'Token API Pennylane invalide ou expire.', err);
      }

      if (err.status === 403) {
        return failureResult(config, 'Acces refuse par Pennylane pour ce token ou ces scopes.', err);
      }

      if (err.status) {
        return failureResult(config, `Erreur Pennylane HTTP ${err.status}.`, err);
      }

      return failureResult(config, err.message, err);
    }

    return failureResult(config, 'Erreur inattendue pendant le test Pennylane.', {
      responseBody: { message: err.message },
    });
  }
}

module.exports = {
  testPennylaneConnection,
};
