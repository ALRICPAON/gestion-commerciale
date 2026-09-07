const assert = require("assert");
const fs = require("fs");
const path = require("path");

const lecriMaree = require("../services/imports/parsers/parser-lecrimaree");
const normalizeImportOutput = require("../services/imports/normalize-import-output");

const parserPath = path.join(__dirname, "../services/imports/parsers/parser-lecrimaree.js");

const sampleLecriMareeText = `
LECRI MAREE
000001560 filet de saumon 1.5/2 ECOSSE 4 10,00 K 49,590 14,50 719,06
Lignes / Salmo salar Lot N : LC260907
FAO 27 VIII
`;

async function testParsedImportUsesAltaSupplierCode() {
  const result = await lecriMaree.parse({
    text: sampleLecriMareeText,
    originalname: "lecri-maree-bl.pdf",
    originalnameLower: "lecri-maree-bl.pdf",
    ext: ".pdf",
  });
  const normalized = normalizeImportOutput(result);

  assert.strictEqual(normalized.supplier_code, "LECRIMAREE");
  assert.ok(normalized.supplier_name.toUpperCase().startsWith("LECRI"));
  assert.strictEqual(normalized.lines.length, 1);
  assert.strictEqual(normalized.lines[0].supplier_reference, "000001560");
  assert.strictEqual(normalized.lines[0].ordered_colis, 4);
  assert.strictEqual(normalized.lines[0].total_weight_kg, 49.59);
  assert.strictEqual(normalized.lines[0].unit_price_ex_vat, 14.5);
}

async function testEmptyPdfTextUsesAltaSupplierCode() {
  const result = await lecriMaree.parse({
    text: "",
    originalname: "lecri-maree-vide.pdf",
    originalnameLower: "lecri-maree-vide.pdf",
    ext: ".pdf",
  });
  const normalized = normalizeImportOutput(result);

  assert.strictEqual(normalized.supplier_code, "LECRIMAREE");
  assert.strictEqual(normalized.lines.length, 0);
  assert.ok(normalized.warnings.some((warning) => warning.includes("Texte PDF vide")));
}

async function testUnreadablePdfUsesAltaSupplierCode() {
  const result = await lecriMaree.parse({
    buffer: Buffer.from("not a pdf"),
    originalname: "lecri-maree-invalide.pdf",
    originalnameLower: "lecri-maree-invalide.pdf",
    ext: ".pdf",
  });
  const normalized = normalizeImportOutput(result);

  assert.strictEqual(normalized.supplier_code, "LECRIMAREE");
  assert.strictEqual(normalized.lines.length, 0);
  assert.ok(normalized.warnings.some((warning) => warning.includes("Impossible de lire le PDF")));
}

function testNoLegacyCodeLookupInLecriParser() {
  const source = fs.readFileSync(parserPath, "utf8");
  assert.ok(!source.includes('"10013"'), "parser-lecrimaree must not emit legacy RayonV2 supplier code 10013");
  assert.ok(source.includes('"LECRIMAREE"'), "parser-lecrimaree must emit ALTA supplier code LECRIMAREE");
}

(async () => {
  await testParsedImportUsesAltaSupplierCode();
  await testEmptyPdfTextUsesAltaSupplierCode();
  await testUnreadablePdfUsesAltaSupplierCode();
  testNoLegacyCodeLookupInLecriParser();
  console.log("OK test-lecrimaree-import-supplier-code");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
