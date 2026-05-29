const { PDFParse } = require("pdf-parse");

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
  let r = String(ref).trim().replace("/", "_");
  r = r.replace(/^(\D+)(\d)$/, "$10$2");
  return r.toUpperCase();
}

function isArticleCode(s) {
  const v = normalizeText(s);
  return (
    /^[A-Z]{3,10}[A-Z0-9/]{0,10}$/i.test(v) &&
    !/CLIENT|DISTRIMER|PAGE|DATE|FR|CE|TARIF|POIDS|STEF|BL|FACTURE|LIVRE|TRANSPORTEUR|TOURNEE|SOUS|NBRE|MONTANT/i.test(v)
  );
}

function extractFAOs(bio) {
  if (!bio) return [];

  const blocks = bio
    .split(/FAO/i)
    .slice(1)
    .map((b) => b.trim());

  const out = [];

  for (let blk of blocks) {
    blk = blk.split(/Chalut|Casier|Ligne|Filet|Mail|-/i)[0].trim();

    const numMatch = blk.match(/^([0-9]{1,3})/);
    if (!numMatch) continue;

    const num = numMatch[1];
    let rest = blk.replace(num, "").trim();

    const parts = rest.split(/et|\/|,/i).map((s) => s.trim());

    for (let p of parts) {
      const m = p.match(/^([IVX]+)([A-Za-z]?)?/i);
      if (!m) continue;

      const roman = (m[1] || "").toUpperCase();
      let letter = (m[2] || "").toLowerCase();

      if (/ouest|ecosse/i.test(p)) letter = "";

      out.push(`FAO ${num} ${roman}${letter}`.trim());
    }
  }

  return [...new Set(out)];
}

function extractLatinName(bio) {
  if (!bio) return "";
  return normalizeText(bio.split(" - ")[0] || "");
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

  // Exemple observé :
  // LANGGL2 LANGOUSTINE GLACEE 20/40 3 KG 10 3,000 30,000 KG 140290108204 8,00 € 240,00 € 1
  const regex =
    /^([A-Z0-9/]{4,16})\s+(.+?)\s+(\d+(?:,\d+)?)\s+(\d+(?:,\d+)?)\s+(\d+(?:,\d+)?)\s+([A-Z]{2,5})\s+([A-Z0-9]{8,20})\s+(\d+(?:,\d+)?)\s*€\s+(\d+(?:,\d+)?)\s*€(?:\s+\d+)?$/i;

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

function parseDistrimerText(text) {
  const lines = splitLines(text);
  const rows = [];
  let i = 0;

  while (i < lines.length) {
    const current = lines[i];
    const parsed = parseArticleLine(current);

    if (!parsed) {
      i += 1;
      continue;
    }

    const bio = normalizeText(lines[i + 1] || "");

    if (bio && !parseArticleLine(bio) && !/^à reporter/i.test(bio)) {
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

      rows.push(parsed);
      i += 2;
      continue;
    }

    rows.push(parsed);
    i += 1;
  }

  return rows;
}

module.exports = {
  id: "DISTRIMER",
  label: "Distrimer",
  supportedExtensions: [".pdf"],

  detect(context) {
    let score = 0;

    const name = String(context.originalnameLower || "");
    const ext = String(context.ext || "").toLowerCase();

    if (ext === ".pdf") score += 20;
    if (name.includes("distrimer")) score += 100;

    return score;
  },

  async parse(context) {
    let text = "";

    try {
      text = await extractPdfText(context);
    } catch (error) {
      return {
        supplier_code: "10002",
        supplier_name: "DISTRIMER",
        purchase_type: "order",
        document_type: "supplier_bl",
        lines: [],
        warnings: [`Impossible de lire le PDF DISTRIMER: ${error.message}`],
        meta: {
          detected_from_filename: context.originalname || null,
        },
      };
    }

    if (!text) {
      return {
        supplier_code: "10002",
        supplier_name: "DISTRIMER",
        purchase_type: "order",
        document_type: "supplier_bl",
        lines: [],
        warnings: ["Texte PDF vide ou non extrait"],
        meta: {
          detected_from_filename: context.originalname || null,
        },
      };
    }

    const parsedRows = parseDistrimerText(text);

    const lines = parsedRows.map((L) => ({
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

      origin_label: "DISTRIMER",
      allergens: null,

      ordered_colis: L.colis || null,
      ordered_pieces: null,
      ordered_quantity: L.poidsTotalKg || null,

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
    }));

    const totalWeight = lines.reduce(
      (sum, line) => sum + Number(line.ordered_quantity || 0),
      0
    );

    const totalAmount = lines.reduce(
      (sum, line) => sum + Number(line.line_amount_ex_vat || 0),
      0
    );

    const warnings = [];
    if (!lines.length) {
      warnings.push("Aucune ligne exploitable détectée dans le PDF DISTRIMER");
    }

    return {
      supplier_code: "10002",
      supplier_name: "DISTRIMER",
      purchase_type: "order",
      document_type: "supplier_bl",
      lines,
      warnings,
      meta: {
        detected_from_filename: context.originalname || null,
        parsed_line_count: lines.length,
        total_weight: Number(totalWeight.toFixed(3)),
        total_amount_ex_vat: Number(totalAmount.toFixed(2)),
      },
    };
  },
};