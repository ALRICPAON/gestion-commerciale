function parseNumber(raw) {
  if (raw === undefined || raw === null || raw === "") return 0;
  if (typeof raw === "number") return Number(raw);

  let s = String(raw).trim();
  s = s.replace(/[\u00A0\u202F\u2009\u2002\u2003]/g, "");
  s = s.replace(/\s+/g, "");

  if (s.indexOf(".") > -1 && s.indexOf(",") > -1) {
    if (s.indexOf(".") < s.indexOf(",")) {
      s = s.replace(/\./g, "").replace(/,/g, ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (s.indexOf(",") > -1 && s.indexOf(".") === -1) {
    s = s.replace(/,/g, ".");
  }

  s = s.replace(/[^\d.\-]/g, "");
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

function cleanRef(raw) {
  return String(raw || "")
    .trim()
    .replace(/^0+/, "")
    .replace(/\s+/g, "")
    .replace(/\//g, "_");
}

function cleanPlu(raw) {
  let v = String(raw || "").trim();
  if (v.endsWith(".0")) v = v.slice(0, -2);
  return v;
}

function normalizeText(raw) {
  return String(raw || "").trim();
}

function normalizeCompareText(raw) {
  return normalizeText(raw).toUpperCase();
}

function toRoman(num) {
  num = parseInt(num, 10);
  if (isNaN(num) || num <= 0) return "";

  const map = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];

  let out = "";
  for (const [value, numeral] of map) {
    while (num >= value) {
      out += numeral;
      num -= value;
    }
  }
  return out;
}

function extractZoneNum(s) {
  const t = String(s || "");
  const m = t.match(/(?:FAO\s*)?(\d{1,3})/i);
  return m ? m[1] : "";
}

function extractSousZoneRomanOrNum(s) {
  const t = String(s || "").trim();

  const mRoman = t.match(
    /\b(M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{1,3}))\b/i
  );
  if (mRoman && mRoman[1]) return mRoman[1].toUpperCase();

  const mParen = t.match(/\((\d{1,3})\)/);
  if (mParen) {
    let n = mParen[1];
    if (n.length === 3 && n[0] === "0") {
      n = n.replace(/^0+/, "");
      if (/^\d+$/.test(n) && parseInt(n, 10) > 12 && parseInt(n, 10) % 10 === 0) {
        n = String(parseInt(n, 10) / 10);
      }
    }
    if (/^0\d$/.test(n)) n = n.slice(1);

    const ni = parseInt(n, 10);
    if (!isNaN(ni) && ni > 0) return toRoman(ni);
  }

  const mNum = t.match(/\b([1-9]|1[0-2])\b/);
  if (mNum) return toRoman(parseInt(mNum[1], 10));
  return "";
}

function buildFao(zone, sousZone) {
  const zoneNum = extractZoneNum(zone);
  let romanSZ = extractSousZoneRomanOrNum(sousZone);
  if (!romanSZ) romanSZ = extractSousZoneRomanOrNum(zone);
  if (zoneNum && romanSZ) return `FAO${zoneNum} ${romanSZ}`;
  if (zoneNum) return `FAO${zoneNum}`;
  return "";
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

function getAfMapCandidates(context) {
  const out = {};
  const sources = [
    context.afMap,
    context.af_map,
    context.afMapByKey,
    context.af_map_by_key,
  ];

  for (const src of sources) {
    if (!src || typeof src !== "object") continue;
    for (const [k, v] of Object.entries(src)) {
      out[String(k).toUpperCase()] = v;
    }
  }

  return out;
}

function getArticlesList(context) {
  if (Array.isArray(context.articles)) return context.articles;
  if (Array.isArray(context.articleList)) return context.articleList;
  if (Array.isArray(context.articlesList)) return context.articlesList;

  if (context.articlesMap && typeof context.articlesMap === "object") {
    return Object.entries(context.articlesMap).map(([id, data]) => ({
      id,
      ...data,
    }));
  }

  if (context.articles_map && typeof context.articles_map === "object") {
    return Object.entries(context.articles_map).map(([id, data]) => ({
      id,
      ...data,
    }));
  }

  return [];
}

function findArticleByDesignation(articles, designation) {
  const wanted = normalizeCompareText(designation);
  if (!wanted) return null;
  return articles.find((a) => normalizeCompareText(a.designation) === wanted) || null;
}

function getAfMapLookupRefs(ref) {
  const refs = [ref, cleanRef(ref)];
  return [...new Set(refs.map((value) => String(value || "").trim()).filter(Boolean))];
}

function getAfMapSupplierCodes(supplierCode) {
  const code = String(supplierCode || "").trim();
  return code === "81269" ? ["81269", "81268"] : [code];
}

function getAfMapRecord(afMap, supplierCode, ref) {
  const supplierCodes = getAfMapSupplierCodes(supplierCode);
  const refs = getAfMapLookupRefs(ref);

  for (const code of supplierCodes) {
    for (const candidateRef of refs) {
      const key = `${code}__${candidateRef}`.toUpperCase();
      if (afMap[key]) return afMap[key];
    }
  }

  return null;
}

function parseWithLayout(rows, layout, supplierCode, afMap, articles) {
  const lines = [];
  const warnings = [];
  let skippedEmptyRef = 0;
  let skippedNoData = 0;
  let mappedCount = 0;
  let fallbackArticleCount = 0;
  let missingMappingCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length) continue;

    const ref = cleanRef(r[layout.colPLU]);
    let designation = normalizeText(r[layout.colDesignation]);
    const nomLatin = normalizeText(r[layout.colNomLatin]);

    let prixHTKg = parseNumberSafe(r[layout.colPrixKg]);
    let poidsKg = parseNumberSafe(r[layout.colPoidsKg]);
    let montantHT = parseNumberSafe(r[layout.colMontantHT]);

    let zone = normalizeText(r[layout.colZone]);
    let sousZoneRaw = normalizeText(r[layout.colSousZone]);
    let engin = normalizeText(r[layout.colEngin]);

    if (!designation && r[layout.colDesignation + 1] !== undefined) {
      designation = normalizeText(r[layout.colDesignation + 1]);
    }
    if (!prixHTKg && r[layout.colPrixKg + 1] !== undefined) {
      prixHTKg = parseNumberSafe(r[layout.colPrixKg + 1]);
    }
    if (!poidsKg && r[layout.colPoidsKg + 1] !== undefined) {
      poidsKg = parseNumberSafe(r[layout.colPoidsKg + 1]);
    }
    if (!montantHT && r[layout.colMontantHT + 1] !== undefined) {
      montantHT = parseNumberSafe(r[layout.colMontantHT + 1]);
    }

    if (!ref) {
      skippedEmptyRef++;
      continue;
    }

    const hasData =
      (poidsKg && poidsKg > 0) ||
      (prixHTKg && prixHTKg > 0) ||
      (montantHT && montantHT > 0);
    if (!hasData) {
      skippedNoData++;
      continue;
    }

    const fournisseurDesignation = designation || `ARTICLE ${ref}`;
    const prixMajore = prixHTKg > 0 ? Number((prixHTKg * 1.1 + 0.3).toFixed(4)) : 0;

    if ((!montantHT || montantHT === 0) && poidsKg && prixMajore) {
      montantHT = Number((poidsKg * prixMajore).toFixed(2));
    }

    let finalZone = zone || null;
    let finalSousZone = extractSousZoneRomanOrNum(sousZoneRaw) || sousZoneRaw || null;
    let fao = buildFao(finalZone, finalSousZone);

    const afRecord = getAfMapRecord(afMap, supplierCode, ref);
    let articlePlu = cleanPlu(afRecord?.plu || "");
    let designationInterne = normalizeText(afRecord?.designationInterne || "");
    let allergens = normalizeText(afRecord?.allergenes || "");

    if (!articlePlu) {
      const articleFallback = findArticleByDesignation(articles, fournisseurDesignation);
      if (articleFallback) {
        articlePlu = cleanPlu(articleFallback.id || articleFallback.plu || "");
        fallbackArticleCount++;

        if (articleFallback.zone) finalZone = normalizeText(articleFallback.zone);
        if (articleFallback.sousZone) {
          const fallbackSousZone = normalizeText(articleFallback.sousZone);
          finalSousZone = extractSousZoneRomanOrNum(fallbackSousZone) || fallbackSousZone || finalSousZone;
        }
        if (articleFallback.engin) engin = normalizeText(articleFallback.engin);
        if (!allergens && articleFallback.allergenes) {
          allergens = normalizeText(articleFallback.allergenes);
        }
        fao = buildFao(finalZone, finalSousZone);
      }
    }

    const finalDesignation = fournisseurDesignation || null;
    const finalInternalDesignation = designationInterne || finalDesignation;
    const needsMapping = !articlePlu;
    if (needsMapping) missingMappingCount++;
    else mappedCount++;

    lines.push({
      supplier_reference: ref,
      supplier_label: finalDesignation,
      article_plu: articlePlu || null,
      designation: finalDesignation,
      internal_designation: finalInternalDesignation || null,
      latin_name: nomLatin || null,
      fao_zone: fao || finalZone || null,
      sous_zone: finalSousZone,
      fao: fao || null,
      fishing_gear: engin || null,
      allergens: allergens || null,
      ordered_quantity: poidsKg || null,
      received_quantity: 0,
      unit_price_ex_vat: prixMajore || null,
      supplier_unit_price_ex_vat: prixHTKg || null,
      price_unit: "kg",
      line_amount_ex_vat: montantHT || null,
      line_kind: "TRAD",
      needs_mapping: needsMapping,
    });
  }

  if (!lines.length) {
    warnings.push("Aucune ligne exploitable détectée pour le format Criée PLU A");
  }

  return {
    lines,
    warnings,
    stats: {
      parsed: lines.length,
      mappedCount,
      fallbackArticleCount,
      missingMappingCount,
      skippedEmptyRef,
      skippedNoData,
    },
  };
}

module.exports = {
  id: "CRIEE",
  label: "Criée",
  supportedExtensions: [".xlsx", ".xls", ".csv"],

  detect(context) {
    let score = 0;
    const name = String(context.originalnameLower || "");
    const rowsText = Array.isArray(context.previewRows)
      ? context.previewRows.flat().join(" ").toLowerCase()
      : "";

    if (name.includes("criee")) score += 80;
    if (name.includes("criée")) score += 80;
    if (name.includes("81268")) score += 40;
    if (name.includes("81269")) score += 40;
    if (rowsText.includes("nom latin")) score += 25;
    if (rowsText.includes("engin")) score += 25;
    if (rowsText.includes("zone")) score += 20;
    if (rowsText.includes("sous-zone")) score += 20;
    if (rowsText.includes("sous zone")) score += 20;
    if (this.supportedExtensions.includes(context.ext)) score += 10;
    return score;
  },

  async parse(context) {
    const rows = getRowsFromWorkbook(context);
    const afMap = getAfMapCandidates(context);
    const articles = getArticlesList(context);

    if (!Array.isArray(rows) || rows.length === 0) {
      return {
        supplier_code: "81268",
        supplier_name: "CRIÉE",
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

    const supplierCode = context.supplier_code_override || "81268";
    const supplierName = supplierCode === "81269" ? "CRIÉE DES SABLES" : "CRIÉE SAINT-GILLES";

    const layout = {
      name: "PLU_A",
      colPLU: 0,
      colDesignation: 1,
      colNomLatin: 2,
      colPrixKg: 6,
      colPoidsKg: 7,
      colMontantHT: 8,
      colZone: 10,
      colSousZone: 11,
      colEngin: 12,
    };

    const parsed = parseWithLayout(rows, layout, supplierCode, afMap, articles);

    const totalWeight = parsed.lines.reduce((sum, line) => sum + Number(line.ordered_quantity || 0), 0);
    const totalAmount = parsed.lines.reduce((sum, line) => sum + Number(line.line_amount_ex_vat || 0), 0);

    const globalWarnings = [...parsed.warnings];
    if (parsed.stats?.missingMappingCount > 0) {
      globalWarnings.push(`${parsed.stats.missingMappingCount} ligne(s) criée sans mapping article`);
    }

    return {
      supplier_code: supplierCode,
      supplier_name: supplierName,
      purchase_type: "order",
      document_type: "supplier_bl",
      lines: parsed.lines,
      warnings: globalWarnings,
      meta: {
        detected_from_filename: context.originalname || null,
        row_count: rows.length,
        parsed_line_count: parsed.lines.length,
        total_weight: Number(totalWeight.toFixed(3)),
        total_amount_ex_vat: Number(totalAmount.toFixed(2)),
        sheet_names: context.sheetNames || [],
        layout: layout.name,
        mapped_count: parsed.stats?.mappedCount || 0,
        fallback_article_count: parsed.stats?.fallbackArticleCount || 0,
        missing_mapping_count: parsed.stats?.missingMappingCount || 0,
        skipped_empty_ref: parsed.stats?.skippedEmptyRef || 0,
        skipped_no_data: parsed.stats?.skippedNoData || 0,
      },
    };
  },
};