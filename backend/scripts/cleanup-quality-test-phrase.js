const path = require('path');

require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
});

const { getDefaultPool, closeAllPools } = require('../dbRegistry');
const qualityDocumentation = require('../services/quality/qualityDocumentationService');

const DEFAULT_PHRASE = 'Test MCP trusted owner mode du 26 juillet 2026';

function argValues(name) {
  const prefix = `--${name}=`;
  return process.argv.filter((arg) => arg.startsWith(prefix)).map((arg) => arg.slice(prefix.length)).filter(Boolean);
}

function removePhrase(html, phrase) {
  return String(html || '')
    .replaceAll(phrase, '')
    .replace(/<p>\s*<\/p>/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function removeStructuredBlockTestTable(html) {
  return String(html || '')
    .replace(/<figure[^>]*>[\s\S]*?<table[\s\S]*?<t[hd][^>]*>\s*Champ\s*<\/t[hd]>[\s\S]*?<t[hd][^>]*>\s*Valeur\s*<\/t[hd]>[\s\S]*?<td[^>]*>\s*Test\s*<\/td>[\s\S]*?<td[^>]*>\s*OK\s*<\/td>[\s\S]*?<\/table>[\s\S]*?<\/figure>/gi, '')
    .replace(/<table[\s\S]*?<t[hd][^>]*>\s*Champ\s*<\/t[hd]>[\s\S]*?<t[hd][^>]*>\s*Valeur\s*<\/t[hd]>[\s\S]*?<td[^>]*>\s*Test\s*<\/td>[\s\S]*?<td[^>]*>\s*OK\s*<\/td>[\s\S]*?<\/table>/gi, '')
    .replace(/<p>\s*<\/p>/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function main() {
  const phrases = argValues('phrase');
  if (!phrases.length) phrases.push(DEFAULT_PHRASE);
  if (!phrases.includes('Test bloc structuré MCP.')) phrases.push('Test bloc structuré MCP.');
  const apply = process.argv.includes('--apply');
  const removeStructuredTable = process.argv.includes('--remove-structured-test-table');
  const db = getDefaultPool();

  let matched = 0;
  const cleaned = [];
  for (const phrase of phrases) {
    const found = await db.query(
      `SELECT id, store_id, code, title, content_html, version, status, updated_at
       FROM quality_documentation_sections
       WHERE content_html ILIKE $1
       ORDER BY updated_at DESC
       LIMIT 50`,
      [`%${phrase}%`]
    );
    matched += found.rows.length;
    for (const row of found.rows) {
      let nextHtml = removePhrase(row.content_html, phrase);
      if (removeStructuredTable) nextHtml = removeStructuredBlockTestTable(nextHtml);
      if (nextHtml === row.content_html) continue;
      if (!apply) {
        cleaned.push({
          dry_run: true,
          phrase,
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
        phrase,
        id: row.id,
        store_id: row.store_id,
        code: row.code,
        title: row.title,
        version_before: row.version,
        version_after: updated?.version || null,
        status: updated?.status || null,
      });
    }
  }

  if (removeStructuredTable) {
    const found = await db.query(
      `SELECT id, store_id, code, title, content_html, version, status, updated_at
       FROM quality_documentation_sections
       WHERE content_html ILIKE '%Champ%'
         AND content_html ILIKE '%Valeur%'
         AND content_html ILIKE '%Test%'
         AND content_html ILIKE '%OK%'
       ORDER BY updated_at DESC
       LIMIT 50`
    );
    matched += found.rows.length;
    for (const row of found.rows) {
      const nextHtml = removeStructuredBlockTestTable(row.content_html);
      if (nextHtml === row.content_html) continue;
      if (!apply) {
        cleaned.push({
          dry_run: true,
          phrase: 'structured-test-table',
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
          change_summary: 'Retrait tableau de test MCP bloc structure',
        }
      );
      cleaned.push({
        dry_run: false,
        phrase: 'structured-test-table',
        id: row.id,
        store_id: row.store_id,
        code: row.code,
        title: row.title,
        version_before: row.version,
        version_after: updated?.version || null,
        status: updated?.status || null,
      });
    }
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
    phrases,
    remove_structured_test_table: removeStructuredTable,
    matched,
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
