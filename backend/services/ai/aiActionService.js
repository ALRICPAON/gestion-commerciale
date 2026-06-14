const ALLOWED_ACTIONS = new Set(['customer_order_draft']);
const OPTIONAL_DB_ERROR_CODES = new Set(['42P01', '42703']);
const ARTICLE_MATCH_MIN_CONFIDENCE = 0.85;
const ARTICLE_MATCH_AMBIGUOUS_DELTA = 0.08;
const CLIENT_MATCH_MIN_CONFIDENCE = 0.72;
const CLIENT_MATCH_AMBIGUOUS_DELTA = 0.08;
const ARTICLE_STOP_WORDS = new Set([
  'de',
  'des',
  'du',
  'd',
  'la',
  'le',
  'les',
  'l',
  'un',
  'une',
  'kg',
  'kilo',
  'kilos',
  'piece',
  'pieces',
  'unite',
  'unites',
]);
const BLOCKING_SPECIES = new Set(['saumon', 'cabillaud', 'bar', 'daurade', 'sole', 'limande']);
const UNACCENT_UNAVAILABLE_CODES = new Set(['42883', '42P01']);

function clean(value) {
  const text = String(value || '').trim();
  return text || null;
}

function number(value, fallback = 0) {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeForArticleMatch(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeForArticleExact(value) {
  return normalizeText(value)
    .replace(/\s*\/\s*/g, '/')
    .replace(/[^a-z0-9/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeReference(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, '');
}

function singularizeToken(token) {
  if (token.length > 4 && token.endsWith('s')) {
    return token.slice(0, -1);
  }
  return token;
}

function articleCalibers(value) {
  return normalizeForArticleExact(value).match(/\b\d+\/\d+\b/g) || [];
}

function articleTokens(value) {
  return normalizeForArticleExact(value)
    .split(/\s+/)
    .map(singularizeToken)
    .filter((token) => token.length > 1 && !ARTICLE_STOP_WORDS.has(token));
}

function buildArticleSqlTokens(value) {
  const rawTokens = String(value || '')
    .split(/\s+/)
    .map((token) => token.replace(/[^\p{L}\p{N}/]/gu, '').trim())
    .filter((token) => token.length > 1);
  const normalizedRawTokens = rawTokens
    .map(normalizeForArticleExact)
    .filter((token) => token.length > 1);
  const caliberParts = articleCalibers(value).flatMap((caliber) => caliber.split('/'));

  return Array.from(new Set([
    ...rawTokens,
    ...normalizedRawTokens,
    ...articleTokens(value),
    ...caliberParts,
  ]))
    .filter((token) => token.length > 1 && !ARTICLE_STOP_WORDS.has(normalizeForArticleExact(token)))
    .slice(0, 16);
}

function formatQuantity(value, unit) {
  const quantity = Number(number(value).toFixed(3));
  return `${quantity} ${unit || 'unite'}`;
}

function buildClarificationError(message, details = {}) {
  const error = new Error(message);
  error.status = 400;
  error.expose = true;
  error.needs_clarification = true;
  error.details = details;

  console.info('[AI ACTION] needs clarification', {
    reason: details.reason || message,
    ...details.log,
  });

  return error;
}

function scoreTextMatch(search, value, options = {}) {
  const minTokenLength = options.minTokenLength || 2;
  const searchTokens = normalizeForArticleMatch(search)
    .split(/\s+/)
    .map(singularizeToken)
    .filter((token) => token.length >= minTokenLength);
  const valueTokens = normalizeForArticleMatch(value)
    .split(/\s+/)
    .map(singularizeToken)
    .filter((token) => token.length >= minTokenLength);

  if (searchTokens.length === 0 || valueTokens.length === 0) return 0;

  const searchPhrase = searchTokens.join(' ');
  const valuePhrase = valueTokens.join(' ');
  const valueTokenSet = new Set(valueTokens);
  const matchedTokens = searchTokens.filter((token) => valueTokenSet.has(token));
  const coverage = matchedTokens.length / searchTokens.length;

  if (valuePhrase === searchPhrase) return 1;
  if (valuePhrase.includes(searchPhrase)) return 0.95;
  if (searchPhrase.includes(valuePhrase)) return 0.9;
  if (coverage === 1) return 0.88;
  if (coverage > 0) return Number((coverage * 0.7).toFixed(2));

  return 0;
}

function scoreArticleTextMatch(search, value) {
  const searchLabel = normalizeForArticleExact(search);
  const valueLabel = normalizeForArticleExact(value);
  if (!searchLabel || !valueLabel) return 0;

  const searchCalibers = articleCalibers(searchLabel);
  const valueCalibers = articleCalibers(valueLabel);
  const hasMissingCaliber = searchCalibers.some((caliber) => !valueCalibers.includes(caliber));

  if (valueLabel === searchLabel) return 1;
  if (valueLabel.includes(searchLabel)) return hasMissingCaliber ? 0.4 : 0.97;
  if (searchLabel.includes(valueLabel)) return hasMissingCaliber ? 0.4 : 0.92;

  const searchTokens = articleTokens(searchLabel);
  const valueTokenSet = new Set(articleTokens(valueLabel));
  if (searchTokens.length === 0 || valueTokenSet.size === 0) return 0;

  const matchedTokens = searchTokens.filter((token) => valueTokenSet.has(token));
  const coverage = matchedTokens.length / searchTokens.length;
  if (hasMissingCaliber) return Number(Math.min(0.4, coverage * 0.4).toFixed(2));
  if (coverage === 1) return 0.9;
  if (coverage > 0) return Number((coverage * 0.78).toFixed(2));

  return 0;
}

function scoreReferenceMatch(search, value) {
  const normalizedSearch = normalizeReference(search);
  const normalizedValue = normalizeReference(value);
  if (!normalizedSearch || !normalizedValue) return 0;
  if (normalizedSearch === normalizedValue) return 1;
  if (normalizedSearch.includes(normalizedValue) || normalizedValue.includes(normalizedSearch)) return 0.94;
  return 0;
}

function detectSpecies(value) {
  const tokens = new Set(articleTokens(value));
  return Array.from(BLOCKING_SPECIES).filter((species) => tokens.has(species));
}

function hasSpeciesConflict(search, candidate) {
  const requestedSpecies = detectSpecies(search);
  if (requestedSpecies.length === 0) return false;

  const candidateSpecies = detectSpecies(candidate.designation);
  if (candidateSpecies.length === 0) return false;

  return candidateSpecies.some((species) => !requestedSpecies.includes(species));
}

function lastUserSegment(text) {
  const parts = String(text || '').split(/\nuser:\s*/i);
  return parts.length > 1 ? parts[parts.length - 1] : text;
}

function extractUnitPrice(text) {
  const match = String(text || '').match(/(?:\bon lui vend|\bvendu|\bprix|\ba|à)\s*(\d+(?:[,.]\d{1,2})?)(?:\s*(?:€|eur|euros))?/i);
  return match ? number(match[1]) : 0;
}

function extractCorrectionArticle(text) {
  const segment = lastUserSegment(text);
  const match = segment.match(/(?:c[' ]?est|ce sera|produit)\s+(.+?)(?:\s+et\s+on\s+lui\s+vend|\s+(?:a|à|prix|vendu)\s+\d|$)/i);
  return clean(match?.[1]);
}

function isNegoceRequest(text) {
  const segment = normalizeText(lastUserSegment(text));
  return segment.includes('pas en stock')
    || segment.includes('negoce')
    || segment.includes('a approvisionner')
    || segment.includes('precommande')
    || Boolean(extractCorrectionArticle(text))
    || extractUnitPrice(text) > 0;
}

function stripPricePhrases(value) {
  return clean(String(value || '')
    .replace(/\s+(?:et\s+)?on\s+lui\s+vend\s+\d+(?:[,.]\d{1,2})?.*$/i, '')
    .replace(/\s+(?:a|à|prix|vendu)\s+\d+(?:[,.]\d{1,2})?.*$/i, ''));
}

function parseCustomerOrderPrompt(prompt) {
  const text = clean(prompt) || '';
  const orderMatches = Array.from(text.matchAll(/\bpour\s+(.+?)\s+(?:avec|:)\s+(.+?)(?=\n(?:user|assistant):|$)/gi));
  const orderMatch = orderMatches[orderMatches.length - 1];
  const clientSearch = clean(orderMatch?.[1]);
  const itemsPart = clean(orderMatch?.[2]);
  const correctionArticle = extractCorrectionArticle(text);
  const unitPriceHt = extractUnitPrice(text);
  const allowNegoce = isNegoceRequest(text);

  if (!clientSearch || !itemsPart) {
    const error = new Error('Je n ai pas assez d elements pour preparer la commande brouillon.');
    error.status = 400;
    error.expose = true;
    error.needs_clarification = true;
    throw error;
  }

  const lines = itemsPart
    .split(/\s+et\s+|,|;/i)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const packageMatch = part.match(/(\d+(?:[,.]\d+)?)\s*x\s*(\d+(?:[,.]\d+)?)\s*kg\s+(?:de\s+|d')?(.+)/i);
      if (packageMatch) {
        const packageCount = number(packageMatch[1]);
        const weightPerPackage = number(packageMatch[2]);
        return {
          quantity: Number((packageCount * weightPerPackage).toFixed(3)),
          package_count: packageCount,
          weight_per_package: weightPerPackage,
          unit: 'kg',
          article_search: correctionArticle || stripPricePhrases(packageMatch[3]),
          unit_sale_price_ht: unitPriceHt,
          allow_negoce: allowNegoce,
        };
      }

      const match = part.match(/(\d+(?:[,.]\d+)?)\s*(kg|kilo|kilos|piece|pieces|unite|unites)?\s+(?:de\s+|d')?(.+)/);
      if (!match) return null;
      return {
        quantity: number(match[1]),
        unit: ['piece', 'pieces', 'unite', 'unites'].includes(match[2]) ? 'unite' : 'kg',
        article_search: correctionArticle || stripPricePhrases(match[3]),
        unit_sale_price_ht: unitPriceHt,
        allow_negoce: allowNegoce,
      };
    })
    .filter((line) => line && line.quantity > 0 && line.article_search);

  if (lines.length === 0) {
    const error = new Error('Je n ai pas trouve de lignes produit exploitables pour cette commande.');
    error.status = 400;
    error.expose = true;
    throw error;
  }

  return {
    client_search: clientSearch,
    lines,
  };
}

async function findClient(db, storeId, search) {
  console.info('[AI ACTION] client requested', {
    store_id: storeId,
    requested: search,
  });

  const result = await db.query(`
    SELECT id, code, name, tariff_level, vat_rate, is_vat_exempt, city, email
    FROM clients
    WHERE store_id = $1
      AND COALESCE(status, 'active') <> 'inactive'
    ORDER BY name ASC
    LIMIT 200
  `, [storeId]);

  const candidates = result.rows
    .map((client) => ({
      ...client,
      confidence_score: Math.max(
        scoreTextMatch(search, client.name, { minTokenLength: 2 }),
        scoreTextMatch(search, client.code, { minTokenLength: 2 })
      ),
    }))
    .filter((client) => client.confidence_score > 0)
    .sort((a, b) => b.confidence_score - a.confidence_score || a.name.localeCompare(b.name));

  console.info('[AI ACTION] client matches', {
    store_id: storeId,
    requested: search,
    matches: candidates.slice(0, 8).map((client) => ({
      client_id: client.id,
      name: client.name,
      code: client.code,
      confidence_score: client.confidence_score,
    })),
  });

  const best = candidates[0] || null;
  if (!best || best.confidence_score < CLIENT_MATCH_MIN_CONFIDENCE) {
    throw buildClarificationError(
      `Client introuvable pour "${search}". Peux-tu preciser le client ?`,
      {
        reason: 'client_introuvable',
        requested: search,
        candidates: candidates.slice(0, 5),
        log: {
          store_id: storeId,
          requested: search,
          confidence_score: best?.confidence_score || 0,
        },
      }
    );
  }

  const ambiguousClients = candidates.filter(
    (client) => client.id !== best.id
      && best.confidence_score - client.confidence_score <= CLIENT_MATCH_AMBIGUOUS_DELTA
      && client.confidence_score >= CLIENT_MATCH_MIN_CONFIDENCE
  );
  if (ambiguousClients.length > 0) {
    const choices = [best, ...ambiguousClients]
      .slice(0, 5)
      .map((client, index) => `${index + 1}. ${client.name}${client.city ? ` - ${client.city}` : ''}`);
    throw buildClarificationError(
      [
        'J ai trouve plusieurs clients possibles :',
        ...choices,
        'Lequel veux-tu utiliser ?',
      ].join('\n'),
      {
        reason: 'client_ambigu',
        requested: search,
        candidates: [best, ...ambiguousClients].slice(0, 5),
        log: {
          store_id: storeId,
          requested: search,
          candidates: [best, ...ambiguousClients].length,
        },
      }
    );
  }

  console.info('[AI ACTION] selected client', {
    store_id: storeId,
    requested: search,
    client_id: best.id,
    name: best.name,
    confidence_score: best.confidence_score,
  });

  return best;
}

function scoreArticleCandidate(search, candidate) {
  if (hasSpeciesConflict(search, candidate)) return 0;

  const scores = {
    designation: scoreArticleTextMatch(search, candidate.designation),
    display_name: scoreArticleTextMatch(search, candidate.display_name),
    plu: scoreReferenceMatch(search, candidate.plu),
    ean: scoreReferenceMatch(search, candidate.ean),
    id: scoreReferenceMatch(search, candidate.id),
  };
  const baseScore = Math.max(...Object.values(scores));
  if (baseScore === 0) return 0;
  if (baseScore === 1) return 1;

  const historyBonus = number(candidate.client_history_count) > 0 ? 0.03 : 0;

  return Number(Math.min(1, baseScore + historyBonus).toFixed(2));
}

function formatArticleChoice(candidate, index) {
  const parts = [
    `${index + 1}. ${candidate.designation}`,
    candidate.plu ? `PLU ${candidate.plu}` : null,
    `stock ${formatQuantity(candidate.stock_quantity, candidate.sale_unit || candidate.unit)}`,
  ].filter(Boolean);

  if (number(candidate.client_history_count) > 0) {
    parts.push('deja achete par ce client');
  }

  return parts.join(' - ');
}

function buildArticleClarificationError(search, candidates, reason, details = {}) {
  const lines = candidates
    .slice(0, 5)
    .map((candidate, index) => formatArticleChoice(candidate, index));
  const message = lines.length > 0
    ? [
        reason,
        ...lines,
        'Lequel veux-tu utiliser ?',
      ]
    : [
        reason,
        'Peux-tu preciser l article exact ?',
      ];
  return buildClarificationError(message.join('\n'), {
    reason: details.reason || 'article_a_preciser',
    requested: search,
    candidates: candidates.slice(0, 5),
    log: details.log,
  });
}

function articleLookupLogRows(rows) {
  return rows.slice(0, 12).map((candidate) => ({
    article_id: candidate.id,
    plu: candidate.plu,
    ean: candidate.ean,
    designation: candidate.designation,
    display_name: candidate.display_name,
    confidence_score: candidate.confidence_score,
    normalized_designation: normalizeForArticleExact(candidate.designation),
    normalized_display_name: normalizeForArticleExact(candidate.display_name),
    stock_quantity: number(candidate.stock_quantity),
    has_stock_summary: Boolean(candidate.has_stock_summary),
    client_history_count: number(candidate.client_history_count),
  }));
}

function articleNormalizeSql(expression, useUnaccent) {
  const lowered = `LOWER(COALESCE(${expression}, ''))`;
  const text = useUnaccent ? `unaccent(${lowered})` : lowered;
  return `trim(regexp_replace(regexp_replace(regexp_replace(${text}, '\\s*/\\s*', '/', 'g'), '[^a-z0-9/]+', ' ', 'g'), '\\s+', ' ', 'g'))`;
}

function buildArticleLookup({ storeId, client, search, sqlTokens, referenceToken, normalizedSearch, useUnaccent, broadFallback = false }) {
  const params = [storeId, client?.id || null];
  const whereParts = [];

  if (!broadFallback) {
    if (normalizedSearch) {
      params.push(normalizedSearch);
      whereParts.push(`${articleNormalizeSql('a.designation', useUnaccent)} = $${params.length}`);
      whereParts.push(`${articleNormalizeSql('a.display_name', useUnaccent)} = $${params.length}`);
    }

    sqlTokens.forEach((token) => {
      params.push(`%${token}%`);
      whereParts.push(`a.designation ILIKE $${params.length}`);
      whereParts.push(`COALESCE(a.display_name, '') ILIKE $${params.length}`);
      whereParts.push(`COALESCE(a.plu, '') ILIKE $${params.length}`);
      whereParts.push(`COALESCE(a.ean, '') ILIKE $${params.length}`);
    });

    if (referenceToken) {
      params.push(referenceToken);
      whereParts.push(`regexp_replace(LOWER(COALESCE(a.plu, '')), '[^a-z0-9]', '', 'g') = $${params.length}`);
      whereParts.push(`regexp_replace(LOWER(COALESCE(a.ean, '')), '[^a-z0-9]', '', 'g') = $${params.length}`);
      whereParts.push(`regexp_replace(LOWER(a.id::text), '[^a-z0-9]', '', 'g') = $${params.length}`);
    }
  }

  const existenceFilter = broadFallback || whereParts.length === 0 ? 'TRUE' : `(${whereParts.join(' OR ')})`;
  const lookupQuery = `
    SELECT
      a.id,
      a.plu,
      a.ean,
      a.designation,
      a.display_name,
      a.unit,
      a.sale_unit,
      a.vat_rate,
      a.sale_price_ex_vat,
      a.sale_price_level_1_ht,
      a.sale_price_level_2_ht,
      a.sale_price_level_3_ht,
      COALESCE(ss.stock_quantity, 0) AS stock_quantity,
      (ss.article_id IS NOT NULL) AS has_stock_summary,
      ss.next_dlc,
      COALESCE(ss.pma, 0) AS pma,
      COUNT(sd.id)::int AS client_history_count,
      MAX(sd.document_date) AS last_client_sale_date
    FROM articles a
    LEFT JOIN stock_summary ss ON ss.article_id = a.id AND ss.store_id = a.store_id
    LEFT JOIN sales_lines sl ON sl.article_id = a.id AND sl.store_id = a.store_id
    LEFT JOIN sales_documents sd
      ON sd.id = sl.sales_document_id
     AND sd.store_id = sl.store_id
     AND sd.client_id = $2
     AND sd.document_date >= CURRENT_DATE - INTERVAL '365 days'
     AND COALESCE(sd.status, '') NOT IN ('draft', 'cancelled')
    WHERE a.store_id = $1
      AND COALESCE(a.is_active, true) = true
      AND ${existenceFilter}
    GROUP BY
      a.id,
      a.plu,
      a.ean,
      a.designation,
      a.display_name,
      a.unit,
      a.sale_unit,
      a.vat_rate,
      a.sale_price_ex_vat,
      a.sale_price_level_1_ht,
      a.sale_price_level_2_ht,
      a.sale_price_level_3_ht,
      ss.article_id,
      ss.stock_quantity,
      ss.next_dlc,
      ss.pma
    ORDER BY a.designation ASC
    LIMIT ${broadFallback ? 500 : 80}
  `;

  return { lookupQuery, params, whereParts };
}

async function queryArticleCandidates(db, buildOptions) {
  try {
    const lookup = buildArticleLookup({ ...buildOptions, useUnaccent: true });
    const result = await db.query(lookup.lookupQuery, lookup.params);
    return { ...lookup, result, usedUnaccent: true, broadFallback: false };
  } catch (error) {
    if (!UNACCENT_UNAVAILABLE_CODES.has(error.code)) throw error;

    console.info('[AI ACTION] article lookup unaccent unavailable', {
      store_id: buildOptions.storeId,
      requested: buildOptions.search,
      code: error.code,
      fallback: 'js_normalization',
    });
  }

  const fallbackLookup = buildArticleLookup({ ...buildOptions, useUnaccent: false });
  let result = await db.query(fallbackLookup.lookupQuery, fallbackLookup.params);
  if (result.rows.length > 0) {
    return { ...fallbackLookup, result, usedUnaccent: false, broadFallback: false };
  }

  const broadLookup = buildArticleLookup({ ...buildOptions, useUnaccent: false, broadFallback: true });
  result = await db.query(broadLookup.lookupQuery, broadLookup.params);
  return { ...broadLookup, result, usedUnaccent: false, broadFallback: true };
}

async function findArticle(db, storeId, client, search, options = {}) {
  const requestedTokens = articleTokens(search).slice(0, 8);
  const referenceToken = normalizeReference(search);
  const normalizedSearch = normalizeForArticleExact(search);
  const sqlTokens = buildArticleSqlTokens(search);

  console.info('[AI ACTION] article requested', {
    store_id: storeId,
    client_id: client?.id || null,
    requested: search,
    normalized_search: normalizedSearch,
    requested_tokens: requestedTokens,
    calibers: articleCalibers(search),
  });
  console.info('[AI ACTION] article lookup source', {
    source: 'articles',
    base_table: 'articles a',
    enrichment_tables: ['stock_summary ss', 'sales_lines sl', 'sales_documents sd'],
    stock_role: 'availability_only',
    existence_rule: 'articles.store_id + active article match on normalized designation/display_name/plu/ean/id',
  });

  if (requestedTokens.length === 0 && sqlTokens.length === 0 && !referenceToken) {
    throw buildArticleClarificationError(
      search,
      [],
      'Quantite ou article manquant dans la demande.',
      {
        reason: 'article_manquant',
        log: { store_id: storeId, client_id: client?.id || null },
      }
    );
  }

  const lookup = await queryArticleCandidates(db, {
    storeId,
    client,
    search,
    sqlTokens,
    referenceToken,
    normalizedSearch,
  });

  console.info('[AI ACTION] article lookup query', {
    store_id: storeId,
    client_id: client?.id || null,
    requested: search,
    normalized_search: normalizedSearch,
    search_modes: ['normalized_exact_designation', 'normalized_exact_display_name', 'designation', 'plu', 'ean', 'display_name', 'article_id'],
    sql_tokens: sqlTokens,
    reference_token: referenceToken || null,
    used_unaccent: lookup.usedUnaccent,
    broad_fallback: lookup.broadFallback,
    where_parts: lookup.whereParts,
    sql: lookup.lookupQuery.replace(/\s+/g, ' ').trim(),
  });

  const rawCandidates = lookup.result.rows.map((candidate) => ({
    ...candidate,
    confidence_score: scoreArticleCandidate(search, candidate),
  }));
  const candidates = rawCandidates
    .filter((candidate) => candidate.confidence_score > 0)
    .sort((a, b) => {
      const confidenceDelta = b.confidence_score - a.confidence_score;
      if (confidenceDelta !== 0) return confidenceDelta;
      const historyDelta = number(b.client_history_count) - number(a.client_history_count);
      if (historyDelta !== 0) return historyDelta;
      return a.designation.localeCompare(b.designation);
    });
  const stockCandidates = candidates.filter((candidate) => number(candidate.stock_quantity) > 0);
  const historyCandidates = candidates.filter((candidate) => number(candidate.client_history_count) > 0);

  console.info('[AI ACTION] article lookup results', {
    store_id: storeId,
    client_id: client?.id || null,
    requested: search,
    normalized_search: normalizedSearch,
    raw_count: lookup.result.rows.length,
    scored_count: candidates.length,
    used_unaccent: lookup.usedUnaccent,
    broad_fallback: lookup.broadFallback,
    results: articleLookupLogRows(candidates),
  });
  console.info('[AI ACTION] article matches', {
    store_id: storeId,
    client_id: client?.id || null,
    requested: search,
    matches: candidates.map((candidate) => ({
      article_id: candidate.id,
      plu: candidate.plu,
      designation: candidate.designation,
      normalized_designation: normalizeForArticleExact(candidate.designation),
      confidence_score: candidate.confidence_score,
      stock_quantity: number(candidate.stock_quantity),
      client_history_count: number(candidate.client_history_count),
    })),
  });
  console.info('[AI ACTION] stock candidates', {
    store_id: storeId,
    client_id: client?.id || null,
    requested: search,
    candidates: stockCandidates.slice(0, 8).map((candidate) => ({
      article_id: candidate.id,
      plu: candidate.plu,
      designation: candidate.designation,
      stock_quantity: number(candidate.stock_quantity),
      confidence_score: candidate.confidence_score,
    })),
  });
  console.info('[AI ACTION] history candidates', {
    store_id: storeId,
    client_id: client?.id || null,
    requested: search,
    candidates: historyCandidates.slice(0, 8).map((candidate) => ({
      article_id: candidate.id,
      plu: candidate.plu,
      designation: candidate.designation,
      client_history_count: number(candidate.client_history_count),
      confidence_score: candidate.confidence_score,
    })),
  });

  const best = candidates[0] || null;
  console.info('[AI ACTION] confidence score', {
    store_id: storeId,
    client_id: client?.id || null,
    requested: search,
    confidence_score: best?.confidence_score || 0,
    min_confidence: ARTICLE_MATCH_MIN_CONFIDENCE,
  });

  if (!best || best.confidence_score < ARTICLE_MATCH_MIN_CONFIDENCE) {
    if (options.allow_negoce) {
      console.info('[AI ACTION] free/custom line candidate', {
        store_id: storeId,
        client_id: client?.id || null,
        requested: search,
        confidence_score: best?.confidence_score || 0,
      });
    }
    throw buildArticleClarificationError(
      search,
      candidates,
      options.allow_negoce
        ? `Cet article n existe pas encore clairement dans les articles : "${search}". Veux-tu creer l article d abord ?`
        : `Je n ai pas trouve d article correspondant clairement a "${search}".`,
      {
        reason: options.allow_negoce ? 'article_a_creer' : 'article_introuvable',
        log: {
          store_id: storeId,
          client_id: client?.id || null,
          confidence_score: best?.confidence_score || 0,
          raw_count: lookup.result.rows.length,
          scored_count: candidates.length,
        },
      }
    );
  }

  const highConfidenceCandidates = candidates.filter(
    (candidate) => candidate.confidence_score >= ARTICLE_MATCH_MIN_CONFIDENCE
  );
  const ambiguousCandidates = highConfidenceCandidates.filter(
    (candidate) => candidate.id !== best.id
      && best.confidence_score < 1
      && best.confidence_score - candidate.confidence_score <= ARTICLE_MATCH_AMBIGUOUS_DELTA
  );
  if (ambiguousCandidates.length > 0) {
    throw buildArticleClarificationError(
      search,
      [best, ...ambiguousCandidates],
      `J ai trouve plusieurs articles ${detectSpecies(search)[0] || 'possibles'} :`,
      {
        reason: 'article_ambigu',
        log: {
          store_id: storeId,
          client_id: client?.id || null,
          candidates: [best, ...ambiguousCandidates].length,
        },
      }
    );
  }

  if (number(best.stock_quantity) <= 0) {
    console.info('[AI ACTION] product out of stock', {
      store_id: storeId,
      client_id: client?.id || null,
      requested: search,
      article_id: best.id,
      plu: best.plu,
      designation: best.designation,
      stock_quantity: number(best.stock_quantity),
      has_stock_summary: Boolean(best.has_stock_summary),
    });

    if (options.allow_negoce && number(options.unit_sale_price_ht) > 0) {
      console.info('[AI ACTION] negoce mode detected', {
        store_id: storeId,
        client_id: client?.id || null,
        article_id: best.id,
        plu: best.plu,
        designation: best.designation,
        unit_sale_price_ht: number(options.unit_sale_price_ht),
      });

      return {
        ...best,
        negoce_mode: true,
        supply_status: 'a_approvisionner',
      };
    }

    throw buildArticleClarificationError(
      search,
      [best],
      options.allow_negoce
        ? `Je n ai pas de stock disponible sur "${best.designation}". Indique le prix de vente pour preparer une ligne negoce a approvisionner.`
        : `Je n ai pas de stock disponible sur "${best.designation}".`,
      {
        reason: options.allow_negoce ? 'prix_negoce_manquant' : 'article_sans_stock',
        log: {
          store_id: storeId,
          client_id: client?.id || null,
          article_id: best.id,
          plu: best.plu,
          stock_quantity: number(best.stock_quantity),
        },
      }
    );
  }

  console.info('[AI ACTION] selected article', {
    store_id: storeId,
    client_id: client?.id || null,
    requested: search,
    article_id: best.id,
    plu: best.plu,
    designation: best.designation,
    stock_quantity: number(best.stock_quantity),
    confidence_score: best.confidence_score,
  });

  return best;
}

function tariffLevel(client) {
  const level = Number(client?.tariff_level || 1);
  return [1, 2, 3].includes(level) ? level : 1;
}

function articlePrice(article, client) {
  const level = tariffLevel(client);
  return number(article?.[`sale_price_level_${level}_ht`], number(article?.sale_price_ex_vat, 0));
}

function buildLinePayload(line, article, client) {
  const quantity = number(line.quantity);
  const unitPriceHt = number(line.unit_sale_price_ht, articlePrice(article, client));
  const vatRate = client?.is_vat_exempt ? 0 : number(article?.vat_rate, number(client?.vat_rate, 5.5));
  const lineAmountHt = Number((quantity * unitPriceHt).toFixed(2));
  const lineVatAmount = Number((lineAmountHt * vatRate / 100).toFixed(2));
  const lineAmountTtc = Number((lineAmountHt + lineVatAmount).toFixed(2));
  const unitCost = number(article?.pma, 0);
  const isNegoce = Boolean(line.allow_negoce && article?.negoce_mode);
  const articleLabel = isNegoce
    ? `${article.designation} - NEGOCE A APPROVISIONNER`
    : article.designation;

  return {
    article_id: article.id,
    article_plu: article.plu,
    article_label: articleLabel,
    quantity,
    package_count: number(line.package_count),
    weight_per_package: number(line.weight_per_package),
    sale_unit: line.unit || article.sale_unit || article.unit || 'kg',
    unit_sale_price_ht: unitPriceHt,
    unit_sale_price_ttc: quantity > 0 ? Number((lineAmountTtc / quantity).toFixed(4)) : 0,
    vat_rate: vatRate,
    line_amount_ht: lineAmountHt,
    line_vat_amount: lineVatAmount,
    line_amount_ttc: lineAmountTtc,
    unit_cost_ex_vat: unitCost,
    line_margin_ex_vat: Number((lineAmountHt - quantity * unitCost).toFixed(2)),
    is_negoce: isNegoce,
    supply_status: isNegoce ? 'a_approvisionner' : 'stock',
  };
}

function buildSummary(client, lines) {
  const hasNegoce = lines.some((line) => line.is_negoce);
  if (hasNegoce) {
    return [
      `Je peux preparer une commande negoce a approvisionner pour ${client.name} :`,
      ...lines.map((line) => {
        const packageText = line.package_count > 0 && line.weight_per_package > 0
          ? `${line.package_count} colis x ${line.weight_per_package} kg = ${line.quantity} ${line.sale_unit}`
          : `${line.quantity} ${line.sale_unit}`;
        return [
          `- Produit : ${line.article_label}`,
          `  Quantite : ${packageText}`,
          `  Prix vente : ${line.unit_sale_price_ht.toFixed(2)} EUR/${line.sale_unit}`,
          `  Statut : a approvisionner`,
        ].join('\n');
      }),
      '',
      'Confirmer la creation de cette commande brouillon ?',
    ].join('\n');
  }

  return [
    `Je vais preparer une commande brouillon pour ${client.name} :`,
    ...lines.map((line) => `- ${line.article_label} : ${line.quantity} ${line.sale_unit}`),
    '',
    'Confirmer l action ?',
  ].join('\n');
}

async function prepareCustomerOrderAction({ db, user, prompt, payload }) {
  const storeId = user.store_id;
  const parsed = payload?.client_search && Array.isArray(payload?.lines)
    ? payload
    : parseCustomerOrderPrompt(prompt);

  const client = await findClient(db, storeId, parsed.client_search);
  if (!client) {
    const error = new Error('Client introuvable pour ce magasin.');
    error.status = 400;
    error.expose = true;
    throw error;
  }

  const lines = [];
  for (const rawLine of parsed.lines) {
    const article = await findArticle(db, storeId, client, rawLine.article_search, {
      allow_negoce: rawLine.allow_negoce,
      unit_sale_price_ht: rawLine.unit_sale_price_ht,
    });
    if (!article) {
      const error = new Error(`Article introuvable pour "${rawLine.article_search}".`);
      error.status = 400;
      error.expose = true;
      throw error;
    }
    const resolvedPrice = number(rawLine.unit_sale_price_ht, articlePrice(article, client));
    if (resolvedPrice <= 0) {
      throw buildClarificationError(
        `Prix manquant pour "${article.designation}". Je ne peux pas preparer une commande sans prix de vente.`,
        {
          reason: 'prix_manquant',
          requested: rawLine.article_search,
          log: {
            store_id: storeId,
            client_id: client.id,
            article_id: article.id,
          },
        }
      );
    }
    lines.push(buildLinePayload({ ...rawLine, unit_sale_price_ht: resolvedPrice }, article, client));
  }

  const actionPayload = {
    client,
    lines,
    source_prompt: clean(prompt),
    has_negoce_lines: lines.some((line) => line.is_negoce),
  };
  const summary = buildSummary(client, lines);

  const result = await db.query(`
    INSERT INTO ai_pending_actions (
      id, store_id, user_id, action_type, status, payload, created_at
    )
    VALUES (gen_random_uuid(), $1, $2, 'customer_order_draft', 'pending', $3::jsonb, NOW())
    RETURNING id, action_type, status, payload, created_at
  `, [storeId, user.id, JSON.stringify(actionPayload)]);

  console.info('[AI ACTION] pending action created', {
    store_id: storeId,
    user_id: user.id,
    action_id: result.rows[0].id,
    action_type: 'customer_order_draft',
    has_negoce_lines: actionPayload.has_negoce_lines,
  });

  return {
    id: result.rows[0].id,
    action_type: 'customer_order_draft',
    status: 'pending',
    summary,
    payload: actionPayload,
  };
}

async function executeCustomerOrderDraft(db, action, user) {
  const payload = action.payload || {};
  const client = payload.client;
  const lines = Array.isArray(payload.lines) ? payload.lines : [];

  if (!client?.id || lines.length === 0) {
    throw new Error('Action IA incomplete : client ou lignes manquants.');
  }

  const clientCheck = await db.query(`
    SELECT id, name, tariff_level, vat_rate, is_vat_exempt
    FROM clients
    WHERE id = $1 AND store_id = $2 AND COALESCE(status, 'active') <> 'inactive'
    LIMIT 1
  `, [client.id, user.store_id]);
  if (!clientCheck.rows.length) {
    throw new Error('Client introuvable pour ce magasin.');
  }

  const sale = await db.query(`
    INSERT INTO sales_documents (
      id, store_id, client_key, client_id, document_date, status, document_type,
      origin, reference_number, notes, tariff_level_snapshot, vat_rate_snapshot,
      is_vat_exempt_snapshot, created_by, updated_by
    )
    VALUES (
      gen_random_uuid(), $1, $2, $3, CURRENT_DATE, 'draft', 'ORDER',
      'ai_confirmed_action', NULL, $4, $5, $6, $7, $8, $8
    )
    RETURNING *
  `, [
    user.store_id,
    user.client_key || null,
    client.id,
    payload.has_negoce_lines
      ? `Commande brouillon preparee par ALTA - action IA ${action.id} - negoce a approvisionner, sans lot alloue, sans destockage`
      : `Commande brouillon preparee par ALTA - action IA ${action.id}`,
    tariffLevel(clientCheck.rows[0]),
    number(clientCheck.rows[0].vat_rate, 5.5),
    Boolean(clientCheck.rows[0].is_vat_exempt),
    user.id,
  ]);

  const saleId = sale.rows[0].id;
  const createdLines = [];
  let lineNumber = 1;

  for (const line of lines) {
    const articleCheck = await db.query(`
      SELECT id, plu, designation
      FROM articles
      WHERE id = $1 AND store_id = $2 AND COALESCE(is_active, true) = true
      LIMIT 1
    `, [line.article_id, user.store_id]);
    if (!articleCheck.rows.length) {
      throw new Error(`Article introuvable pour la ligne ${lineNumber}.`);
    }

    const inserted = await db.query(`
      INSERT INTO sales_lines (
        id, store_id, client_key, sales_document_id, line_number, article_id,
        article_plu, article_label, package_count, weight_per_package, total_weight, sold_quantity, sale_unit,
        line_status, unit_sale_price_ht, unit_sale_price_ttc, vat_rate,
        line_amount_ht, line_vat_amount, line_amount_ttc, unit_cost_ex_vat,
        line_margin_ex_vat, created_by, updated_by
      )
      VALUES (
        gen_random_uuid(), $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10, $10, $11,
        'pending', $12, $13, $14,
        $15, $16, $17, $18,
        $19, $20, $20
      )
      RETURNING id, article_label, sold_quantity, sale_unit, line_amount_ht
    `, [
      user.store_id,
      user.client_key || null,
      saleId,
      lineNumber,
      line.article_id,
      line.article_plu || null,
      line.article_label,
      number(line.package_count),
      number(line.weight_per_package),
      number(line.quantity),
      line.sale_unit || 'kg',
      number(line.unit_sale_price_ht),
      number(line.unit_sale_price_ttc),
      number(line.vat_rate, 5.5),
      number(line.line_amount_ht),
      number(line.line_vat_amount),
      number(line.line_amount_ttc),
      number(line.unit_cost_ex_vat),
      number(line.line_margin_ex_vat),
      user.id,
    ]);
    createdLines.push(inserted.rows[0]);
    lineNumber += 1;
  }

  await db.query(`
    UPDATE sales_documents sd
    SET total_amount_ex_vat = COALESCE(x.ht, 0),
        total_vat_amount = COALESCE(x.vat, 0),
        total_amount_inc_vat = COALESCE(x.ttc, 0),
        updated_at = NOW(),
        updated_by = $2
    FROM (
      SELECT
        COALESCE(SUM(line_amount_ht), 0) AS ht,
        COALESCE(SUM(line_vat_amount), 0) AS vat,
        COALESCE(SUM(line_amount_ttc), 0) AS ttc
      FROM sales_lines
      WHERE sales_document_id = $1
    ) x
    WHERE sd.id = $1 AND sd.store_id = $3
  `, [saleId, user.id, user.store_id]);

  return {
    sale_id: saleId,
    document_type: 'ORDER',
    status: 'draft',
    client: {
      id: client.id,
      name: client.name,
    },
    lines: createdLines,
  };
}

async function confirmAction({ dbPool, user, actionId }) {
  const db = await dbPool.connect();
  try {
    await db.query('BEGIN');
    const actionResult = await db.query(`
      SELECT *
      FROM ai_pending_actions
      WHERE id = $1 AND store_id = $2 AND user_id = $3
      FOR UPDATE
    `, [actionId, user.store_id, user.id]);

    if (!actionResult.rows.length) {
      const error = new Error('Action IA introuvable.');
      error.status = 404;
      error.expose = true;
      throw error;
    }

    const action = actionResult.rows[0];
    if (action.status !== 'pending') {
      const error = new Error(`Action IA deja traitee avec le statut ${action.status}.`);
      error.status = 400;
      error.expose = true;
      throw error;
    }

    if (!ALLOWED_ACTIONS.has(action.action_type)) {
      throw new Error(`Action IA non autorisee : ${action.action_type}`);
    }

    await db.query(`
      UPDATE ai_pending_actions
      SET status = 'confirmed', confirmed_at = NOW()
      WHERE id = $1 AND store_id = $2
    `, [actionId, user.store_id]);

    const result = action.action_type === 'customer_order_draft'
      ? await executeCustomerOrderDraft(db, action, user)
      : null;

    await db.query(`
      UPDATE ai_pending_actions
      SET status = 'executed', result = $3::jsonb, executed_at = NOW()
      WHERE id = $1 AND store_id = $2
      RETURNING id, action_type, status, result, executed_at
    `, [actionId, user.store_id, JSON.stringify(result)]);

    await db.query('COMMIT');
    return {
      ok: true,
      action_id: actionId,
      status: 'executed',
      result,
    };
  } catch (error) {
    await db.query('ROLLBACK');
    if (error.status) throw error;

    try {
      await dbPool.query(`
        UPDATE ai_pending_actions
        SET status = 'failed', result = $3::jsonb
        WHERE id = $1 AND store_id = $2 AND status IN ('pending', 'confirmed')
      `, [actionId, user.store_id, JSON.stringify({ error: error.message })]);
    } catch (logError) {
      console.error('Erreur log echec action IA :', logError.message);
    }

    throw error;
  } finally {
    db.release();
  }
}

async function cancelAction({ db, user, actionId }) {
  const result = await db.query(`
    UPDATE ai_pending_actions
    SET status = 'cancelled', cancelled_at = NOW()
    WHERE id = $1
      AND store_id = $2
      AND user_id = $3
      AND status = 'pending'
    RETURNING id, action_type, status, cancelled_at
  `, [actionId, user.store_id, user.id]);

  if (!result.rows.length) {
    const error = new Error('Action IA introuvable ou deja traitee.');
    error.status = 404;
    error.expose = true;
    throw error;
  }

  return {
    ok: true,
    action: result.rows[0],
  };
}

function isMissingActionTable(error) {
  return OPTIONAL_DB_ERROR_CODES.has(error.code);
}

module.exports = {
  prepareCustomerOrderAction,
  confirmAction,
  cancelAction,
  isMissingActionTable,
};
