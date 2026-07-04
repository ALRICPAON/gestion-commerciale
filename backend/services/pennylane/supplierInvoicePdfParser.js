const PDF_DOWNLOAD_TIMEOUT_MS = 20000;
const PDF_MAX_BYTES = 15 * 1024 * 1024;
const DISTRIMER_PARSER_NAME = 'distrimer_pdf_v1';

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value)
    .replace(/\s+/g, '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, '');
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isUnit(value) {
  return /^(KG|KGS|KILO|KILOS|G|U|UN|PCE|PCS|PIECE|PIECES|COLIS|L|LT|LITRE|LITRES|SAC|BAC|CAISSE|CT|BT)$/i.test(
    String(value || '').replace(/[.:;]+$/g, '')
  );
}

function normalizeUnit(value) {
  const unit = String(value || '').replace(/[.:;]+$/g, '').toUpperCase();
  if (unit === 'KGS' || unit === 'KILO' || unit === 'KILOS') return 'KG';
  if (unit === 'UN' || unit === 'PCE' || unit === 'PCS' || unit === 'PIECE' || unit === 'PIECES') return 'U';
  if (unit === 'LT' || unit === 'LITRE' || unit === 'LITRES') return 'L';
  return unit || null;
}

function isNumericToken(value) {
  return toNumberOrNull(value) !== null;
}

function shouldSkipLine(line) {
  return (
    !line ||
    line.length < 8 ||
    /^(total|sous-total|tva|net a payer|net à payer|echeance|échéance|iban|bic|siret|ape|code client|facture|avoir)\b/i.test(line) ||
    /\b(total ht|total ttc|base ht|montant tva|conditions de paiement)\b/i.test(line)
  );
}

function parseVatToken(value) {
  const amount = toNumberOrNull(value);
  if (amount === null || amount < 0 || amount > 30) return null;
  return String(amount).replace('.', ',');
}

function parseDistrimerLine(line, position) {
  const text = cleanText(line);
  if (shouldSkipLine(text)) return null;

  const tokens = text.split(/\s+/);
  for (let index = tokens.length - 3; index >= 1; index -= 1) {
    if (!isUnit(tokens[index])) continue;
    if (!isNumericToken(tokens[index - 1]) || !isNumericToken(tokens[index + 1]) || !isNumericToken(tokens[index + 2])) continue;

    const label = cleanText(tokens.slice(0, index - 1).join(' '));
    if (!label || label.length < 3) continue;

    const quantity = toNumberOrNull(tokens[index - 1]);
    const rawCurrencyUnitPrice = toNumberOrNull(tokens[index + 1]);
    const amount = toNumberOrNull(tokens[index + 2]);
    const vatRate = parseVatToken(tokens[index + 3]);

    if (quantity === null || rawCurrencyUnitPrice === null || amount === null) continue;

    return {
      id: `pdf-${position}`,
      label,
      description: label,
      quantity,
      unit: normalizeUnit(tokens[index]),
      raw_currency_unit_price: rawCurrencyUnitPrice,
      currency_unit_price: rawCurrencyUnitPrice,
      unit_price: rawCurrencyUnitPrice,
      currency_amount: amount,
      amount,
      vat_rate: vatRate,
      raw_payload: {
        source_lignes: 'pdf_fallback',
        pdf_parser_name: DISTRIMER_PARSER_NAME,
        pdf_line_text: text,
      },
    };
  }

  return null;
}

function normalizePdfTextLines(text) {
  const rawLines = String(text || '')
    .split(/\r?\n/)
    .map(cleanText)
    .filter(Boolean);

  const merged = [];
  for (const line of rawLines) {
    if (/^\d+(?:[,.]\d+)?\s*(?:KG|KGS|U|UN|PCE|PCS|PIECE|PIECES|COLIS|L|LT)\b/i.test(line) && merged.length) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${line}`;
      continue;
    }
    merged.push(line);
  }

  return merged;
}

function parseDistrimerInvoiceText(text) {
  const lines = [];
  for (const line of normalizePdfTextLines(text)) {
    const parsed = parseDistrimerLine(line, lines.length + 1);
    if (parsed) lines.push(parsed);
  }
  return lines;
}

async function downloadPdf(publicFileUrl) {
  if (!publicFileUrl) {
    throw new Error('PDF_PUBLIC_FILE_URL_MISSING');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PDF_DOWNLOAD_TIMEOUT_MS);

  try {
    const response = await fetch(publicFileUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/pdf,*/*' },
    });

    if (!response.ok) {
      throw new Error(`PDF_DOWNLOAD_HTTP_${response.status}`);
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > PDF_MAX_BYTES) {
      throw new Error('PDF_TOO_LARGE');
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > PDF_MAX_BYTES) {
      throw new Error('PDF_TOO_LARGE');
    }

    return buffer;
  } finally {
    clearTimeout(timeout);
  }
}

async function parsePdfText(pdfBuffer) {
  const pdfParse = require('pdf-parse');

  if (typeof pdfParse === 'function') {
    const parsed = await pdfParse(pdfBuffer);
    return parsed?.text || '';
  }

  if (typeof pdfParse?.default === 'function') {
    const parsed = await pdfParse.default(pdfBuffer);
    return parsed?.text || '';
  }

  if (typeof pdfParse?.PDFParse === 'function') {
    const parser = new pdfParse.PDFParse({ data: pdfBuffer });
    try {
      const parsed = await parser.getText();
      return parsed?.text || '';
    } finally {
      await parser.destroy?.();
    }
  }

  throw new Error('PDF_PARSE_EXPORT_UNSUPPORTED');
}

function selectParser(invoice, text) {
  const haystack = [
    invoice?.supplier?.name,
    invoice?.supplier_name,
    invoice?.pennylane_filename,
    invoice?.filename,
    text,
  ].map((value) => String(value || '').toUpperCase()).join(' ');

  if (haystack.includes('DISTRIMER')) {
    return {
      name: DISTRIMER_PARSER_NAME,
      parse: parseDistrimerInvoiceText,
    };
  }

  return null;
}

async function extractSupplierInvoicePdfLines({ invoice, publicFileUrl }) {
  const result = {
    source_lignes: 'pdf_fallback',
    pdf_lines_count: 0,
    pdf_parser_name: null,
    pdf_parse_error: null,
    lines: [],
  };

  try {
    const pdfBuffer = await downloadPdf(publicFileUrl);
    const text = await parsePdfText(pdfBuffer);
    const parser = selectParser(invoice, text);
    if (!parser) {
      throw new Error('PDF_SUPPLIER_PARSER_NOT_FOUND');
    }

    const lines = parser.parse(text);
    result.pdf_parser_name = parser.name;
    result.pdf_lines_count = lines.length;
    result.lines = lines;
  } catch (error) {
    result.pdf_parse_error = error.message || 'PDF_PARSE_FAILED';
  }

  return result;
}

module.exports = {
  extractSupplierInvoicePdfLines,
  parseDistrimerInvoiceText,
};
