const { getOpenAIClient } = require("../ai/aiClient");

const DEFAULT_MAX_PAGES = 2;
const DEFAULT_SCALE = 2.4;

function stripCodeFences(raw) {
  return String(raw || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function normalizeOcrPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return {
      text: "",
      warnings: ["OCR SOGELMER: reponse JSON invalide"],
      raw_lines: [],
      document_totals: null,
    };
  }

  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  const textLines = [];
  const rawLines = [];

  if (payload.bl_number) textLines.push(`N BL ${payload.bl_number}`);
  if (payload.date) textLines.push(`DATE ${payload.date}`);

  for (const [index, line] of lines.entries()) {
    const values = [
      line.supplier_reference,
      line.designation,
      line.colis,
      line.poids_colis_kg,
      line.poids_total_kg,
      line.uv || "KG",
      line.supplier_lot_number,
      line.prix_kg,
      "EUR",
      line.montant_ht,
      "EUR",
    ].map((value) => String(value ?? "").trim());

    rawLines.push({
      index: index + 1,
      supplier_reference: values[0] || null,
      designation: values[1] || null,
      colis: values[2] || null,
      poids_colis_kg: values[3] || null,
      poids_total_kg: values[4] || null,
      uv: values[5] || null,
      supplier_lot_number: values[6] || null,
      prix_kg: values[7] || null,
      montant_ht: values[9] || null,
      source_text: values.join(" "),
    });

    if (values.some((value) => !value)) {
      textLines.push(`#OCR_INCOMPLETE ${values.join(" ")}`);
      continue;
    }

    textLines.push(values.join(" "));
  }

  const warnings = Array.isArray(payload.warnings)
    ? payload.warnings.map((warning) => String(warning || "").trim()).filter(Boolean)
    : [];

  return {
    text: textLines.join("\n"),
    warnings,
    raw_lines: rawLines,
    document_totals: payload.totals || payload.document_totals || null,
  };
}

async function renderPdfPagesToPngBase64(buffer, options = {}) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { createCanvas } = require("@napi-rs/canvas");

  const maxPages = Math.max(1, Number(options.maxPages || DEFAULT_MAX_PAGES));
  const scale = Number(options.scale || DEFAULT_SCALE);
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    useWorkerFetch: false,
    isEvalSupported: false,
  });
  const pdf = await loadingTask.promise;
  const pageCount = Math.min(pdf.numPages, maxPages);
  const images = [];

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");

    await page.render({ canvasContext: context, viewport }).promise;
    images.push({
      page: pageNumber,
      width: canvas.width,
      height: canvas.height,
      base64: canvas.toBuffer("image/png").toString("base64"),
    });
  }

  return images;
}

async function extractSogelmerTextFromImages(images, options = {}) {
  if (!images.length) {
    return {
      text: "",
      warnings: ["OCR SOGELMER: aucune page image generee"],
      raw_lines: [],
      document_totals: null,
    };
  }

  const client = options.openaiClient || getOpenAIClient();
  const model = process.env.SOGELMER_OCR_MODEL || process.env.OCR_MODEL || process.env.AI_MODEL || "gpt-4o-mini";

  const content = [
    {
      type: "text",
      text: [
        "Tu lis un BL fournisseur SOGELMER scanne pour ALTA MAREE.",
        "Retourne uniquement un JSON valide.",
        "N'invente jamais une donnee absente ou illisible.",
        "Si une ligne article est ambigue ou incomplete, mets-la dans warnings au lieu de la fabriquer.",
        "Schema JSON attendu:",
        '{"bl_number":"511-00081150","date":"02/09/2026","totals":{"colis":"26","poids_total_kg":"93,30","montant_ht":"930,12"},"lines":[{"supplier_reference":"FILJUL58","designation":"FILET JULIENNE 5/800 GR 3 KG","colis":"5","poids_colis_kg":"3,00","poids_total_kg":"15,00","uv":"KG","supplier_lot_number":"05050102501","prix_kg":"11,40","montant_ht":"171,00"}],"warnings":[]}',
        "Lis les colonnes article: reference, designation, colis, poids colis, poids total/quantite, UV, lot fournisseur, prix/kg, montant HT.",
        "Lis aussi les totaux imprimes du document: nombre total de colis, poids total, montant HT.",
      ].join("\n"),
    },
  ];

  images.forEach((image) => {
    content.push({
      type: "image_url",
      image_url: {
        url: `data:image/png;base64,${image.base64}`,
        detail: "high",
      },
    });
  });

  const completion = await client.chat.completions.create({
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "Tu es un OCR strict de documents fournisseurs. Tu extrais uniquement les donnees visibles.",
      },
      { role: "user", content },
    ],
  });

  const raw = completion.choices?.[0]?.message?.content || "";
  let payload = null;
  try {
    payload = JSON.parse(stripCodeFences(raw));
  } catch (error) {
    return {
      text: "",
      warnings: [`OCR SOGELMER: JSON illisible (${error.message})`],
      raw_lines: [],
      document_totals: null,
    };
  }

  return normalizeOcrPayload(payload);
}

async function extractScannedSogelmerPdfText(context, options = {}) {
  if (typeof context.sogelmerOcrText === "string") {
    return {
      text: context.sogelmerOcrText,
      warnings: [],
      raw_lines: [],
      document_totals: null,
      page_count: 0,
      provider: "test-injected",
    };
  }

  if (typeof context.sogelmerOcrExtractor === "function") {
    return context.sogelmerOcrExtractor(context);
  }

  if (!context.buffer) {
    return {
      text: "",
      warnings: ["OCR SOGELMER: buffer PDF manquant"],
      raw_lines: [],
      document_totals: null,
      page_count: 0,
      provider: "openai-vision",
    };
  }

  const images = await renderPdfPagesToPngBase64(context.buffer, options);
  const extracted = await extractSogelmerTextFromImages(images, options);
  return {
    text: extracted.text,
    warnings: extracted.warnings,
    raw_lines: extracted.raw_lines || [],
    document_totals: extracted.document_totals || null,
    page_count: images.length,
    provider: "openai-vision",
  };
}

module.exports = {
  extractScannedSogelmerPdfText,
  extractSogelmerTextFromImages,
  normalizeOcrPayload,
  renderPdfPagesToPngBase64,
};
