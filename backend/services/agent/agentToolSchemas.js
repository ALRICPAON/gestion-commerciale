const RISK_LEVELS = Object.freeze({
  READ: 0,
  LOW_REVERSIBLE_WRITE: 1,
  COMMITTING_ACTION: 2,
  CRITICAL_DESTRUCTIVE: 3,
});

const structuredToolOutputSchema = {
  type: 'object',
  required: ['ok', 'tool', 'domain', 'summary'],
  properties: {
    ok: { type: 'boolean' },
    tool: { type: 'string' },
    domain: { type: 'string' },
    summary: { type: 'string' },
    data: { type: 'object', additionalProperties: true },
    warnings: { type: 'array', items: { type: 'string' } },
    missing_information: { type: 'array', items: { type: 'string' } },
    source_freshness: {
      type: 'object',
      properties: {
        generated_at: { type: 'string' },
        last_sync_at: { type: ['string', 'null'] },
      },
      additionalProperties: true,
    },
    audit_id: { type: ['string', 'null'] },
  },
  additionalProperties: true,
};

const emptyInputSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
};

const searchInputSchema = {
  type: 'object',
  properties: {
    query: { type: 'string', maxLength: 200 },
    article_category: { type: 'string', enum: ['product', 'packaging'] },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
  },
  additionalProperties: false,
};

const periodInputSchema = {
  type: 'object',
  properties: {
    date_from: { type: 'string', maxLength: 10 },
    date_to: { type: 'string', maxLength: 10 },
    days: { type: 'integer', minimum: 1, maximum: 365 },
    scenario: { type: 'string', enum: ['prudent', 'realiste', 'optimiste'] },
  },
  additionalProperties: true,
};

const idInputSchema = (name = 'id') => ({
  type: 'object',
  required: [name],
  properties: {
    [name]: { type: 'string', minLength: 1, maxLength: 120 },
  },
  additionalProperties: false,
});

module.exports = {
  RISK_LEVELS,
  structuredToolOutputSchema,
  emptyInputSchema,
  searchInputSchema,
  periodInputSchema,
  idInputSchema,
};
