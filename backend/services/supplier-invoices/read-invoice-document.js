const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');

async function readPdfText(buffer) {
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  return String(result?.text || '');
}

async function readInvoiceDocument(file) {
  if (!file?.path) return { text: '', buffer: null, extension: '', originalName: null };

  const buffer = await fs.promises.readFile(file.path);
  const originalName = file.originalname || file.filename || '';
  const extension = path.extname(originalName).toLowerCase();

  let text = '';
  if (extension === '.pdf' || file.mimetype === 'application/pdf') {
    text = await readPdfText(buffer);
  } else if (extension === '.csv') {
    text = buffer.toString('utf8');
  }

  return {
    text,
    buffer,
    extension,
    originalName,
    mimeType: file.mimetype || null,
  };
}

module.exports = {
  readInvoiceDocument,
};
