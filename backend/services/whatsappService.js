const https = require('https');

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function requireEnv(name) {
  const value = clean(process.env[name]);
  if (!value) {
    const error = new Error(`Variable WhatsApp manquante: ${name}`);
    error.status = 500;
    throw error;
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

function graphVersion() {
  return clean(process.env.WHATSAPP_API_VERSION) || 'v20.0';
}

function graphHost() {
  return clean(process.env.WHATSAPP_API_HOST) || 'graph.facebook.com';
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
        catch { parsed = { raw: data }; }
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(parsed);
        const error = new Error(parsed?.error?.message || 'Erreur WhatsApp Cloud API');
        error.status = res.statusCode || 502;
        error.details = parsed;
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

async function sendTemplateMessage({ to, templateName, languageCode, bodyParameters = [] }) {
  const recipient = normalizePhone(to);
  if (!recipient) {
    const error = new Error('Numero WhatsApp destinataire manquant');
    error.status = 400;
    throw error;
  }

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
};
