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

function keepRef(raw) {
  return String(raw || "").trim().replace(/\s+/g, "");
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

function stripAccents(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function normalizeEngin(engin = "") {
  if (!engin) return "";

  const e = stripAccents(engin).toUpperCase().trim();

  if (e.includes("LIGNES")) return "LIGNES, HAMECONS ET AUTRES";
  if (e.includes("HAMECONS")) return "LIGNES, HAMECONS ET AUTRES";
  if (e.includes("CHALUT")) return "CHALUTS ET AUTRES";
  if (e.includes("DRAGUE")) return "DRAGUES ET AUTRES";
  if (e.includes("ELEVAGE")) return "ELEVAGE";

  return normalizeText(engin);
}

function buildFAO(zone, sousZone) {
  if (!zone) return "";

  const isElev = stripAccents(zone).toUpperCase().startsWith("ELEV");
  if (isElev) {
    return (`ÉLEVAGE ${String(sousZone || "").toUpperCase()}`).trim();
  }

  let z = String(zone)
    .toUpperCase()
    .replace(/^FAO\s*/, "FAO")
    .replace(/^FAO(\d+)/, "FAO $1")
    .trim();

  let sz = String(sousZone || "")
    .toUpperCase()
    .replace(/\./g, "")
    .trim();

  return `${z}${sz ? ` ${sz}` : ""}`.replace(/\s{2,}/g, " ").trim();
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

function isRefLine(s) {
  return /^\d{6,9}$/.test(normalizeText(s));
}

function isIntegerLine(s) {
  return /^\d+$/.test(normalizeText(s));
}

function isDecimalLine(s) {
  return /^\d+(?:,\d+)?$/.test(normalizeText(s));
}

function isUnitLine(s) {
  return /^(K|U|C)$/i.test(normalizeText(s));
}

function extractEnginNomLatin(line = "") {
  const cleaned = normalizeText(line).replace(/Lot\s*N[°o]?\s*:.*$/i, "").trim();
  const parts = cleaned.split("/");

  return {
    engin: normalizeEngin((parts[0] || "").trim()),
    nomLatin: (parts[1] || "").trim(),
  };
}

function extractZoneSousZone(line = "") {
  const txt = normalizeText(line);
  const noAcc = stripAccents(txt).toUpperCase();

  if (/^ELEV/i.test(noAcc)) {
    const rest = txt.replace(/^Elev[ée]?\s+en\s+mer/i, "").trim();
    return {
      zone: "ÉLEVAGE",
      sousZone: rest ? rest.toUpperCase() : "",
    };
  }

  const m = txt.match(/FAO\s*([0-9]{1,3})(?:[.\s\/-]*([IVX]+))?/i);
  if (m) {
    return {
      zone: `FAO${m[1]}`,
      sousZone: (m[2] || "").replace(/\./g, "").toUpperCase(),
    };
  }

  const m2 = txt.match(/zone\s*([0-9]{1,3})\.([IVX]+)/i);
  if (m2) {
    return {
      zone: `FAO${m2[1]}`,
      sousZone: m2[2].toUpperCase(),
    };
  }

  return { zone: "", sousZone: "" };
}

function extractLot(line = "") {
  const m = normalizeText(line).match(/Lot\s*N[°o]?\s*:\s*([A-Za-z0-9\-]+)/i);
  return m ? m[1].trim() : "";
}

function parseArticleInline(line) {
  const raw = normalizeText(line);

  // Exemple :
  // 000001560 filet de saumon 1.5/2 ECOSSE 4 10,00 K 49,590 14,50 719,06
  const m = raw.match(
    /^(\d{6,9})\s+(.+?)\s+(\d+)\s+(\d+(?:,\d+)?)\s+([KUC])\s+(\d+(?:,\d+)?)\s+(\d+(?:,\d+)?)\s+(\d+(?:,\d+)?)$/i
  );

  if (!m) return null;

  return {
    refFournisseur: keepRef(m[1]),
    designation: normalizeText(m[2]),
    colis: parseInt(m[3], 10) || 0,
    poidsColisKg: parseNumber(m[4]),
    unite: normalizeText(m[5]),
    poidsTotalKg: parseNumber(m[6]),
    prixKg: parseNumber(m[7]),
    montantHT: parseNumber(m[8]),
    nomLatin: "",
    zone: "",
    sousZone: "",
    engin: "",
    lot: "",
    fao: "",
  };
}

function parseLecriMareeText(text) {
  const lines = splitLines(text);
  const rows = [];

  for (let i = 0; i < lines.length; i++) {
    const article = parseArticleInline(lines[i]);
    if (!article) continue;

    const metaLine = normalizeText(lines[i + 1] || "");
    const zoneLine = normalizeText(lines[i + 2] || "");

    const meta = extractEnginNomLatin(metaLine);
    const zoneData = extractZoneSousZone(zoneLine);
    const fao = buildFAO(zoneData.zone, zoneData.sousZone);
    const lot = extractLot(metaLine);

    article.nomLatin = meta.nomLatin || "";
    article.engin = meta.engin || "";
    article.zone = zoneData.zone || "";
    article.sousZone = zoneData.sousZone || "";
    article.fao = fao || "";
    article.lot = lot || "";

    rows.push(article);
    i += 2;
  }

  return rows;
}

module.exports = {
  id: "LECRIMAREE",
  label: "Lecri Marée",
  supportedExtensions: [".pdf"],

  detect(context) {
    let score = 0;

    const name = String(context.originalnameLower || "");
    const ext = String(context.ext || "").toLowerCase();

    if (ext === ".pdf") score += 20;
    if (name.includes("lecri")) score += 100;
    if (name.includes("maree")) score += 40;
    if (name.includes("marée")) score += 40;

    return score;
  },

  async parse(context) {
    let text = "";

    try {
      text = await extractPdfText(context);
    } catch (error) {
      return {
        supplier_code: "10013",
        supplier_name: "Lecri Marée",
        purchase_type: "order",
        document_type: "supplier_bl",
        lines: [],
        warnings: [`Impossible de lire le PDF Lecri Marée: ${error.message}`],
        meta: {
          detected_from_filename: context.originalname || null,
        },
      };
    }

    if (!text) {
      return {
        supplier_code: "10013",
        supplier_name: "Lecri Marée",
        purchase_type: "order",
        document_type: "supplier_bl",
        lines: [],
        warnings: ["Texte PDF vide ou non extrait"],
        meta: {
          detected_from_filename: context.originalname || null,
        },
      };
    }

    const parsedRows = parseLecriMareeText(text);

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

        origin_label: "Lecri Marée",
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
      warnings.push("Aucune ligne exploitable détectée dans le PDF Lecri Marée");
    }

    return {
      supplier_code: "10013",
      supplier_name: "Lecri Marée",
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