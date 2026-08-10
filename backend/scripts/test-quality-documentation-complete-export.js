const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

const {
  collectAttachmentAppendixItems,
  collectExternalAppendixItems,
  collectSupplyMaterialExternalAttachments,
  dedupeAppendixItems,
  mergeAppendices,
} = require('../services/quality/qualityDocumentationExportService');

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64'
);

async function makePdf(pageCount) {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) pdf.addPage([300, 300]);
  return Buffer.from(await pdf.save());
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alta-ddpp-export-'));
  const mainPdf = await makePdf(1);
  const annexPdfPath = path.join(dir, 'procedure.pdf');
  const imagePath = path.join(dir, 'photo.png');
  const textPath = path.join(dir, 'note.txt');
  fs.writeFileSync(annexPdfPath, await makePdf(2));
  fs.writeFileSync(imagePath, ONE_PIXEL_PNG);
  fs.writeFileSync(textPath, 'Document externe non embarquable');

  const documentation = {
    attachments: [
      { id: 'a1', section_title: 'Reception', filename: 'procedure.pdf', mime_type: 'application/pdf', file_path: annexPdfPath, include_in_export: true },
      { id: 'a2', section_title: 'Reception', filename: 'photo.png', mime_type: 'image/png', file_path: imagePath, include_in_export: true },
      { id: 'a3', section_title: 'Reception', filename: 'archive.pdf', mime_type: 'application/pdf', file_path: annexPdfPath, include_in_export: true, archived_at: new Date().toISOString() },
      { id: 'a4', section_title: 'Reception', filename: 'excluded.pdf', mime_type: 'application/pdf', file_path: annexPdfPath, include_in_export: false },
    ],
  };
  const chapterItems = collectAttachmentAppendixItems(documentation, { include_attachments: true });
  assert.strictEqual(chapterItems.length, 2, 'seules les pieces jointes actives et incluses doivent etre exportees');

  const externalItems = collectExternalAppendixItems([
    { document: { id: 'd1', title: 'Note fournisseur', original_filename: 'note.txt', storage_path: textPath, mime_type: 'text/plain' }, references: [{ target_label: 'Reception' }] },
    { document: { id: 'd2', title: 'Procedure dupliquee', original_filename: 'procedure.pdf', storage_path: annexPdfPath, mime_type: 'application/pdf' }, references: [{ target_label: 'Reception' }] },
    { document: { id: 'd3', title: 'Fichier absent', original_filename: 'absent.pdf', storage_path: path.join(dir, 'absent.pdf'), mime_type: 'application/pdf' }, references: [{ target_label: 'Reception' }] },
  ]);
  const supplyExternalItems = collectExternalAppendixItems([
    {
      document: { id: 'd4', title: 'TECHLINE', original_filename: 'ft-techline.pdf', storage_path: annexPdfPath, mime_type: 'application/pdf' },
      references: [{ relation_type: 'technical_sheet', relation_type_label: 'Fiche technique', target_label: 'TECHLINE', usage_label: 'PROC-010 Nettoyage' }],
    },
  ]);
  assert.strictEqual(supplyExternalItems[0].title, 'Fiche technique - ft-techline.pdf', 'Les documents fournitures doivent avoir un libelle annexe lisible');
  assert.strictEqual(supplyExternalItems[0].section_title, 'PROC-010 Nettoyage', 'Le contexte metier exporte doit etre conserve');
  assert.strictEqual(typeof collectSupplyMaterialExternalAttachments, 'function', 'Collecte DDPP des documents fournitures manquante');
  const { deduped, duplicates } = dedupeAppendixItems([...chapterItems, ...externalItems]);
  assert.strictEqual(deduped.length, 4, 'le meme fichier rattache plusieurs fois doit etre conserve une seule fois');
  assert.strictEqual(duplicates.length, 1, 'les doublons doivent etre comptabilises');

  const merged = await mergeAppendices(mainPdf, [...chapterItems, ...externalItems], { warn: () => {} });
  const finalPdf = await PDFDocument.load(merged.pdf);
  assert.strictEqual(finalPdf.getPageCount(), 6, 'PDF final = manuel + PDF multipage + image + notices');
  assert.strictEqual(merged.summary.embedded_attachments, 2, 'PDF et image doivent etre embarques');
  assert.strictEqual(merged.summary.non_embeddable, 2, 'texte et fichier absent doivent produire une page de signalement');
  assert.strictEqual(merged.summary.duplicates, 1, 'les doublons doivent etre signales');
  assert.strictEqual(merged.summary.embedded_pages, 3, 'les pages des annexes embarquees doivent etre comptees');

  console.log(JSON.stringify({
    ok: true,
    complete_export_appendices: true,
    multipage_pdf_merge: true,
    image_appendix: true,
    non_embeddable_notice: true,
    dedupe: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
