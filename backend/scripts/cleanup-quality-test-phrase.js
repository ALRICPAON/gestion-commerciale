const path = require('path');

require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
});

const { getDefaultPool, closeAllPools } = require('../dbRegistry');
const qualityDocumentation = require('../services/quality/qualityDocumentationService');

const DEFAULT_PHRASE = 'Test MCP trusted owner mode du 26 juillet 2026';

function argValue(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

function removePhrase(html, phrase) {
  return String(html || '')
    .replaceAll(phrase, '')
    .replace(/<p>\s*<\/p>/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function main() {
  const phrase = argValue('phrase') || DEFAULT_PHRASE;
  const apply = process.argv.includes('--apply');
  const db = getDefaultPool();

  const found = await db.query(
    `SELECT id, store_id, code, title, content_html, version, status, updated_at
     FROM quality_documentation_sections
     WHERE content_html ILIKE $1
     ORDER BY updated_at DESC
     LIMIT 50`,
    [`%${phrase}%`]
  );

  const cleaned = [];
  for (const row of found.rows) {
    const nextHtml = removePhrase(row.content_html, phrase);
    if (nextHtml === row.content_html) continue;
    if (!apply) {
      cleaned.push({
        dry_run: true,
        id: row.id,
        store_id: row.store_id,
        code: row.code,
        title: row.title,
        version: row.version,
        status: row.status,
      });
      continue;
    }
    const updated = await qualityDocumentation.updateSection(
      db,
      row.store_id,
      row.id,
      process.env.ALTA_AGENT_USER_ID || null,
      {
        content_html: nextHtml,
        change_summary: 'Retrait phrase de test MCP trusted owner mode',
      }
    );
    cleaned.push({
      dry_run: false,
      id: row.id,
      store_id: row.store_id,
      code: row.code,
      title: row.title,
      version_before: row.version,
      version_after: updated?.version || null,
      status: updated?.status || null,
    });
  }

  const audits = await db.query(
    `SELECT tool_name, status, started_at, completed_at
     FROM agent_tool_audit_logs
     WHERE tool_name IN ('quality.documentation.apply_section_updates','execute_business_action')
     ORDER BY created_at DESC
     LIMIT 10`
  ).catch(() => ({ rows: [] }));

  console.log(JSON.stringify({
    ok: true,
    apply,
    phrase,
    matched: found.rows.length,
    cleaned,
    recent_agent_audit_count: audits.rows.length,
    recent_agent_audits: audits.rows,
  }, null, 2));
}

main().catch((error) => {
  console.log(JSON.stringify({
    ok: false,
    error: error.message || 'Erreur nettoyage phrase test',
    code: error.code || null,
  }, null, 2));
  process.exitCode = 1;
}).finally(closeAllPools);
