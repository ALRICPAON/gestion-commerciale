module.exports = {
  id: "PLU_PRESENT",
  label: "PLU présent",
  supportedExtensions: [".xlsx", ".xls", ".csv"],

  detect(context) {
    const rows = Array.isArray(context.previewRows) ? context.previewRows.flat().join(" ").toLowerCase() : "";
    let score = 0;
    if (rows.includes("plu")) score += 50;
    if (rows.includes("designation")) score += 20;
    return score;
  },

  async parse() {
    return {
      supplier_code: "PLU_PRESENT",
      supplier_name: "PLU présent",
      purchase_type: "direct_bl",
      document_type: "supplier_bl",
      lines: [],
      warnings: ["Parser PLU présent non branché"],
      meta: {},
    };
  },
};