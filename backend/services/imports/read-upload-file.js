const path = require("path");
const fs = require("fs");
const XLSX = require("xlsx");

function safeReadWorkbook(buffer, ext) {
  if (![".xlsx", ".xls", ".csv"].includes(ext)) {
    return null;
  }

  try {
    return XLSX.read(buffer, { type: "buffer" });
  } catch (error) {
    return null;
  }
}

function extractPreviewRows(workbook) {
  if (!workbook || !Array.isArray(workbook.SheetNames) || workbook.SheetNames.length === 0) {
    return [];
  }

  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) return [];

  try {
    return XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      blankrows: false,
      defval: "",
    }).slice(0, 15);
  } catch (error) {
    return [];
  }
}

function readUploadFile(file) {
  if (!file || !file.path) {
    throw new Error("Fichier upload manquant");
  }

  const ext = path.extname(file.originalname || file.path).toLowerCase();
  const buffer = fs.readFileSync(file.path);
  const workbook = safeReadWorkbook(buffer, ext);
  const previewRows = extractPreviewRows(workbook);

  return {
    file,
    path: file.path,
    originalname: file.originalname || "",
    ext,
    buffer,
    workbook,
    previewRows,
    sheetNames: workbook?.SheetNames || [],
  };
}

module.exports = readUploadFile;