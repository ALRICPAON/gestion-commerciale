const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { PDFDocument, rgb } = require("pdf-lib");

const importDocument = require("../services/imports/import-document");
const { renderPdfPagesToPngBase64 } = require("../services/imports/sogelmer-scanned-pdf-ocr");
const sogelmer = require("../services/imports/parsers/parser-sogelmer");

const recentSogelmerText = `
SOGELMER
N° BL Date Client 511-00081150 02/09/2026 ALTA MAREE
Code Designation Colis Pds colis Qte UV Lot Prix Montant
FILJUL58 FILET JULIENNE 5/800 GR 3 KG 5 3,00 15,00 KG 05050102501 11,40 € 171,00 €
FILLINB5
FILET LINGUE BLEUE 500/1000 3 KG
5
3,00
15,00
KG
05050102502
11,20
€
168,00
€
FILMOST7 FILET MOSTELLE DE FOND 2400 GR 3KG 3 3,00 9,00 KG 05050102503 7,40 EUR 66,60 EUR
RAI25001 AILE RAIE 2/500 GR PELE 1F 3 KG 3 3,00 9,00 KG 05050102504 9,40 € 84,60 €
QLO2500/ QUEUE LOTTE 200/500 GR 3 KG 3 3,00 9,00 KG 05050102505 13,40 € 120,60 €
FILEG120 FILET EGLEFIN 100/200 GR 3 KG 3 3,00 9,00 KG 05050102506 9,40 € 84,60 €
MERLU12 MERLU 1/2 KG 10KG 2 10,65 21,30 KG 05050102507 6,40 € 136,32 €
JOUEL0 JOUE LOTTE 3 KG 2 3,00 6,00 KG 05050102508 16,40 € 98,40 €
TOTAL 26 93,30 930,12
`;

const legacySogelmerText = `
SOGELMER
511-00070001
FILLINB/3 FILET LINGUE BLEUE 3 KG 3 3,00 9,00 KG 05050102514 16,50 € 148,50 € 1
Molva dypterygia - FAO 27 VIII - Chalut
3 X 3KG
`;

function sogelmerRawOcrLines(lastAmount = "98,40") {
  return [
    { index: 1, supplier_reference: "FILJUL58", designation: "FILET JULIENNE 5/800 GR 3 KG", colis: 5, poids_total_kg: "15,00", prix_kg: "11,40", montant_ht: "171,00", supplier_lot_number: "05050102501" },
    { index: 2, supplier_reference: "FILLINB5", designation: "FILET LINGUE BLEUE 500/1000 3 KG", colis: 5, poids_total_kg: "15,00", prix_kg: "11,20", montant_ht: "168,00", supplier_lot_number: "05050102502" },
    { index: 3, supplier_reference: "FILMOST7", designation: "FILET MOSTELLE DE FOND 2400 GR 3KG", colis: 3, poids_total_kg: "9,00", prix_kg: "7,40", montant_ht: "66,60", supplier_lot_number: "05050102503" },
    { index: 4, supplier_reference: "RAI25001", designation: "AILE RAIE 2/500 GR PELE 1F 3 KG", colis: 3, poids_total_kg: "9,00", prix_kg: "9,40", montant_ht: "84,60", supplier_lot_number: "05050102504" },
    { index: 5, supplier_reference: "QLO2500/", designation: "QUEUE LOTTE 200/500 GR 3 KG", colis: 3, poids_total_kg: "9,00", prix_kg: "13,40", montant_ht: "120,60", supplier_lot_number: "05050102505" },
    { index: 6, supplier_reference: "FILEG120", designation: "FILET EGLEFIN 100/200 GR 3 KG", colis: 3, poids_total_kg: "9,00", prix_kg: "9,40", montant_ht: "84,60", supplier_lot_number: "05050102506" },
    { index: 7, supplier_reference: "MERLU12", designation: "MERLU 1/2 KG 10KG", colis: 2, poids_total_kg: "21,30", prix_kg: "6,40", montant_ht: "136,32", supplier_lot_number: "05050102507" },
    { index: 8, supplier_reference: "JOUEL0", designation: "JOUE LOTTE 3 KG", colis: 2, poids_total_kg: "6,00", prix_kg: "16,40", montant_ht: lastAmount, supplier_lot_number: "05050102508" },
  ];
}

const sogelmerDocumentTotals = { colis: "26", poids_total_kg: "93,30", montant_ht: "930,12" };

async function testRecentLayout() {
  const result = await sogelmer.parse({
    text: recentSogelmerText,
    originalname: "alta maree.pdf",
    ext: ".pdf",
  });

  assert.strictEqual(result.supplier_name, "SOGELMER");
  assert.strictEqual(result.bl_number, "511-00081150");
  assert.strictEqual(result.meta.document_date, "02/09/2026");
  assert.strictEqual(result.lines.length, 8);
  assert.strictEqual(result.meta.total_weight, 93.3);
  assert.strictEqual(result.meta.total_amount_ex_vat, 930.12);
  assert.strictEqual(result.meta.diagnostics.ocr_fallback_used, false);

  const expected = [
    ["FILJUL58", "FILET JULIENNE 5/800 GR 3 KG", 5, 15, 11.4, 171],
    ["FILLINB5", "FILET LINGUE BLEUE 500/1000 3 KG", 5, 15, 11.2, 168],
    ["FILMOST7", "FILET MOSTELLE DE FOND 2400 GR 3KG", 3, 9, 7.4, 66.6],
    ["RAI25001", "AILE RAIE 2/500 GR PELE 1F 3 KG", 3, 9, 9.4, 84.6],
    ["QLO2500/", "QUEUE LOTTE 200/500 GR 3 KG", 3, 9, 13.4, 120.6],
    ["FILEG120", "FILET EGLEFIN 100/200 GR 3 KG", 3, 9, 9.4, 84.6],
    ["MERLU12", "MERLU 1/2 KG 10KG", 2, 21.3, 6.4, 136.32],
    ["JOUEL0", "JOUE LOTTE 3 KG", 2, 6, 16.4, 98.4],
  ];

  expected.forEach(([ref, label, colis, totalWeight, price, amount], index) => {
    const line = result.lines[index];
    assert.strictEqual(line.supplier_reference, ref);
    assert.strictEqual(line.designation, label);
    assert.strictEqual(line.ordered_colis, colis);
    assert.strictEqual(line.total_weight_kg, totalWeight);
    assert.strictEqual(line.unit_price_ex_vat, price);
    assert.strictEqual(line.line_amount_ex_vat, amount);
    assert.ok(line.supplier_lot_number, `lot expected on line ${index + 1}`);
  });
}

async function createImageOnlyPdf(filePath) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  page.drawRectangle({
    x: 40,
    y: 120,
    width: 515,
    height: 640,
    color: rgb(0.96, 0.96, 0.96),
    borderColor: rgb(0, 0, 0),
    borderWidth: 1,
  });
  page.drawRectangle({
    x: 60,
    y: 650,
    width: 475,
    height: 24,
    color: rgb(0.75, 0.75, 0.75),
  });
  fs.writeFileSync(filePath, await pdf.save());
}

async function testImagePdfUsesOcrFallback() {
  const tmpPath = path.join(os.tmpdir(), `sogelmer-image-${Date.now()}.pdf`);
  await createImageOnlyPdf(tmpPath);

  try {
    const images = await renderPdfPagesToPngBase64(fs.readFileSync(tmpPath), { maxPages: 1, scale: 1 });
    assert.strictEqual(images.length, 1);
    assert.ok(images[0].base64.length > 1000, "PDF image page should render to PNG");

    const result = await importDocument(
      { path: tmpPath, originalname: "alta maree.pdf" },
      { import_parser_id: "SOGELMER", sogelmerOcrText: recentSogelmerText }
    );

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.result.bl_number, "511-00081150");
    assert.strictEqual(result.result.meta.document_date, "02/09/2026");
    assert.strictEqual(result.result.lines.length, 8);
    assert.strictEqual(result.result.meta.total_weight, 93.3);
    assert.strictEqual(result.result.meta.total_amount_ex_vat, 930.12);
    assert.strictEqual(result.result.meta.diagnostics.ocr_fallback_used, true);
    assert.strictEqual(result.result.meta.diagnostics.ocr_provider, "test-injected");
  } finally {
    fs.unlinkSync(tmpPath);
  }
}

async function testOcrTotalsMatchSucceedsComplete() {
  const tmpPath = path.join(os.tmpdir(), `sogelmer-image-complete-${Date.now()}.pdf`);
  await createImageOnlyPdf(tmpPath);

  try {
    const result = await importDocument(
      { path: tmpPath, originalname: "alta maree.pdf" },
      {
        import_parser_id: "SOGELMER",
        sogelmerOcrExtractor: async () => ({
          text: recentSogelmerText,
          warnings: [],
          raw_lines: sogelmerRawOcrLines(),
          document_totals: sogelmerDocumentTotals,
          page_count: 1,
          provider: "test-ocr",
        }),
      }
    );

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.result.lines.length, 8);
    assert.strictEqual(result.result.meta.import_complete, true);
    assert.strictEqual(result.result.meta.diagnostics.totals_check.ok, true);
  } finally {
    fs.unlinkSync(tmpPath);
  }
}

async function testOcrTotalsMismatchSucceedsWithWarning() {
  const tmpPath = path.join(os.tmpdir(), `sogelmer-image-mismatch-${Date.now()}.pdf`);
  await createImageOnlyPdf(tmpPath);

  const ocrTextWithBadLastAmount = recentSogelmerText.replace(
    /(JOUEL0 JOUE LOTTE 3 KG 2 3,00 6,00 KG 05050102508 16,40\s+\S+\s+)98,40(\s+\S+)/,
    "$199,99$2"
  );

  try {
    const result = await importDocument(
      { path: tmpPath, originalname: "alta maree.pdf" },
      {
        import_parser_id: "SOGELMER",
        sogelmerOcrExtractor: async () => ({
          text: ocrTextWithBadLastAmount,
          warnings: [],
          raw_lines: sogelmerRawOcrLines("99,99"),
          document_totals: sogelmerDocumentTotals,
          page_count: 1,
          provider: "test-ocr",
        }),
      }
    );

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.result.lines.length, 7);
    assert.strictEqual(result.result.meta.import_complete, false);
    assert.strictEqual(result.result.meta.diagnostics.totals_check.ok, false);
    assert.strictEqual(result.result.meta.diagnostics.totals_check.expected.colis, 26);
    assert.strictEqual(result.result.meta.diagnostics.totals_check.expected.poids_total_kg, 93.3);
    assert.strictEqual(result.result.meta.diagnostics.totals_check.expected.montant_ht, 930.12);
    assert.strictEqual(result.result.meta.diagnostics.ocr_raw_lines.length, 8);
    assert.ok(result.result.meta.diagnostics.rejected_lines.some((line) => (
      line.supplier_reference === "JOUEL0" && line.reason.includes("montant incoherent")
    )));
    assert.ok(result.warnings.some((warning) => warning.includes("Import SOGELMER potentiellement incomplet")));
    assert.ok(!result.error);
  } finally {
    fs.unlinkSync(tmpPath);
  }
}

async function testLegacyLayout() {
  const result = await sogelmer.parse({
    text: legacySogelmerText,
    originalname: "511-00070001-sogelmer.pdf",
    ext: ".pdf",
  });

  assert.strictEqual(result.lines.length, 1);
  assert.strictEqual(result.lines[0].supplier_reference, "FILLINB/3");
  assert.strictEqual(result.lines[0].latin_name, "Molva dypterygia");
  assert.strictEqual(result.lines[0].fao_zone, "FAO 27");
  assert.strictEqual(result.lines[0].sous_zone, "VIII");
  assert.strictEqual(result.lines[0].fishing_gear, "CHALUT");
}

async function testDuplicateLineIsIgnored() {
  const duplicateText = `${recentSogelmerText}
FILJUL58 FILET JULIENNE 5/800 GR 3 KG 5 3,00 15,00 KG 05050102501 11,40 â‚¬ 171,00 â‚¬
`;
  const result = await sogelmer.parse({
    text: duplicateText,
    originalname: "sogelmer-duplicate.pdf",
    ext: ".pdf",
  });

  assert.strictEqual(result.lines.length, 8);
  assert.ok(result.warnings.some((warning) => warning.includes("doublon probable")));
}

async function testUnreadablePdfDoesNotSucceed() {
  const tmpPath = path.join(os.tmpdir(), `sogelmer-unreadable-${Date.now()}.pdf`);
  fs.writeFileSync(tmpPath, Buffer.from("not a real pdf"));

  try {
    const result = await importDocument(
      { path: tmpPath, originalname: "sogelmer-vide.pdf" },
      { import_parser_id: "SOGELMER" }
    );

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "Aucune ligne article détectée dans le document SOGELMER");
    assert.ok(result.result.warnings.some((warning) => warning.includes("Aucune ligne article")));
  } finally {
    fs.unlinkSync(tmpPath);
  }
}

async function parseRealPdfFromCli() {
  const pdfIndex = process.argv.indexOf("--pdf");
  const pdfPath = pdfIndex >= 0 ? process.argv[pdfIndex + 1] : null;
  if (!pdfPath) return;

  const result = await importDocument(
    { path: pdfPath, originalname: path.basename(pdfPath), mimetype: "application/pdf" },
    { import_parser_id: "SOGELMER" }
  );

  const lines = result.result?.lines || [];
  const totalWeight = lines.reduce((sum, line) => sum + Number(line.total_weight_kg || 0), 0);
  const totalAmount = lines.reduce((sum, line) => sum + Number(line.line_amount_ex_vat || 0), 0);
  const totalColis = lines.reduce((sum, line) => sum + Number(line.ordered_colis || 0), 0);

  console.log(JSON.stringify({
    ok: result.ok,
    error: result.error || null,
    detected_type: result.detected_type,
    bl_number: result.result?.bl_number || result.result?.meta?.bl_number || null,
    document_date: result.result?.meta?.document_date || null,
    line_count: lines.length,
    total_colis: totalColis,
    total_weight: Number(totalWeight.toFixed(2)),
    total_amount_ex_vat: Number(totalAmount.toFixed(2)),
    warnings: result.result?.warnings || result.warnings || [],
    diagnostics: result.result?.meta?.diagnostics || {},
    references: lines.map((line) => line.supplier_reference),
  }, null, 2));
}

(async () => {
  await testRecentLayout();
  await testImagePdfUsesOcrFallback();
  await testOcrTotalsMatchSucceedsComplete();
  await testOcrTotalsMismatchSucceedsWithWarning();
  await testLegacyLayout();
  await testDuplicateLineIsIgnored();
  await testUnreadablePdfDoesNotSucceed();
  await parseRealPdfFromCli();
  console.log("OK test-sogelmer-import-parser");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
