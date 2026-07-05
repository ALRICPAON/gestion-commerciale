async function createQualityPdfDocument({
  title = 'Qualité',
  subtitle = '',
  template = 'quality-foundation',
  context = {},
  sections = [],
} = {}) {
  return {
    ready: false,
    title,
    subtitle,
    template,
    context,
    sections,
    generated_at: new Date().toISOString(),
    message: 'Générateur PDF Qualité prêt pour les futures PR métier.',
  };
}

module.exports = {
  createQualityPdfDocument,
};
