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
    } else {
      const parts = s.split(".");
      const intPart = parts[0] || "";
      const fracPart = parts[1] || "";

      if (fracPart.length === 3 && intPart.length > 3) {
        s = s.replace(/\./g, "");
      }
    }
  }

  s = s.replace(/[^\d\.\-]/g, "");

  const x = parseFloat(s);
  return Number.isFinite(x) ? x : 0;
}

function parseNumberSafe(raw) {
  try {
    return parseNumber(raw);
  } catch (error) {
    return 0;
  }
}

function normalizeRef(raw) {
  return String(raw || "")
    .trim()
    .replace(/^0+/, "")
    .replace(/\s+/g, "")
    .replace(/\//g, "_");
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

module.exports = {
  id: "SCAPMAREE",
  label: "Scapmarée",
  supportedExtensions: [".xlsx", ".xls", ".csv"],

  detect(context) {
    let score = 0;

    const name = context.originalnameLower || "";
    const rowsText = Array.isArray(context.previewRows)
      ? context.previewRows.flat().join(" ").toLowerCase()
      : "";

    if (name.includes("scapmaree")) score += 80;
    if (name.includes("scap")) score += 40;

    if (rowsText.includes("scapmar")) score += 60;
    if (rowsText.includes("scapmarée")) score += 60;

    if (this.supportedExtensions.includes(context.ext)) score += 10;

    return score;
  },

  async parse(context) {
    const rows = getRowsFromWorkbook(context);

    if (!Array.isArray(rows) || rows.length === 0) {
      return {
        supplier_code: "10001",
        supplier_name: "SCAPMAREE",
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

    const lines = [];
    const warnings = [];

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || !r.length) continue;

      const designation = r[1] ?? "";
      const nomLatin = r[2] ?? "";
      const eanL = normalizeEan(r[11]);

      // =========================
      // BRANCHE LS
      // =========================
      if (eanL) {
        const plu = eanL;

        const f = parseNumberSafe(r[5]);
        const g = parseNumberSafe(r[6]);
        const poidsTotalKg = Number((f * g).toFixed(3));

        const prixKg = parseNumberSafe(r[10] ?? r[8]);

        let montantHT = parseNumberSafe(r[9]);
        if (!montantHT && poidsTotalKg && prixKg) {
          montantHT = Number((poidsTotalKg * prixKg).toFixed(2));
        }

        lines.push({
          supplier_reference: plu,
          supplier_label: designation || null,
          article_plu: plu,
          designation: designation || null,
          latin_name: nomLatin || null,
          fao_zone: null,
          sous_zone: null,
          fishing_gear: null,
          origin_label: "LS",
          allergens: null,
          ordered_colis: f || null,
          ordered_pieces: null,
          ordered_quantity: poidsTotalKg || null,
          unit_price_ex_vat: prixKg || null,
          price_unit: "kg",
          line_amount_ex_vat: montantHT || null,
          supplier_lot_number: null,
          dlc: null,
          line_kind: "LS",
          needs_article_creation: true,
          needs_mapping: false,
        });

        continue;
      }

      // =========================
      // BRANCHE TRAD
      // =========================
      let ref = normalizeRef(r[0]);
      if (!ref) continue;

      const poidsTotalKg = parseNumberSafe(r[7]);
      const prixKg = parseNumberSafe(r[10] ?? r[8]);

      let montantHT = parseNumberSafe(r[9]);
      if (!montantHT && poidsTotalKg && prixKg) {
        montantHT = Number((poidsTotalKg * prixKg).toFixed(2));
      }

      lines.push({
        supplier_reference: ref,
        supplier_label: designation || null,
        article_plu: null,
        designation: designation || null,
        latin_name: nomLatin || null,
        fao_zone: null,
        sous_zone: null,
        fishing_gear: null,
        origin_label: "TRAD",
        allergens: null,
        ordered_colis: null,
        ordered_pieces: null,
        ordered_quantity: poidsTotalKg || null,
        unit_price_ex_vat: prixKg || null,
        price_unit: "kg",
        line_amount_ex_vat: montantHT || null,
        supplier_lot_number: null,
        dlc: null,
        line_kind: "TRAD",
        needs_article_creation: false,
        needs_mapping: true,
      });
    }

    if (!lines.length) {
      warnings.push("Aucune ligne Scapmarée exploitable détectée");
    }

    const lsCount = lines.filter((line) => line.line_kind === "LS").length;
    const tradCount = lines.filter((line) => line.line_kind === "TRAD").length;

    return {
      supplier_code: "10001",
      supplier_name: "SCAPMAREE",
      purchase_type: "order",
      document_type: "supplier_bl",
      lines,
      warnings,
      meta: {
        detected_from_filename: context.originalname || null,
        row_count: rows.length,
        parsed_line_count: lines.length,
        sheet_names: context.sheetNames || [],
        ls_count: lsCount,
        trad_count: tradCount,
      },
    };
  },
};