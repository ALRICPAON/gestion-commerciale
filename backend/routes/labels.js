const express = require("express");
const ExcelJS = require("exceljs");

const { authenticateToken } = require("../middleware/auth");
const { attachDbContext } = require("../middleware/dbContext");

const router = express.Router();

/* =========================================================
   Helpers texte / normalisation
========================================================= */

function clean(value) {
  return String(value || "").trim();
}

function removeDiacritics(str) {
  if (!str) return "";
  return String(str).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function alphaKey(str) {
  return removeDiacritics(String(str || ""))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function splitMulti(raw) {
  if (!raw && raw !== 0) return [];

  return String(raw)
    .split(/[\/,;|]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function uniqueClean(values) {
  const seen = new Set();
  const result = [];

  for (const value of values || []) {
    const text = clean(value);
    if (!text) continue;

    const key = alphaKey(text);
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(text);
  }

  return result;
}

function firstValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }

  return "";
}

function getJsonValue(obj, keys = []) {
  if (!obj) return "";

  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && String(obj[key]).trim() !== "") {
      return obj[key];
    }
  }

  return "";
}

function normalizeFAO(raw) {
  const value = clean(raw);
  if (!value) return "";

  const normalized = value
    .replace(/\s*-\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const match =
    normalized.match(/fa[oô]?\s*[:\-]?\s*([0-9]{1,3})\s*(.*)$/i) ||
    normalized.match(/^([0-9]{1,3})\s*(.*)$/);

  if (!match) return normalized.toUpperCase();

  const num = match[1];
  const rest = clean(match[2]);

  return rest ? `FAO${num} - ${rest.toUpperCase()}` : `FAO${num}`;
}

function normalizeEngin(raw) {
  const value = clean(raw);
  if (!value) return "";

  let s = value.toLowerCase();

  s = s.replace(/[()\[\]\.]/g, " ");
  s = s.replace(/\botb\b/g, "");
  s = s.replace(/[_\-\/,;]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();

  if (!s) return "";

  return s
    .split(" ")
    .map((word) => {
      const w = word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ");
}

function normalizeMethod(raw) {
  const value = clean(raw);
  if (!value) return "";

  return value
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function normalizeLatin(raw) {
  const value = clean(raw);
  if (!value) return "";

  return value
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/* =========================================================
   Extraction données lots / traçabilité
========================================================= */

function extractTraceabilityValue(lot, keys = []) {
  const traceability = lot.traceability_data || {};

  return firstValue(
    getJsonValue(traceability, keys),
    getJsonValue(lot, keys)
  );
}

function buildLabelInfo({ article, articleDepartment, metadata, lots, pricing }) {
  const designation = firstValue(
    articleDepartment.display_name,
    getJsonValue(article, ["designation", "name", "label"]),
    getJsonValue(metadata, ["designation", "label", "article_label"]),
    lots.map((lot) => extractTraceabilityValue(lot, ["designation", "article_label"])).find(Boolean)
  );

  const nomLatinTokens = [];
  const faoTokens = [];
  const enginTokens = [];
  const allergenesTokens = [];
  const methodeTokens = [];
  const crieeTokens = [];
  const decongeleTokens = [];

  const articleNomLatin = firstValue(
    metadata.nom_latin,
    metadata.latin_name,
    getJsonValue(metadata, ["nomLatin", "scientific_name", "espece", "species"])
  );
  if (articleNomLatin) splitMulti(articleNomLatin).forEach((v) => nomLatinTokens.push(v));

  const articleFao = firstValue(
    metadata.fao_zone,
    getJsonValue(metadata, ["fao", "zone_peche", "zonePeche", "fishing_zone"])
  );
  if (articleFao) splitMulti(articleFao).forEach((v) => faoTokens.push(v));

  const articleSousZone = firstValue(
    metadata.sous_zone,
    getJsonValue(metadata, ["sousZone", "sub_zone", "subZone"])
  );

  const articleZonePeche = articleFao || articleSousZone;
  if (articleZonePeche) splitMulti(articleZonePeche).forEach((v) => faoTokens.push(v));

  const articleEngin = firstValue(
    metadata.engin,
    getJsonValue(metadata, ["fishing_gear", "engin_peche", "enginPeche"])
  );
  if (articleEngin) splitMulti(articleEngin).forEach((v) => enginTokens.push(v));

  const articleAllergenes = firstValue(
    metadata.allergenes,
    metadata.allergens
  );
  if (articleAllergenes) splitMulti(articleAllergenes).forEach((v) => allergenesTokens.push(v));

  const articleMethode = firstValue(
    metadata.category,
    article.category,
    metadata.production_method,
    getJsonValue(metadata, ["methode_prod", "methodeProd", "methode", "method", "categorie", "elevage"])
  );
  if (articleMethode) splitMulti(articleMethode).forEach((v) => methodeTokens.push(v));

  for (const lot of lots) {
    const nomLatin = extractTraceabilityValue(lot, [
      "latin_name",
      "nom_latin",
      "nomLatin",
      "scientific_name",
      "espece",
      "species"
    ]);
    if (nomLatin) splitMulti(nomLatin).forEach((v) => nomLatinTokens.push(v));

    const fao = extractTraceabilityValue(lot, [
      "fao_zone",
      "fao",
      "zone_peche",
      "zonePeche",
      "fishing_zone"
    ]);
    if (fao) splitMulti(fao).forEach((v) => faoTokens.push(v));

    const sousZone = extractTraceabilityValue(lot, [
      "sous_zone",
      "sousZone",
      "sub_zone",
      "subZone"
    ]);

    const zonePeche = fao || sousZone;
    if (zonePeche) splitMulti(zonePeche).forEach((v) => faoTokens.push(v));

    const engin = extractTraceabilityValue(lot, [
      "fishing_gear",
      "engin",
      "engin_peche",
      "enginPeche"
    ]);
    if (engin) splitMulti(engin).forEach((v) => enginTokens.push(v));

    const allergenes = extractTraceabilityValue(lot, [
      "allergens",
      "allergenes"
    ]);
    if (allergenes) splitMulti(allergenes).forEach((v) => allergenesTokens.push(v));

    const methode = extractTraceabilityValue(lot, [
      "production_method",
      "methode_prod",
      "methodeProd",
      "methode",
      "method",
      "category",
      "categorie",
      "elevage"
    ]);
    if (!articleMethode && methode) splitMulti(methode).forEach((v) => methodeTokens.push(v));

    const criee = extractTraceabilityValue(lot, [
      "criee",
      "auction",
      "supplier_name"
    ]);
    if (criee) splitMulti(criee).forEach((v) => crieeTokens.push(v));

    const decongele = extractTraceabilityValue(lot, [
      "decongele",
      "defrosted"
    ]);

    if (
      decongele === true ||
      String(decongele).toLowerCase() === "true" ||
      String(decongele).toLowerCase() === "oui"
    ) {
      decongeleTokens.push("Oui");
    }
  }

  const nomLatin = uniqueClean(nomLatinTokens).map(normalizeLatin).join(", ");
  const zonePeche = uniqueClean(faoTokens).map(normalizeFAO).join(", ");
  const enginPeche = uniqueClean(enginTokens).map(normalizeEngin).filter(Boolean).join(", ");
  const allergenes = uniqueClean(allergenesTokens).join(", ");
  const methodeProd = uniqueClean(methodeTokens).map(normalizeMethod).join(", ");
  const criee = uniqueClean(crieeTokens).join(", ");

  return {
    type: "TRAD",
    criee,
    designation,
    nom_latin: nomLatin,
    methode_prod: methodeProd,
    zone_peche: zonePeche,
    engin_peche: enginPeche,
    decongele: decongeleTokens.includes("Oui") ? "Oui" : "",
    allergenes,
    prix: Number(pricing?.pv_ttc_real || 0),
    unite: "€/kg"
  };
}

/* =========================================================
   Signature export
========================================================= */

function buildSignature(info) {
  return [
    alphaKey(info.designation),
    alphaKey(info.nom_latin),
    alphaKey(info.methode_prod),
    alphaKey(info.zone_peche),
    alphaKey(info.engin_peche),
    alphaKey(info.decongele),
    alphaKey(info.allergenes),
    Number(info.prix || 0).toFixed(2),
    alphaKey(info.unite)
  ].join("|");
}

/* =========================================================
   GET /api/labels/export-evolis
========================================================= */

router.get("/export-evolis", authenticateToken, attachDbContext, async (req, res) => {
  const client = await req.dbPool.connect();

  try {
    const storeId = req.user.store_id;
    const departmentId = req.query.department_id;

    if (!storeId) {
      return res.status(400).json({ error: "store_id introuvable dans la session" });
    }

    if (!departmentId) {
      return res.status(400).json({ error: "department_id requis" });
    }

    const stockResult = await client.query(
      `
      SELECT
        ss.article_id,
        ss.stock_quantity,

        ds.code AS sector_code,
        ds.name AS sector_name,

        to_jsonb(a) AS article_data,
        to_jsonb(ad) AS article_department_data,
        to_jsonb(adm) AS metadata_data,
        to_jsonb(sap) AS pricing_data

      FROM stock_summary ss

      JOIN articles a
        ON a.id = ss.article_id

      LEFT JOIN article_departments ad
        ON ad.article_id = a.id
       AND ad.department_id = ss.department_id

      LEFT JOIN department_sectors ds
        ON ds.id = ad.department_sector_id

      LEFT JOIN article_department_metadata adm
        ON adm.article_department_id = ad.id
       AND adm.field_key = 'v2_import'

      LEFT JOIN stock_article_pricing sap
        ON sap.article_id = ss.article_id
       AND sap.department_id = ss.department_id
       AND sap.store_id = ss.store_id

      WHERE ss.store_id = $1
        AND ss.department_id = $2
        AND ss.stock_quantity > 0
        AND UPPER(COALESCE(ds.code, '')) = 'TRAD'

      ORDER BY
        a.designation ASC,
        a.plu ASC
      `,
      [storeId, departmentId]
    );

    const entries = [];

    for (const stockRow of stockResult.rows) {
      const article = stockRow.article_data || {};
      const articleDepartment = stockRow.article_department_data || {};
      const metadata = stockRow.metadata_data || {};
      const pricing = stockRow.pricing_data || {};

      const plu = clean(
        firstValue(
          article.plu,
          article.PLU,
          metadata.plu,
          metadata.PLU
        )
      );

      if (!plu) continue;

      const lotsResult = await client.query(
        `
        SELECT to_jsonb(l) AS lot_data
        FROM lots l
        WHERE l.store_id = $1
          AND l.department_id = $2
          AND l.article_id = $3
          AND COALESCE(l.qty_remaining, 0) > 0
        ORDER BY
          l.created_at ASC,
          l.id ASC
        `,
        [storeId, departmentId, stockRow.article_id]
      );

      const lots = lotsResult.rows.map((row) => row.lot_data || {});

      if (!lots.length) continue;

      const info = buildLabelInfo({
        article,
        articleDepartment,
        metadata,
        lots,
        pricing
      });

      const signature = buildSignature(info);

      const previousSnapshot = await client.query(
        `
        SELECT signature
        FROM label_export_snapshots
        WHERE store_id = $1
          AND department_id = $2
          AND plu = $3
        `,
        [storeId, departmentId, plu]
      );

      const reprintMark =
        previousSnapshot.rows.length === 0 ||
        previousSnapshot.rows[0].signature !== signature
          ? "X"
          : "";

      entries.push({
        articleId: stockRow.article_id,
        plu,
        info,
        signature,
        reprintMark
      });
    }

    entries.sort((a, b) => {
      return clean(a.info.designation || a.plu).localeCompare(
        clean(b.info.designation || b.plu),
        "fr",
        { sensitivity: "base" }
      );
    });

    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet("_Etiquettes");

    ws.addRow([
      "type",
      "criee",
      "",
      "PLU",
      "designation",
      "Nom scientif",
      "Méthode Prod",
      "Zone Pêche",
      "Engin Pêche",
      "Décongelé",
      "Allergènes",
      "Prix",
      "€/kg ou Pièce"
    ]);

    for (const entry of entries) {
      const { plu, info, reprintMark } = entry;

      ws.addRow([
        info.type,
        info.criee,
        reprintMark,
        plu,
        info.designation,
        info.nom_latin,
        info.methode_prod,
        info.zone_peche,
        info.engin_peche,
        info.decongele === "Oui" ? "Oui" : "",
        info.allergenes,
        Number(info.prix || 0),
        info.unite
      ]);
    }

    for (const entry of entries) {
      const { articleId, plu, info, signature } = entry;

      await client.query(
        `
        INSERT INTO label_export_snapshots (
          store_id,
          department_id,
          article_id,
          plu,
          signature,
          designation,
          nom_latin,
          methode_prod,
          zone_peche,
          engin_peche,
          decongele,
          allergenes,
          prix,
          unite,
          updated_at
        )
        VALUES (
          $1,$2,$3,$4,$5,
          $6,$7,$8,$9,$10,
          $11,$12,$13,$14,
          NOW()
        )
        ON CONFLICT (store_id, department_id, plu)
        DO UPDATE SET
          article_id = EXCLUDED.article_id,
          signature = EXCLUDED.signature,
          designation = EXCLUDED.designation,
          nom_latin = EXCLUDED.nom_latin,
          methode_prod = EXCLUDED.methode_prod,
          zone_peche = EXCLUDED.zone_peche,
          engin_peche = EXCLUDED.engin_peche,
          decongele = EXCLUDED.decongele,
          allergenes = EXCLUDED.allergenes,
          prix = EXCLUDED.prix,
          unite = EXCLUDED.unite,
          updated_at = NOW()
        `,
        [
          storeId,
          departmentId,
          articleId,
          plu,
          signature,
          info.designation,
          info.nom_latin,
          info.methode_prod,
          info.zone_peche,
          info.engin_peche,
          info.decongele,
          info.allergenes,
          Number(info.prix || 0),
          info.unite
        ]
      );
    }

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      'attachment; filename="etiquettes_evolis.xlsx"'
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("❌ export labels:", error);

    if (!res.headersSent) {
      res.status(500).json({
        error: "Erreur export étiquettes",
        detail: error.message
      });
    }
  } finally {
    client.release();
  }
});

module.exports = router;
