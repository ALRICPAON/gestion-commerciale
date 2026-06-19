const https = require('https');

const WHATSAPP_GRAPH_VERSION = 'v25.0';
const FREE_TEXT_TEMPLATE_ERROR = 'WhatsApp impose l’utilisation d’un modèle/template pour contacter ce numéro hors conversation récente.';

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

function hasPhoneNumberId() {
  return Boolean(clean(process.env.WHATSAPP_PHONE_NUMBER_ID));
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

function normalizePhoneNumber(value) {
  return normalizePhone(value);
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

function maskPhoneNumber(value) {
  const phone = normalizePhone(value) || clean(value) || '';
  if (!phone) return '-';
  if (phone.length <= 4) return '****';
  return `${phone.slice(0, 3)}****${phone.slice(-2)}`;
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

function isTemplateWindowError(message = '') {
  return /template|24\s*h|24-hour|24 hour|outside.*window|customer care window|re-engage|reengage|outside.*allowed/i.test(String(message));
}

function publicWhatsappError(error) {
  const message = clean(error?.meta_message) || clean(error?.message) || 'Erreur envoi WhatsApp';
  if (isTemplateWindowError(message)) return FREE_TEXT_TEMPLATE_ERROR;
  return message;
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
        if (res.statusCode >= 200 && res.statusCode < 300) {
          return resolve({ status: res.statusCode, data: parsed });
        }
        const error = new Error(sanitizeMetaError(parsed));
        error.status = res.statusCode || 502;
        error.expose = res.statusCode < 500;
        error.meta_message = sanitizeMetaError(parsed);
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
  try {
    const recipient = normalizeRequiredPhone(to);
    const body = clean(message);

    if (!body) {
      const error = new Error('Message WhatsApp vide');
      error.status = 400;
      error.expose = true;
      throw error;
    }

    const phoneNumberId = requireEnv('WHATSAPP_PHONE_NUMBER_ID');
    const { status, data } = await postJson(`/${WHATSAPP_GRAPH_VERSION}/${phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'text',
      text: {
        body,
      },
    });

    return {
      success: Boolean(data.messages?.[0]?.id),
      to: recipient,
      status,
      message_id: data.messages?.[0]?.id || null,
      result: data,
      error: null,
    };
  } catch (error) {
    return {
      success: false,
      to: normalizePhone(to),
      status: error.status || 500,
      message_id: null,
      result: null,
      error: publicWhatsappError(error),
    };
  }
}

async function sendTemplateMessage(to, templateName, languageCode = 'fr', bodyParameters = []) {
  let options = null;
  if (typeof to === 'object' && to !== null) {
    options = to;
  }

  const recipient = normalizeRequiredPhone(options ? options.to : to);
  const name = clean(options ? options.templateName : templateName) || clean(process.env.WHATSAPP_DELIVERY_NOTE_TEMPLATE_NAME);
  const language = clean(options ? options.languageCode : languageCode) || clean(process.env.WHATSAPP_DEFAULT_LANGUAGE) || 'fr';
  const parameters = Array.isArray(options?.bodyParameters) ? options.bodyParameters : bodyParameters;

  if (!name) {
    const error = new Error('Template WhatsApp non configure');
    error.status = 500;
    throw error;
  }

  const bodyComponent = parameters.length > 0
    ? [{ type: 'body', parameters: parameters.map(templateParameter) }]
    : [];

  const payload = {
    messaging_product: 'whatsapp',
    to: recipient,
    type: 'template',
    template: {
      name,
      language: {
        code: language,
      },
      ...(bodyComponent.length > 0 ? { components: bodyComponent } : {}),
    },
  };

  const phoneNumberId = requireEnv('WHATSAPP_PHONE_NUMBER_ID');
  const { status, data } = await postJson(`/${WHATSAPP_GRAPH_VERSION}/${phoneNumberId}/messages`, payload);
  return {
    to: recipient,
    template: name,
    language_code: language,
    status,
    message_id: data.messages?.[0]?.id || null,
    result: data,
  };
}

module.exports = {
  FREE_TEXT_TEMPLATE_ERROR,
  hasPhoneNumberId,
  maskPhoneNumber,
  normalizePhone,
  normalizePhoneNumber,
  publicWhatsappError,
  sendTemplateMessage,
  sendTextMessage,
};
