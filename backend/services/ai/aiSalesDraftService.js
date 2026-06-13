const { recommendSalesActions } = require('./aiRecommendationService');

const DRAFT_TYPES = {
  email: 'email',
  whatsapp: 'whatsapp',
  commercial_offer: 'commercial_offer',
};

const MAX_DRAFT_CLIENTS = 3;
const MAX_DRAFT_PRODUCTS = 5;

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function detectDraftTypes(question) {
  const text = normalizeText(question);
  const types = [];

  if (text.includes('email') || text.includes('mail')) {
    types.push(DRAFT_TYPES.email);
  }
  if (text.includes('whatsapp') || text.includes('message')) {
    types.push(DRAFT_TYPES.whatsapp);
  }
  if (text.includes('offre') || text.includes('proposition')) {
    types.push(DRAFT_TYPES.commercial_offer);
  }

  return types.length > 0 ? types : Object.values(DRAFT_TYPES);
}

function cleanProductName(product) {
  return String(product?.designation || product?.name || 'produit disponible').trim();
}

function uniqProducts(products) {
  const seen = new Set();
  return products.filter((product) => {
    const key = cleanProductName(product).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_DRAFT_PRODUCTS);
}

function joinProductNames(products) {
  const names = products.map(cleanProductName);
  if (names.length <= 1) return names[0] || 'produits disponibles';
  if (names.length === 2) return `${names[0]} et ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} et ${names[names.length - 1]}`;
}

function buildReason(product) {
  const reasons = Array.isArray(product.reasons) ? product.reasons : [];
  const businessReason = reasons.find((reason) => !String(reason).includes('client deja acheteur'));
  return businessReason || 'stock disponible';
}

function buildEmailDraft(client, products) {
  const lines = products.map((product) => `- ${cleanProductName(product)} : ${buildReason(product)}`);

  return {
    type: DRAFT_TYPES.email,
    label: 'Email commercial',
    client,
    subject: 'Disponibilites produits de la mer ALTA MAREE',
    body: [
      'Bonjour,',
      '',
      'Je dispose actuellement de plusieurs produits disponibles :',
      '',
      ...lines,
      '',
      "N'hesite pas a me contacter si cela peut t'interesser.",
      '',
      'Bien cordialement,',
      '',
      'Alric Paon',
      'President',
      'ALTA MAREE',
    ].join('\n'),
  };
}

function buildWhatsappDraft(client, products) {
  const productNames = joinProductNames(products).toLowerCase();

  return {
    type: DRAFT_TYPES.whatsapp,
    label: 'WhatsApp',
    client,
    message: [
      'Bonjour,',
      `J'ai actuellement ${productNames} disponibles.`,
      "Dis-moi si tu as un besoin aujourd'hui.",
      '',
      'Alric - ALTA MAREE',
    ].join('\n'),
  };
}

function buildOfferDraft(client, products, context) {
  return {
    type: DRAFT_TYPES.commercial_offer,
    label: 'Offre commerciale',
    client,
    text: [
      'Offre commerciale - ALTA MAREE',
      '',
      `Client cible : ${client.name || 'client a preciser'}`,
      `Contexte : ${context || 'proposition commerciale basee sur les disponibilites actuelles'}`,
      '',
      'Produits a proposer :',
      ...products.map((product, index) => `${index + 1}. ${cleanProductName(product)} - ${buildReason(product)}`),
      '',
      'Positionnement commercial : disponibilite immediate, selection de produits de la mer, proposition a confirmer manuellement.',
      '',
      'Important : brouillon uniquement, aucun envoi effectue.',
    ].join('\n'),
  };
}

function formatDraftForPrompt(draft) {
  if (draft.type === DRAFT_TYPES.email) {
    return [
      `### ${draft.label}`,
      `Client : ${draft.client.name || 'client a preciser'}`,
      `Objet : ${draft.subject}`,
      '',
      draft.body,
    ].join('\n');
  }

  if (draft.type === DRAFT_TYPES.whatsapp) {
    return [
      `### ${draft.label}`,
      `Client : ${draft.client.name || 'client a preciser'}`,
      '',
      draft.message,
    ].join('\n');
  }

  return [
    `### ${draft.label}`,
    draft.text,
  ].join('\n');
}

function buildDraftsFromRecommendations(recommendationResult, requestedTypes) {
  const data = recommendationResult?.data || {};
  const recommendations = Array.isArray(data.recommendations) ? data.recommendations : [];
  const productPriorities = Array.isArray(data.product_priorities) ? data.product_priorities : [];
  const context = data.summary?.strategy || data.summary?.message || 'recommandations commerciales ALTA';
  const targets = recommendations.slice(0, MAX_DRAFT_CLIENTS);
  const drafts = [];

  targets.forEach((recommendation) => {
    const products = uniqProducts(
      Array.isArray(recommendation.products) && recommendation.products.length > 0
        ? recommendation.products
        : productPriorities
    );
    if (products.length === 0) return;

    const client = recommendation.client || {};
    requestedTypes.forEach((type) => {
      if (type === DRAFT_TYPES.email) drafts.push(buildEmailDraft(client, products));
      if (type === DRAFT_TYPES.whatsapp) drafts.push(buildWhatsappDraft(client, products));
      if (type === DRAFT_TYPES.commercial_offer) drafts.push(buildOfferDraft(client, products, context));
    });
  });

  return drafts;
}

async function generateSalesDrafts(db, storeId, question) {
  console.info('[AI SALES DRAFTS] tool called', {
    store_id: storeId,
    tool: 'generate_sales_drafts',
  });

  const requestedTypes = detectDraftTypes(question);
  const recommendationResult = await recommendSalesActions(db, storeId);
  const drafts = recommendationResult.available
    ? buildDraftsFromRecommendations(recommendationResult, requestedTypes)
    : [];

  console.info('[AI SALES DRAFTS] drafts generated', {
    store_id: storeId,
    requested_types: requestedTypes,
    drafts: drafts.length,
  });

  return {
    name: 'generate_sales_drafts',
    available: drafts.length > 0,
    reason: drafts.length > 0 ? undefined : 'Pas assez de recommandations commerciales pour preparer un brouillon.',
    data: {
      draft_only: true,
      send_allowed: false,
      requested_types: requestedTypes,
      source_tool: 'recommend_sales_actions',
      recommendation_summary: recommendationResult.data?.summary || null,
      drafts,
      formatted_drafts: drafts.map(formatDraftForPrompt),
      warning: 'Brouillons uniquement : aucun email, WhatsApp, offre ou document commercial n a ete envoye ou enregistre.',
    },
  };
}

module.exports = {
  generateSalesDrafts,
};
