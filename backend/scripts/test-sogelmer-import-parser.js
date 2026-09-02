const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const importDocument = require("../services/imports/import-document");
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

async function testRecentLayout() {
  const result = await sogelmer.parse({
    text: recentSogelmerText,
    originalname: "alta maree.pdf",
    ext: ".pdf",
  });

  assert.strictEqual(result.supplier_name, "SOGELMER");
  assert.strictEqual(result.bl_number, "511-00081150");
  assert.strictEqual(result.lines.length, 8);
  assert.strictEqual(result.meta.total_weight, 93.3);
  assert.strictEqual(result.meta.total_amount_ex_vat, 930.12);

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

(async () => {
  await testRecentLayout();
  await testLegacyLayout();
  await testUnreadablePdfDoesNotSucceed();
  console.log("OK test-sogelmer-import-parser");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
