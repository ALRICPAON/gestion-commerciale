async function createQualityPdfDocument({ title = 'Qualité', subtitle = '', sections = [] } = {}) {
  return {
    ready: false,
    title,
    subtitle,
    sections,
    message: 'Générateur PDF Qualité prêt pour les futures PR métier.',
  };
}

module.exports = {
  createQualityPdfDocument,
};
