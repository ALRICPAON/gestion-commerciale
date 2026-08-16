const ARTICLE_CATEGORIES = Object.freeze(['product', 'packaging']);

const ARTICLE_CATEGORY_LABELS = Object.freeze({
  product: 'Produit',
  packaging: 'Emballage',
});

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeArticleCategory(value, fallback = 'product') {
  const raw = clean(value);
  if (!raw) return fallback;
  const normalized = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_\s-]+/g, '_');
  if (['product', 'produit', 'products', 'produits'].includes(normalized)) return 'product';
  if (['packaging', 'emballage', 'emballages', 'package'].includes(normalized)) return 'packaging';
  return fallback;
}

function assertArticleCategory(value) {
  const raw = clean(value);
  if (!raw) return 'product';
  const normalized = normalizeArticleCategory(raw, null);
  if (ARTICLE_CATEGORIES.includes(normalized)) return normalized;
  const error = new Error('Catégorie article invalide');
  error.status = 400;
  error.expose = true;
  throw error;
}

function articleCategoryLabel(value) {
  return ARTICLE_CATEGORY_LABELS[normalizeArticleCategory(value)] || ARTICLE_CATEGORY_LABELS.product;
}

function categoryFilterSql(alias = 'a', placeholder) {
  return `COALESCE(${alias}.article_category, 'product') = ${placeholder}`;
}

module.exports = {
  ARTICLE_CATEGORIES,
  ARTICLE_CATEGORY_LABELS,
  articleCategoryLabel,
  assertArticleCategory,
  categoryFilterSql,
  normalizeArticleCategory,
};
