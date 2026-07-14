const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const servicesDir = path.join(rootDir, 'services');
const obsoleteColumnReference = 'sd.' + 'document_number';
const schemaFiles = [
  path.join(rootDir, 'db', 'gestion-commerciale', '035_sales_customer_order.sql'),
  path.join(rootDir, 'db', 'gestion-commerciale', 'purchases_sales_stock.sql'),
];

function walkFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, files);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

function fail(message, details = []) {
  console.error(`[sales_documents reference check] ${message}`);
  details.forEach((detail) => console.error(`- ${detail}`));
  process.exitCode = 1;
}

const directColumnReads = [];
for (const file of walkFiles(servicesDir)) {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.includes(obsoleteColumnReference)) {
      directColumnReads.push(`${path.relative(rootDir, file)}:${index + 1}: ${line.trim()}`);
    }
  });
}

const schemaHasReferenceNumber = schemaFiles.some((file) => {
  if (!fs.existsSync(file)) return false;
  return fs.readFileSync(file, 'utf8').includes('reference_number text');
});

if (directColumnReads.length > 0) {
  fail(`Lecture directe obsolete ${obsoleteColumnReference} detectee.`, directColumnReads);
}

if (!schemaHasReferenceNumber) {
  fail('Impossible de confirmer reference_number dans le schema sales_documents.');
}

if (process.exitCode !== 1) {
  console.log(`[sales_documents reference check] OK: reference_number present et aucune lecture directe ${obsoleteColumnReference}.`);
}
