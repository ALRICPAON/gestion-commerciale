const { PDFParse } = require("pdf-parse");

function logStep(label, payload = null) {
  if (payload === null) {
    console.log(`[ROYALE_MAREE] ${label}`);
    return;
  }
  console.log(`[ROYALE_MAREE] ${label}`, payload);
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

function normalizeText(raw) {
  return String(raw || "")
    .replace(/[\u00A0\u202F\u2009\u2002\u2003]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanRef(raw) {
  return String(raw || "")
    .trim()
    .replace(/\s+/g, "");
}

function stripAccents(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function buildFAO(zone, sousZone) {
  if (!zone) return "";

  const zoneRaw = normalizeText(zone);
  const sousZoneRaw = normalizeText(sousZone);

  const zoneNoAccent = stripAccents(zoneRaw).toUpperCase();
  if (zoneNoAccent.startsWith("ELEV")) {
    return (`ÉLEVAGE ${sousZoneRaw.toUpperCase()}`).trim();
  }

  let z = zoneRaw
    .toUpperCase()
    .replace(/^FAO\s*/, "FAO")
    .replace(/^FAO(\d+)/, "FAO $1")
    .trim();

  let sz = sousZoneRaw
    .toUpperCase()
    .replace(/\./g, "")
    .trim();

  return `${z}${sz ? ` ${sz}` : ""}`.replace(/\s{2,}/g, " ").trim();
}

function normalizeFishingGear(engin) {
  let e = normalizeText(engin).toUpperCase();
  if (!e) return "";

  if (e.includes("FILMAIL")) return "FILET MAILLANT";
  if (e.includes("FILET MAILL")) return "FILET MAILLANT";
  if (e.includes("FILTS")) return "FILET TOURNANT";
  if (e.includes("FILET TOURN")) return "FILET TOURNANT";
  if (e.includes("LIGNE")) return "LIGNE";
  if (e.includes("CHALUT")) return "CHALUT";

  return normalizeText(engin);
}

function isLatinLine(line) {
  const s = normalizeText(line);
  if (!s) return false;
  return /^[A-Z][a-z]+(?:\s+[A-Za-z'\-]+){1,3}(?:\s+[A-Z]{2,5})?$/.test(s);
}

async function extractPdfText(context) {
  if (typeof context.text === "string" && context.text.trim()) return context.text;
  if (typeof context.pdfText === "string" && context.pdfText.trim()) return context.pdfText;
  if (!context.buffer) return "";

  logStep("extractPdfText -> parsing PDF buffer with PDFParse v2", {
    originalname: context.originalname || null,
    ext: context.ext || null,
    bufferLength: context.buffer.length || 0,
  });

  const parser = new PDFParse({ data: context.buffer });
  const result = await parser.getText();
  const text = String(result?.text || "");

  logStep("extractPdfText -> parsed text preview", text.slice(0, 2000));

  return text;
}

function splitLines(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => normalizeText(line))
    .filter(Boolean);

  logStep("splitLines -> count", { count: lines.length });
  logStep("splitLines -> preview", lines.slice(0, 40));

  return lines;
}

function parseArticleHeader(line) {
  const raw = normalizeText(line);

  // Format réellement extrait par pdf-parse sur ton PDF :
  // 02616 50 3,000 2 392,50 15,95 150,00 DOS D'EGLEFIN
  const match = raw.match(
    /^(\d{4,5})\s+(\d+)\s+(\d+(?:,\d+)?)\s+([\d\s]+,\d+)\s+(\d+(?:,\d+)?)\s+(\d+(?:,\d+)?)\s+(.+)$/i
  );

  if (!match) {
    logStep("parseArticleHeader -> NO MATCH", raw);
    return null;
  }

  const parsed = {
    refFournisseur: cleanRef(match[1]),
    colis: parseInt(match[2], 10) || 0,
    poidsColisKg: parseNumber(match[3]),
    montantHT: parseNumber(match[4]),
    prixKg: parseNumber(match[5]),
    poidsTotalKg: parseNumber(match[6]),
    designation: normalizeText(match[7]),
    nomLatin: "",
    zone: "",
    sousZone: "",
    engin: "",
    lot: "",
    fao: "",
  };

  logStep("parseArticleHeader -> MATCH", { raw, parsed });

  return parsed;
}

function parseRoyaleMareeLines(text) {
  const lines = splitLines(text);
  const rows = [];
  let current = null;

  const pushCurrent = (reason) => {
    if (!current) return;

    if (!current.fao) {
      current.fao = buildFAO(current.zone, current.sousZone);
    }

    logStep("pushCurrent", { reason, current });

    if (
      current.refFournisseur &&
      current.designation &&
      current.designation.length > 2 &&
      !["0008", "85350", "85100", "44360"].includes(String(current.refFournisseur))
    ) {
      rows.push(current);
      logStep("pushCurrent -> row accepted", current);
    } else {
      logStep("pushCurrent -> row rejected", current);
    }

    current = null;
  };

  for (const line of lines) {
    logStep("loop line", line);

    if (
  /^(BON DE LIVRAISON|N° N° Client Date|Page \d+\/\d+|Article Désignation|CENTRE DE MAREE|PORT JOINVILLE|Tél\.|Tel\.|Fax|SIRET|FR\b|France\b|Transp\.|Départ\s*:|Total Etablissement|Total Bon)/i.test(line) ||
  /^(\(pour Facture\)|-- \d+ of \d+ --)$/i.test(line)
) {
  logStep("line skipped by header/footer filter", line);
  continue;
}

    const article = parseArticleHeader(line);
    if (article) {
      pushCurrent("new article header");
      current = article;
      continue;
    }

    if (!current) {
      logStep("line ignored because no current article", line);
      continue;
    }

    if (isLatinLine(line)) {
      current.nomLatin = line;
      logStep("latin line attached", { line, current });
      continue;
    }

    if (/^\|/.test(line) && /(FAO|Pêché|Peche|Elevé|Eleve)/i.test(line)) {
      const allFAO = [...line.matchAll(/FAO\s*([0-9]{1,3})[.\s]*([IVX]*)/gi)];
      if (allFAO.length) {
        const last = allFAO[allFAO.length - 1];
        current.zone = `FAO${last[1]}`;
        current.sousZone = last[2]
          ? normalizeText(last[2]).toUpperCase().replace(/\./g, "")
          : "";
        current.fao = buildFAO(current.zone, current.sousZone);
      }

      if (/Elevé|Eleve/i.test(line)) {
        current.zone = "ÉLEVAGE";
        const m = line.match(/(?:Elevé|Eleve).+?en\s*:?\s*([^|]+)/i);
        if (m) current.sousZone = normalizeText(m[1]).toUpperCase();
        current.fao = buildFAO(current.zone, current.sousZone);
      }

      logStep("FAO line attached", { line, current });
      continue;
    }

    if (/^\|/.test(line) && /Engin/i.test(line)) {
      const m = line.match(/Engin\s*:\s*([^|]+)/i);
      if (m) current.engin = normalizeFishingGear(m[1]);
      logStep("gear line attached", { line, current });
      continue;
    }

    if (/^\|/.test(line) && /(N°\s*Lot|Lot)/i.test(line)) {
      const m = line.match(/(?:N°\s*Lot|Lot)\s*:\s*([A-Za-z0-9\-]+)/i);
      if (m) current.lot = normalizeText(m[1]);
      logStep("lot line attached", { line, current });
      continue;
    }

    logStep("line not used", { line, current });
  }

  pushCurrent("end of document");
  logStep("parseRoyaleMareeLines -> final rows", rows);

  return rows;
}

module.exports = {
  id: "ROYALE_MAREE",
  label: "Royale Marée",
  supportedExtensions: [".pdf"],

  detect(context) {
    let score = 0;

    const name = String(context.originalnameLower || "");
    const ext = String(context.ext || "").toLowerCase();

    if (ext === ".pdf") score += 20;
    if (/^c\d{8,}-\d+\.pdf$/i.test(name)) score += 100;
    if (name.includes("royale")) score += 80;
    if (name.includes("maree")) score += 40;
    if (name.includes("marée")) score += 40;

    logStep("detect", { name, ext, score });

    return score;
  },

  async parse(context) {
    logStep("parse -> start", {
      originalname: context.originalname || null,
      ext: context.ext || null,
    });

    let text = "";

    try {
      text = await extractPdfText(context);
    } catch (error) {
      logStep("parse -> extractPdfText error", error.message);

      return {
        supplier_code: "10004",
        supplier_name: "Royale Marée",
        purchase_type: "order",
        document_type: "supplier_bl",
        lines: [],
        warnings: [`Impossible de lire le PDF Royale Marée: ${error.message}`],
        meta: {
          detected_from_filename: context.originalname || null,
        },
      };
    }

    if (!text) {
      logStep("parse -> empty text");

      return {
        supplier_code: "10004",
        supplier_name: "Royale Marée",
        purchase_type: "order",
        document_type: "supplier_bl",
        lines: [],
        warnings: ["Texte PDF vide ou non extrait"],
        meta: {
          detected_from_filename: context.originalname || null,
        },
      };
    }

    const parsed = parseRoyaleMareeLines(text);

    const lines = parsed.map((L) => ({
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

      origin_label: "Royale Marée",
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

    logStep("parse -> mapped lines", lines);

    const warnings = [];
    if (!lines.length) {
      warnings.push("Aucune ligne exploitable détectée dans le PDF Royale Marée");
    }

    const result = {
      supplier_code: "10004",
      supplier_name: "Royale Marée",
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

    logStep("parse -> final result", result);

    return result;
  },
};
