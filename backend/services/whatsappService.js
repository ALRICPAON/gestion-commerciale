const https = require('https');

const TEST_MESSAGE_GRAPH_VERSION = 'v25.0';

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function configurationError() {
  const error = new Error('Configuration WhatsApp incomplete');
  error.status = 503;
  error.expose = true;
  return error;
}

function requireEnv(name) {
  const value = clean(process.env[name]);
  if (!value) {
    throw configurationError();
  }
  return value;
}

function normalizePhone(value) {
  const raw = clean(value);
  if (!raw) return null;
  const defaultCountryCode = clean(process.env.WHATSAPP_DEFAULT_COUNTRY_CODE) || '33';
  let phone = raw.replace(/[^0-9+]/g, '');
  if (phone.startsWith('00')) phone = phone.slice(2);
  if (phone.startsWith('+')) phone = phone.slice(1);
  if (phone.startsWith('0')) phone = `${defaultCountryCode}${phone.slice(1)}`;
  return phone || null;
}

function normalizeRequiredPhone(value) {
  const phone = normalizePhone(value);
  if (!phone || !/^[1-9]\d{6,14}$/.test(phone)) {
    const error = new Error('Numero WhatsApp destinataire invalide');
    error.status = 400;
    error.expose = true;
    throw error;
  }
  return phone;
}

function graphVersion() {
  return clean(process.env.WHATSAPP_API_VERSION) || 'v20.0';
}

function graphHost() {
  return clean(process.env.WHATSAPP_API_HOST) || 'graph.facebook.com';
}

function sanitizeMetaError(parsed = {}) {
  const metaError = parsed.error || {};
  const message = clean(metaError.message) || 'Erreur WhatsApp Cloud API';
  const code = metaError.code ? `Code Meta ${metaError.code}` : null;
  const type = clean(metaError.type);
  return [message, type, code].filter(Boolean).join(' - ');
}

function postJson(path, payload) {
  const body = JSON.stringify(payload);
  const options = {
    hostname: graphHost(),
    path,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requireEnv('WHATSAPP_ACCESS_TOKEN')}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = {};
        try { parsed = data ? JSON.parse(data) : {}; }
        catch { parsed = {}; }
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(parsed);
        const error = new Error(sanitizeMetaError(parsed));
        error.status = res.statusCode || 502;
        error.expose = res.statusCode < 500;
        return reject(error);
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function templateParameter(value) {
  return {
    type: 'text',
    text: String(value ?? '-'),
  };
}

async function sendTextMessage(to, message) {
  const recipient = normalizeRequiredPhone(to);
  const body = clean(message);

  if (!body) {
    const error = new Error('Message WhatsApp vide');
    error.status = 400;
    error.expose = true;
    throw error;
  }

  const phoneNumberId = requireEnv('WHATSAPP_PHONE_NUMBER_ID');
  const result = await postJson(`/${TEST_MESSAGE_GRAPH_VERSION}/${phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    to: recipient,
    type: 'text',
    text: {
      body,
    },
  });

  return {
    to: recipient,
    message_id: result.messages?.[0]?.id || null,
  };
}

async function sendTemplateMessage({ to, templateName, languageCode, bodyParameters = [] }) {
  const recipient = normalizeRequiredPhone(to);

  const name = clean(templateName) || clean(process.env.WHATSAPP_DELIVERY_NOTE_TEMPLATE_NAME);
  if (!name) {
    const error = new Error('Template WhatsApp BL non configure');
    error.status = 500;
    throw error;
  }

  const payload = {
    messaging_product: 'whatsapp',
    to: recipient,
    type: 'template',
    template: {
      name,
      language: {
        code: clean(languageCode) || clean(process.env.WHATSAPP_DEFAULT_LANGUAGE) || 'fr',
      },
      components: [
        {
          type: 'body',
          parameters: bodyParameters.map(templateParameter),
        },
      ],
    },
  };

  const phoneNumberId = requireEnv('WHATSAPP_PHONE_NUMBER_ID');
  const result = await postJson(`/${graphVersion()}/${phoneNumberId}/messages`, payload);
  return {
    to: recipient,
    template: name,
    result,
  };
}

module.exports = {
  normalizePhone,
  sendTemplateMessage,
  sendTextMessage,
};
