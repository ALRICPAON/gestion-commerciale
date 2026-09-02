const { PDFParse } = require("pdf-parse");

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
  return {
    supplier_code: "10003",
    supplier_name: "SOGELMER",
    purchase_type: "order",
    document_type: "supplier_bl",
    bl_number: blNumber,
    lines: [],
    warnings,
    meta: {
      bl_number: blNumber,
      detected_from_filename: context.originalname || null,
      parsed_line_count: 0,
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

    try {
      text = await extractPdfText(context);
    } catch (error) {
      const blNumber = extractBlNumber("", context);
      return emptySogelmerResult(context, blNumber, [
        `Aucune ligne article detectee dans le document SOGELMER`,
        `Impossible de lire le PDF SOGELMER: ${error.message}`,
      ]);
    }

    if (!text) {
      const blNumber = extractBlNumber("", context);
      return emptySogelmerResult(context, blNumber, [
        "Aucune ligne article detectee dans le document SOGELMER",
        "Texte PDF vide ou non extrait",
      ]);
    }

    const blNumber = extractBlNumber(text, context);
    const parsedRows = parseSogelmerText(text);

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

    const warnings = [];
    if (!lines.length) {
      warnings.push("Aucune ligne article detectee dans le document SOGELMER");
    }

    return {
      supplier_code: "10003",
      supplier_name: "SOGELMER",
      purchase_type: "order",
      document_type: "supplier_bl",
      bl_number: blNumber,
      lines,
      warnings,
      meta: {
        bl_number: blNumber,
        detected_from_filename: context.originalname || null,
        parsed_line_count: lines.length,
        total_weight: Number(totalWeight.toFixed(3)),
        total_amount_ex_vat: Number(totalAmount.toFixed(2)),
      },
    };
  },
};

parser._private = {
  normalizeRef,
  parseArticleLine,
  parseArticleBlock,
  parseSogelmerText,
};

module.exports = parser;
