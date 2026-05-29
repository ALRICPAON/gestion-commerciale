const readUploadFile = require("./read-upload-file");
const detectImportType = require("./detect-import-type");
const normalizeImportOutput = require("./normalize-import-output");
const parsers = require("./index");

function getParserById(parserId) {
  const parserMap = {
    SCAPMAREE: parsers.find(p => p.id === "SCAPMAREE"),
    ROYALE_MAREE: parsers.find(p => p.id === "ROYALE_MAREE"),
    CRIEE_81268: parsers.find(p => p.id === "CRIEE"),
    CRIEE_81269: parsers.find(p => p.id === "CRIEE"),
    SCAOUEST: parsers.find(p => p.id === "SCAOUEST"),
    SOGELMER: parsers.find(p => p.id === "SOGELMER"),
    DISTRIMER: parsers.find(p => p.id === "DISTRIMER"),
    LECRIMAREE: parsers.find(p => p.id === "LECRIMAREE"),
    GCCRUSTACES: parsers.find(p => p.id === "GCCRUSTACES"),
  };
  return parserMap[parserId] || null;
}

async function importDocument(file, options = {}) {
  const fileContext = readUploadFile(file);

  const context = {
    ...fileContext,
    originalnameLower: String(fileContext.originalname || "").toLowerCase(),
    ...options,
  };

  let detectedParser = null;

  if (options.import_parser_id) {
    detectedParser = getParserById(options.import_parser_id);
    if (!detectedParser) {
      return {
        ok: false,
        error: `Parser '${options.import_parser_id}' non trouvé`,
        detected_type: null,
        candidates: [],
        preview_rows: context.previewRows,
        sheet_names: context.sheetNames,
      };
    }
    // Pour CRIEE, extraire le supplier_code du parser_id
    if (options.import_parser_id.startsWith("CRIEE_")) {
      context.supplier_code_override = options.import_parser_id.split("_")[1];
    }
  } else {
    const detection = detectImportType(context);
    if (!detection.detected) {
      return {
        ok: false,
        error: "Format de document non reconnu",
        detected_type: null,
        candidates: detection.candidates,
        preview_rows: context.previewRows,
        sheet_names: context.sheetNames,
      };
    }
    detectedParser = detection.detected;
  }

  const parsed = await detectedParser.parse(context);
  const normalized = normalizeImportOutput(parsed);

  return {
    ok: true,
    detected_type: detectedParser.id,
    detected_label: detectedParser.label,
    candidates: [],
    result: normalized,
    preview_rows: context.previewRows,
    sheet_names: context.sheetNames,
  };
}

module.exports = importDocument;