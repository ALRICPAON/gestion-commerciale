const { readInvoiceDocument } = require('./read-invoice-document');
const distrimerParser = require('./parsers/parser-invoice-distrimer');
const sogelmerParser = require('./parsers/parser-invoice-sogelmer');

const PARSERS = [distrimerParser, sogelmerParser];

async function parseSupplierInvoice(file) {
  const document = await readInvoiceDocument(file);
  for (const parser of PARSERS) {
    if (!parser.canParse(document)) continue;
    const parsed = await parser.parse(document);
    if (parsed) {
      return {
        detected: true,
        parser: parsed.parser,
        message: parsed.message,
        invoice: parsed,
      };
    }
  }

  return {
    detected: false,
    parser: null,
    message: 'Document importé mais aucun parser disponible',
    invoice: null,
  };
}

module.exports = {
  parseSupplierInvoice,
};
