function parseNumber(raw) {
  if (raw === undefined || raw === null || raw === "") return 0;
  if (typeof raw === "number") return Number(raw);

  let s = String(raw).trim();
  s = s.replace(/[\u00A0\u202F\u2009\u2002\u2003]/g, "");
  s = s.replace(/\s+/g, "");
  s = s.replace(/[^\d\.,\-]/g, "");

  if (s.indexOf(".") > -1 && s.indexOf(",") > -1) {
    if (s.indexOf(".") < s.indexOf(",")) {
      s = s.replace(/\./g, "").replace(/,/g, ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (s.indexOf(",") > -1 && s.indexOf(".") === -1) {
    s = s.replace(/,/g, ".");
  } else if (s.indexOf(".") > -1 && s.indexOf(",") === -1) {
    const dotCount = (s.match(/\./g) || []).length;
    if (dotCount > 1) {
      s = s.replace(/\./g, "");
    }
  }

  s = s.replace(/[^\d\.\-]/g, "");
  const x = parseFloat(s);
  return Number.isFinite(x) ? x : 0;
}

function parseNumberSafe(raw) {
  try {
    return parseNumber(raw);
  } catch {
    return 0;
  }
}

function cleanId(v) {
  const s = (v ?? "").toString().trim();
  if (!s) return "";
  return s.replace(/\.0$/, "").trim();
}

function isEmptyRow(r) {
  if (!r || !r.length) return true;
  return r.every((c) => c == null || String(c).trim() === "");
}

function firstNonEmptyInRange(row, a, b) {
  for (let i = a; i <= b; i++) {
    const v = row?.[i];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function joinNonEmptyRange(row, a, b) {
  const parts = [];
  for (let i = a; i <= b; i++) {
    const v = row?.[i];
    if (v != null && String(v).trim() !== "") {
      parts.push(String(v).trim());
    }
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function normalizeEan(raw) {
  if (!raw) return "";
  const digits = String(raw).replace(/\s+/g, "").replace(/[^\d]/g, "");
  return digits.length === 13 ? digits : "";
}

function getRowsFromWorkbook(context) {
  const workbook = context.workbook;
  if (!workbook || !Array.isArray(workbook.SheetNames) || workbook.SheetNames.length === 0) {
    return [];
  }

  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) return [];

  const XLSX = require("xlsx");

  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    blankrows: false,
    defval: "",
  });
}

function extractEanFromRows(rows, baseIndex, colStart, colEnd) {
  for (let k = 1; k <= 8; k++) {
    const r = rows[baseIndex + k];
    if (!r) continue;

    const raw = joinNonEmptyRange(r, colStart, colEnd);
    const ean = normalizeEan(raw);
    if (ean) return ean;
  }

  return "";
}

module.exports = {
  id: "SCAOUEST",
  label: "Scaouest",
  supportedExtensions: [".xlsx", ".xls", ".csv"],

  detect(context) {
    let score = 0;

    const name = String(context.originalnameLower || "");
    const rowsText = Array.isArray(context.previewRows)
      ? context.previewRows.flat().join(" ").toLowerCase()
      : "";

    if (name.includes("scaouest")) score += 90;
    if (name.includes("sca ouest")) score += 90;
    if (name.includes("a-scaouest")) score += 60;

    if (rowsText.includes("a-scaouest")) score += 80;
    if (rowsText.includes("quantité en uvc")) score += 30;
    if (rowsText.includes("prix unitaire facturé ht")) score += 30;
    if (rowsText.includes("planning de commande")) score += 20;

    if (this.supportedExtensions.includes(context.ext)) score += 10;

    return score;
  },

  async parse(context) {
    const rows = getRowsFromWorkbook(context);

    if (!Array.isArray(rows) || rows.length === 0) {
      return {
        supplier_code: "10006",
        supplier_name: "SCAOUEST",
        purchase_type: "order",
        document_type: "supplier_bl",
        lines: [],
        warnings: ["Fichier vide ou illisible"],
        meta: {
          detected_from_filename: context.originalname || null,
          sheet_names: context.sheetNames || [],
        },
      };
    }

    const warnings = [];
    const lines = [];

    // Colonnes 0-based reprises de la V1
    const COL_REF_A = 0;        // A
    const COL_DES_I = 8;        // I
    const COL_DES_X = 23;       // X
    const COL_UVC_AM = 38;      // AM
    const COL_PRIX_UVC_AQ = 42; // AQ (ou AQ:AR)
    const COL_MONTANT_AT = 45;  // AT

    const COL_EAN_U = 20;       // U
    const COL_EAN_Z = 25;       // Z

    let start = 0;
    for (let i = 0; i < rows.length; i++) {
      const v = String(rows[i]?.[COL_DES_I] ?? "").toLowerCase();
      if (v.includes("désignation") || v.includes("designation")) {
        start = i + 1;
        break;
      }
    }

    for (let i = start; i < rows.length; i++) {
      const r = rows[i];
      if (isEmptyRow(r)) continue;

      const designation = joinNonEmptyRange(r, COL_DES_I, COL_DES_X);
      if (!designation) continue;

      let supplierRef = cleanId(r[COL_REF_A]);
      if (!supplierRef || /^\(.+\)$/.test(supplierRef)) continue;

      const uvc = parseNumberSafe(r[COL_UVC_AM]);
      const prixUvc = parseNumberSafe(firstNonEmptyInRange(r, COL_PRIX_UVC_AQ, COL_PRIX_UVC_AQ + 1));

      if (!uvc || !prixUvc) continue;

      const ean = extractEanFromRows(rows, i, COL_EAN_U, COL_EAN_Z);
      if (!ean) {
        warnings.push(`EAN introuvable autour de la ligne ${i + 1} (${designation})`);
        continue;
      }

      let montantHT = parseNumberSafe(r[COL_MONTANT_AT]);
      if ((!montantHT || montantHT === 0) && uvc && prixUvc) {
        montantHT = Number((uvc * prixUvc).toFixed(2));
      }

      lines.push({
        supplier_reference: supplierRef || ean,
        supplier_label: designation || null,
        article_plu: ean,
        designation: designation || null,
        latin_name: null,
        fao_zone: null,
        sous_zone: null,
        fishing_gear: null,
        origin_label: "LS",
        allergens: null,

        // V2 propre : LS en pièce/UVC
        ordered_colis: null,
        ordered_pieces: Number(uvc || 0),
        ordered_quantity: null,

        unit_price_ex_vat: prixUvc || null,
        price_unit: "piece",
        line_amount_ex_vat: montantHT || null,

        supplier_lot_number: null,
        dlc: null,

        line_kind: "LS",
        needs_mapping: false,
        needs_article_creation: true,
      });
    }

    if (!lines.length) {
      warnings.push("Aucune ligne SCAOUEST exploitable détectée");
    }

    return {
      supplier_code: "10006",
      supplier_name: "SCAOUEST",
      purchase_type: "order",
      document_type: "supplier_bl",
      lines,
      warnings,
      meta: {
        detected_from_filename: context.originalname || null,
        row_count: rows.length,
        parsed_line_count: lines.length,
        sheet_names: context.sheetNames || [],
      },
    };
  },
};