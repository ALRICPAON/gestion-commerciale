module.exports = {
  id: "GCCRUSTACES",
  label: "GC Crustacés",
  supportedExtensions: [".xlsx", ".xls", ".csv"],

  detect(context) {
    const name = context.originalnameLower || "";
    let score = 0;
    if (name.includes("crustace")) score += 50;
    if (name.includes("gcc")) score += 40;
    return score;
  },

  async parse() {
    return {
      supplier_code: "GCCRUSTACES",
      supplier_name: "GC Crustacés",
      purchase_type: "direct_bl",
      document_type: "supplier_bl",
      lines: [],
      warnings: ["Parser GC Crustacés non branché"],
      meta: {},
    };
  },
};