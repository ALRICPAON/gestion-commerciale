const { PDFParse } = require("pdf-parse");
const { extractScannedSogelmerPdfText } = require("../sogelmer-scanned-pdf-ocr");

const MONEY_TOKEN = "(?:EUR|€|â‚¬)?";
const NUMBER_TOKEN = "\\d+(?:[,.]\\d+)?";
const LOT_TOKEN = "[A-Z0-9][A-Z0-9\\-/.]{5,24}";

function normalizeText(raw) {
  return String(raw || "")
    .replace(/[\u00A0\u202F\u2009\u2002\u2003]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(raw) {
  if (raw === undefined || raw === null || raw === "") return 0;
  if (typeof raw === "number") return Number(raw);

  let s = String(raw).trim();
  s = s.replace(/[\u00A0\u202F\u2009\u2002\u2003]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/\s/g, "");

  if (s.includes(".") && s.includes(",")) {
    if (s.indexOf(".") < s.indexOf(",")) {
      s = s.replace(/\./g, "").replace(/,/g, ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (s.includes(",") && !s.includes(".")) {
    s = s.replace(/,/g, ".");
  }

  s = s.replace(/[^\d.\-]/g, "");
  const x = parseFloat(s);
  return Number.isFinite(x) ? x : 0;
}

function normalizeRef(ref) {
  if (!ref) return "";
  return String(ref).trim().toUpperCase();
}

function isArticleCode(s) {
  const v = normalizeText(s);
  return (
    /^[A-Z]{3,10}[A-Z0-9/]{0,10}$/i.test(v) &&
    !/CLIENT|SOGELMER|PAGE|DATE|FR|CE|TARIF|POIDS|STEF|BL|FACTURE|LIVRE|TRANSPORTEUR|TOURNEE|SOUS|NBRE|MONTANT|CODE|DESIGNATION|COLIS/i.test(v)
  );
}

function weightPerColisKg(totalWeightKg, colisCount, parsedWeightPerColisKg = 0) {
  const total = Number(totalWeightKg || 0);
  const colis = Number(colisCount || 0);
  const parsed = Number(parsedWeightPerColisKg || 0);

  if (total > 0 && colis > 0) {
    return Number((total / colis).toFixed(3));
  }

  return parsed > 0 ? parsed : null;
}

function extractBlNumber(text, context = {}) {
  const normalized = normalizeText(text);
  const directMatch =
    normalized.match(/N[°º]?\s*BL\s+Date\s+Client\s+([0-9]{3}-[0-9]{8})/i) ||
    normalized.match(/N[°º]?\s*BL\s+([0-9]{3}-[0-9]{8})/i) ||
    normalized.match(/\b([0-9]{3}-[0-9]{8})\b/);

  if (directMatch) return directMatch[1];

  const fileMatch = String(context.originalname || context.filename || "").match(/([0-9]{3}-[0-9]{8})/);
  return fileMatch ? fileMatch[1] : null;
}

function extractDocumentDate(text) {
  const normalized = normalizeText(text);
  const match =
    normalized.match(/\bDATE\s+([0-3]?\d[/-][01]?\d[/-]\d{4})\b/i) ||
    normalized.match(/\b([0-3]?\d[/-][01]?\d[/-]\d{4})\b/);
  return match ? match[1].replace(/-/g, "/") : null;
}

function extractFAOs(bio) {
  if (!bio) return [];

  const out = [];
  const regex = /FAO\s*([0-9]{1,3})\s*([IVX]{1,4})?\s*([A-Za-z])?/gi;

  let m;
  while ((m = regex.exec(bio)) !== null) {
    const num = m[1];
    const roman = m[2] ? m[2].toUpperCase() : "";
    let letter = m[3] ? m[3].toUpperCase() : "";

    if (letter === "O") letter = "";

    out.push(`FAO ${num} ${roman}${letter}`.trim());
  }

  return [...new Set(out)];
}

function extractLatinName(bio) {
  if (!bio) return "";
  return normalizeText(bio.split(/ - FAO| - ANE FAO/i)[0] || "");
}

function extractFishingGear(bio) {
  if (!bio) return "";

  const matches = bio.match(/Chalut|Ligne|Filet|Mail|Casier|FILTS|FILMAIL/gi);
  if (!matches || !matches.length) return "";

  let engin = matches[matches.length - 1];

  if (/FILMAIL/i.test(engin)) engin = "FILET MAILLANT";
  else if (/FILTS/i.test(engin)) engin = "FILET TOURNANT";
  else if (/FILET/i.test(engin)) engin = "FILET";
  else if (/CHALUT/i.test(engin)) engin = "CHALUT";
  else if (/LIGNE/i.test(engin)) engin = "LIGNE";
  else if (/CASIER/i.test(engin)) engin = "CASIER";

  return engin;
}

async function extractPdfText(context) {
  if (typeof context.text === "string" && context.text.trim()) return context.text;
  if (typeof context.pdfText === "string" && context.pdfText.trim()) return context.pdfText;
  if (!context.buffer) return "";

  const parser = new PDFParse({ data: context.buffer });
  const result = await parser.getText();
  return String(result?.text || "");
}

function splitLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => normalizeText(line))
    .filter(Boolean);
}

function parseArticleLine(line) {
  const raw = normalizeText(line);

  const regex = new RegExp(
    "^([A-Z0-9/]{4,16})\\s+(.+?)\\s+" +
      `(${NUMBER_TOKEN})\\s+(${NUMBER_TOKEN})\\s+(${NUMBER_TOKEN})\\s+([A-Z]{1,5})\\s+(${LOT_TOKEN})\\s+` +
      `(${NUMBER_TOKEN})\\s*${MONEY_TOKEN}\\s+(${NUMBER_TOKEN})\\s*${MONEY_TOKEN}(?:\\s+\\d+)?$`,
    "i"
  );

  const m = raw.match(regex);
  if (!m) return null;

  if (!isArticleCode(m[1])) return null;

  return {
    refFournisseur: normalizeRef(m[1]),
    designation: normalizeText(m[2]),
    colis: parseNumber(m[3]),
    poidsColisKg: parseNumber(m[4]),
    poidsTotalKg: parseNumber(m[5]),
    uv: normalizeText(m[6]),
    lot: normalizeText(m[7]),
    prixKg: parseNumber(m[8]),
    montantHT: parseNumber(m[9]),
    nomLatin: "",
    fao: "",
    autresFAO: [],
    zone: "",
    sousZone: "",
    engin: "",
  };
}

function parseArticleBlock(blockLines) {
  const joined = normalizeText(blockLines.join(" "));
  const direct = parseArticleLine(joined);
  if (direct) return direct;

  const tokens = joined
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !/^(?:€|â‚¬|EUR)$/i.test(token));

  if (tokens.length < 9 || !isArticleCode(tokens[0])) return null;

  const tailEnd = /^\d+$/.test(tokens[tokens.length - 1]) ? tokens.length - 1 : tokens.length;
  const tail = tokens.slice(Math.max(1, tailEnd - 7), tailEnd);
  if (tail.length < 7) return null;

  const [colis, poidsColisKg, poidsTotalKg, uv, lot, prixKg, montantHT] = tail;
  const numberRegex = new RegExp(`^${NUMBER_TOKEN}$`);
  if (
    !numberRegex.test(colis) ||
    !numberRegex.test(poidsColisKg) ||
    !numberRegex.test(poidsTotalKg) ||
    !/^[A-Z]{1,5}$/i.test(uv) ||
    !new RegExp(`^${LOT_TOKEN}$`, "i").test(lot) ||
    !numberRegex.test(prixKg) ||
    !numberRegex.test(montantHT)
  ) {
    return null;
  }

  const designation = normalizeText(tokens.slice(1, tailEnd - 7).join(" "));
  if (!designation) return null;

  return {
    refFournisseur: normalizeRef(tokens[0]),
    designation,
    colis: parseNumber(colis),
    poidsColisKg: parseNumber(poidsColisKg),
    poidsTotalKg: parseNumber(poidsTotalKg),
    uv: normalizeText(uv),
    lot: normalizeText(lot),
    prixKg: parseNumber(prixKg),
    montantHT: parseNumber(montantHT),
    nomLatin: "",
    fao: "",
    autresFAO: [],
    zone: "",
    sousZone: "",
    engin: "",
  };
}

function collectArticleBlock(lines, startIndex) {
  const block = [];

  for (let i = startIndex; i < lines.length && block.length < 16; i += 1) {
    const line = lines[i];
    if (i > startIndex && isArticleCode(line)) break;
    if (/^(?:N[°º]?|DATE|CLIENT|PAGE|TOTAL|SOUS|MONTANT|NBRE)\b/i.test(line)) break;

    block.push(line);
    const parsed = parseArticleBlock(block);
    if (parsed) return { parsed, nextIndex: i + 1 };
  }

  return { parsed: null, nextIndex: startIndex + 1 };
}

function applyBioData(parsed, bio) {
  const nomLatin = extractLatinName(bio);
  const faoList = extractFAOs(bio);
  const fao = faoList[0] || "";
  const autresFAO = faoList.slice(1);

  let zone = "";
  let sousZone = "";

  if (fao) {
    const parts = fao.split(" ");
    zone = `${parts[0] || ""} ${parts[1] || ""}`.trim();
    sousZone = parts.slice(2).join(" ").trim();
  }

  parsed.nomLatin = nomLatin;
  parsed.fao = fao;
  parsed.autresFAO = autresFAO;
  parsed.zone = zone;
  parsed.sousZone = sousZone;
  parsed.engin = extractFishingGear(bio);
}

function clearBioData(parsed) {
  parsed.nomLatin = "";
  parsed.fao = "";
  parsed.autresFAO = [];
  parsed.zone = "";
  parsed.sousZone = "";
  parsed.engin = "";
}

function validationLineSnapshot(line, index, source) {
  return {
    source,
    index: index + 1,
    supplier_reference: line.refFournisseur || null,
    designation: line.designation || null,
    colis: line.colis || null,
    poids_colis_kg: line.poidsColisKg || null,
    poids_total_kg: line.poidsTotalKg || null,
    uv: line.uv || null,
    supplier_lot_number: line.lot || null,
    prix_kg: line.prixKg || null,
    montant_ht: line.montantHT || null,
  };
}

function validateParsedRows(rows, source, warnings, diagnostics = null) {
  const seen = new Set();

  return rows.filter((line, index) => {
    const label = `${source} ligne ${index + 1}`;
    const snapshot = validationLineSnapshot(line, index, source);
    const required = [
      ["reference", line.refFournisseur],
      ["designation", line.designation],
      ["colis", line.colis],
      ["poids total", line.poidsTotalKg],
      ["lot", line.lot],
      ["prix", line.prixKg],
      ["montant", line.montantHT],
    ];
    const missing = required.filter(([, value]) => !value).map(([name]) => name);
    if (missing.length) {
      const reason = `donnees manquantes (${missing.join(", ")})`;
      warnings.push(`${label} ignoree: ${reason}`);
      diagnostics?.rejected_lines?.push({ ...snapshot, reason });
      return false;
    }

    const expectedAmount = Number((Number(line.poidsTotalKg || 0) * Number(line.prixKg || 0)).toFixed(2));
    const actualAmount = Number(Number(line.montantHT || 0).toFixed(2));
    if (Math.abs(expectedAmount - actualAmount) > 0.06) {
      const reason = `montant incoherent (${actualAmount} pour ${line.poidsTotalKg} kg x ${line.prixKg})`;
      warnings.push(`${label} ignoree: ${reason}`);
      diagnostics?.rejected_lines?.push({ ...snapshot, reason, expected_amount: expectedAmount, actual_amount: actualAmount });
      return false;
    }

    const duplicateKey = [
      line.refFournisseur,
      line.lot,
      Number(line.poidsTotalKg || 0).toFixed(3),
      Number(line.montantHT || 0).toFixed(2),
    ].join("|");
    if (seen.has(duplicateKey)) {
      const reason = `doublon probable (${line.refFournisseur} / ${line.lot})`;
      warnings.push(`${label} ignoree: ${reason}`);
      diagnostics?.rejected_lines?.push({ ...snapshot, reason });
      return false;
    }
    seen.add(duplicateKey);
    diagnostics?.accepted_lines?.push(snapshot);

    return true;
  });
}

function ocrTotalNumber(value) {
  return parseNumber(value);
}

function summarizeParsedRows(rows) {
  return {
    colis: Number(rows.reduce((sum, line) => sum + Number(line.colis || 0), 0).toFixed(3)),
    poids_total_kg: Number(rows.reduce((sum, line) => sum + Number(line.poidsTotalKg || 0), 0).toFixed(3)),
    montant_ht: Number(rows.reduce((sum, line) => sum + Number(line.montantHT || 0), 0).toFixed(2)),
  };
}

function compareTotals(documentTotals, parsedRows, warnings) {
  if (!documentTotals || typeof documentTotals !== "object") return null;

  const expected = {
    colis: ocrTotalNumber(documentTotals.colis || documentTotals.total_colis),
    poids_total_kg: ocrTotalNumber(documentTotals.poids_total_kg || documentTotals.total_weight_kg || documentTotals.poids),
    montant_ht: ocrTotalNumber(documentTotals.montant_ht || documentTotals.total_amount_ex_vat || documentTotals.total_ht),
  };
  const actual = summarizeParsedRows(parsedRows);
  const diff = {
    colis: Number((actual.colis - expected.colis).toFixed(3)),
    poids_total_kg: Number((actual.poids_total_kg - expected.poids_total_kg).toFixed(3)),
    montant_ht: Number((actual.montant_ht - expected.montant_ht).toFixed(2)),
  };

  const mismatches = [];
  if (expected.colis && Math.abs(diff.colis) > 0.001) mismatches.push(`colis ${actual.colis}/${expected.colis}`);
  if (expected.poids_total_kg && Math.abs(diff.poids_total_kg) > 0.02) mismatches.push(`poids ${actual.poids_total_kg}/${expected.poids_total_kg}`);
  if (expected.montant_ht && Math.abs(diff.montant_ht) > 0.06) mismatches.push(`HT ${actual.montant_ht}/${expected.montant_ht}`);

  if (mismatches.length) {
    warnings.push(`Import SOGELMER potentiellement incomplet : les lignes détectées ne correspondent pas aux totaux du document. Vérifiez les lignes importées et complétez manuellement si nécessaire. (${mismatches.join(", ")})`);
  }

  return { expected, actual, diff, ok: mismatches.length === 0 };
}

function sameOcrLine(raw, parsed) {
  if (!raw || !parsed) return false;
  const rawRef = normalizeRef(raw.supplier_reference);
  const parsedRef = normalizeRef(parsed.supplier_reference);
  const rawLot = normalizeText(raw.supplier_lot_number || raw.lot);
  const parsedLot = normalizeText(parsed.supplier_lot_number || parsed.lot);

  if (rawRef && parsedRef && rawRef === parsedRef) {
    return !rawLot || !parsedLot || rawLot === parsedLot;
  }

  const rawText = normalizeText(raw.source_text || raw.designation);
  const parsedDesignation = normalizeText(parsed.designation);
  return Boolean(rawText && parsedDesignation && rawText.includes(parsedDesignation));
}

function addUnparsedOcrDiagnostics(diagnostics, warnings) {
  if (!diagnostics?.ocr_raw_lines?.length) return;

  diagnostics.ocr_raw_lines.forEach((raw, index) => {
    const known = [...(diagnostics.accepted_lines || []), ...(diagnostics.rejected_lines || [])]
      .some((line) => sameOcrLine(raw, line));
    if (known) return;

    const reason = "ligne OCR incomplete ou non parseable";
    const snapshot = {
      source: "OCR SOGELMER",
      index: raw.index || index + 1,
      supplier_reference: raw.supplier_reference || null,
      designation: raw.designation || null,
      colis: raw.colis || null,
      poids_colis_kg: raw.poids_colis_kg || null,
      poids_total_kg: raw.poids_total_kg || null,
      uv: raw.uv || null,
      supplier_lot_number: raw.supplier_lot_number || raw.lot || null,
      prix_kg: raw.prix_kg || null,
      montant_ht: raw.montant_ht || null,
      source_text: raw.source_text || null,
      reason,
    };
    diagnostics.rejected_lines.push(snapshot);
    warnings.push(`OCR SOGELMER ligne ${snapshot.index} ignoree: ${reason}`);
  });
}

function parseSogelmerText(text) {
  const lines = splitLines(text);
  const rows = [];
  let i = 0;

  while (i < lines.length) {
    const block = collectArticleBlock(lines, i);
    const parsed = block.parsed;

    if (!parsed) {
      i += 1;
      continue;
    }

    const bioIndex = block.nextIndex;
    const bio = normalizeText(lines[bioIndex] || "");
    const packLine = normalizeText(lines[bioIndex + 1] || "");

    applyBioData(parsed, bio);

    // Securite : si la ligne suivante n'est pas une bio, on n'ecrase pas tout.
    if (!bio || /^(\d+\s*X\s*\d+)/i.test(bio) || parseArticleLine(bio) || isArticleCode(bio)) {
      clearBioData(parsed);
      rows.push(parsed);
      i = block.nextIndex;
      continue;
    }

    // packLine du style "3 X 3KG" : on l'ignore, mais on saute bien la ligne.
    rows.push(parsed);

    if (packLine && /^\d+\s*X\s*[\d.,]+/i.test(packLine)) {
      i = bioIndex + 2;
    } else {
      i = bioIndex + 1;
    }
  }

  return rows;
}

function emptySogelmerResult(context, blNumber, warnings) {
  const finalWarnings = [...new Set([
    "Aucune ligne article detectee dans le document SOGELMER",
    ...(warnings || []),
  ].filter(Boolean))];

  return {
    supplier_code: "10003",
    supplier_name: "SOGELMER",
    purchase_type: "order",
    document_type: "supplier_bl",
    bl_number: blNumber,
    lines: [],
    warnings: finalWarnings,
    meta: {
      bl_number: blNumber,
      detected_from_filename: context.originalname || null,
      parsed_line_count: 0,
      import_complete: false,
      diagnostics: context.diagnostics || {},
    },
  };
}

function buildSogelmerResult(context, blNumber, documentDate, parsedRows, warnings = [], diagnostics = {}) {
  const lines = parsedRows.map((L) => {
    const poidsParColisKg = weightPerColisKg(L.poidsTotalKg, L.colis, L.poidsColisKg);

    return {
      supplier_reference: L.refFournisseur || null,
      supplier_label: L.designation || null,

      article_plu: null,
      designation: L.designation || null,
      internal_designation: L.designation || null,
      latin_name: L.nomLatin || null,

      fao_zone: L.zone || null,
      sous_zone: L.sousZone || null,
      fao: L.fao || null,
      fishing_gear: L.engin || null,

      origin_label: "SOGELMER",
      allergens: null,

      ordered_colis: L.colis || null,
      ordered_pieces: null,
      ordered_quantity: poidsParColisKg,

      received_colis: 0,
      received_pieces: 0,
      received_quantity: 0,

      unit_price_ex_vat: L.prixKg || null,
      supplier_unit_price_ex_vat: L.prixKg || null,
      price_unit: "kg",
      line_amount_ex_vat: L.montantHT || null,

      supplier_lot_number: L.lot || null,
      dlc: null,

      line_kind: "TRAD",
      needs_mapping: true,
      total_weight_kg: L.poidsTotalKg || null,
    };
  });

  const totalWeight = parsedRows.reduce(
    (sum, line) => sum + Number(line.poidsTotalKg || 0),
    0
  );

  const totalAmount = lines.reduce(
    (sum, line) => sum + Number(line.line_amount_ex_vat || 0),
    0
  );

  const finalWarnings = [...new Set(warnings.filter(Boolean))];
  if (!lines.length) {
    finalWarnings.unshift("Aucune ligne article detectee dans le document SOGELMER");
  }

  return {
    supplier_code: "10003",
    supplier_name: "SOGELMER",
    purchase_type: "order",
    document_type: "supplier_bl",
    bl_number: blNumber,
    lines,
    warnings: finalWarnings,
    meta: {
      bl_number: blNumber,
      document_date: documentDate,
      detected_from_filename: context.originalname || null,
      parsed_line_count: lines.length,
      import_complete: diagnostics.totals_check ? diagnostics.totals_check.ok === true : true,
      total_weight: Number(totalWeight.toFixed(3)),
      total_amount_ex_vat: Number(totalAmount.toFixed(2)),
      diagnostics,
    },
  };
}

const parser = {
  id: "SOGELMER",
  label: "Sogelmer",
  supportedExtensions: [".pdf"],

  detect(context) {
    let score = 0;

    const name = String(context.originalnameLower || "");
    const ext = String(context.ext || "").toLowerCase();

    if (ext === ".pdf") score += 20;
    if (name.includes("sogelmer")) score += 100;

    // Avec selection manuelle du fournisseur, on peut rester simple.
    return score;
  },

  async parse(context) {
    let text = "";
    const warnings = [];
    const diagnostics = {
      pdf_text_extraction: "not_run",
      pdf_text_length: 0,
      text_lines_detected: 0,
      ocr_fallback_used: false,
      ocr_provider: null,
      ocr_pages: 0,
      parsed_line_count: 0,
      ocr_raw_lines: [],
      accepted_lines: [],
      rejected_lines: [],
      document_totals: null,
      totals_check: null,
    };

    try {
      text = await extractPdfText(context);
      diagnostics.pdf_text_extraction = text.trim() ? "ok" : "empty";
      diagnostics.pdf_text_length = text.length;
    } catch (error) {
      diagnostics.pdf_text_extraction = "error";
      warnings.push(`Impossible de lire le texte PDF SOGELMER: ${error.message}`);
    }

    let blNumber = extractBlNumber(text, context);
    let documentDate = extractDocumentDate(text);
    let parsedRows = text ? parseSogelmerText(text) : [];
    diagnostics.text_lines_detected = parsedRows.length;

    if (!text) {
      warnings.push("Texte PDF vide ou non extrait");
    }

    const textValidationWarnings = [];
    const validatedTextRows = validateParsedRows(parsedRows, "PDF texte SOGELMER", textValidationWarnings, diagnostics);
    if (validatedTextRows.length) {
      parsedRows = validatedTextRows;
      warnings.push(...textValidationWarnings);
    } else {
      parsedRows = [];
    }

    if (!parsedRows.length) {
      warnings.push(...textValidationWarnings);
      try {
        console.info("[SOGELMER IMPORT] OCR fallback start", {
          originalname: context.originalname || null,
          pdf_text_extraction: diagnostics.pdf_text_extraction,
          pdf_text_length: diagnostics.pdf_text_length,
        });
        const ocr = await extractScannedSogelmerPdfText(context);
        diagnostics.ocr_fallback_used = true;
        diagnostics.ocr_provider = ocr.provider || "unknown";
        diagnostics.ocr_pages = ocr.page_count || 0;
        diagnostics.ocr_raw_lines = ocr.raw_lines || [];
        diagnostics.document_totals = ocr.document_totals || null;
        warnings.push(...(ocr.warnings || []));

        const ocrText = String(ocr.text || "");
        if (ocrText.trim()) {
          blNumber = extractBlNumber(ocrText, context) || blNumber;
          documentDate = extractDocumentDate(ocrText) || documentDate;
          diagnostics.accepted_lines = [];
          diagnostics.rejected_lines = [];
          parsedRows = validateParsedRows(parseSogelmerText(ocrText), "OCR SOGELMER", warnings, diagnostics);
          addUnparsedOcrDiagnostics(diagnostics, warnings);
        } else {
          warnings.push("OCR SOGELMER: aucun texte exploitable extrait");
          addUnparsedOcrDiagnostics(diagnostics, warnings);
        }
      } catch (error) {
        warnings.push(`OCR SOGELMER indisponible: ${error.message}`);
      }
    }

    diagnostics.parsed_line_count = parsedRows.length;
    diagnostics.totals_check = compareTotals(diagnostics.document_totals, parsedRows, warnings);

    console.info("[SOGELMER IMPORT] parse result", {
      originalname: context.originalname || null,
      pdf_text_extraction: diagnostics.pdf_text_extraction,
      ocr_fallback_used: diagnostics.ocr_fallback_used,
      parsed_line_count: diagnostics.parsed_line_count,
    });

    context.diagnostics = diagnostics;
    if (!parsedRows.length) return emptySogelmerResult(context, blNumber, warnings);
    return buildSogelmerResult(context, blNumber, documentDate, parsedRows, warnings, diagnostics);
  },
};

parser._private = {
  normalizeRef,
  extractDocumentDate,
  parseArticleLine,
  parseArticleBlock,
  parseSogelmerText,
};

module.exports = parser;
