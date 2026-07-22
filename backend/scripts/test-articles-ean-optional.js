const assert = require('assert');
const fs = require('fs');
const path = require('path');

function run() {
  const articlesHtml = fs.readFileSync(path.join(__dirname, '../../frontend/articles.html'), 'utf8');
  const articlesJs = fs.readFileSync(path.join(__dirname, '../../frontend/js/articles.js'), 'utf8');
  const articlesRoutes = fs.readFileSync(path.join(__dirname, '../routes/articles.js'), 'utf8');
  const articlesStoreLevelRoutes = fs.readFileSync(path.join(__dirname, '../routes/articlesStoreLevel.js'), 'utf8');
  const articlesMigration = fs.readFileSync(path.join(__dirname, '../db/gestion-commerciale/010_articles_commerciale.sql'), 'utf8');
  const scaouestParser = fs.readFileSync(
    path.join(__dirname, '../services/imports/parsers/parser-scaouest.js'),
    'utf8'
  );

  assert(articlesHtml.includes('id="article-ean"'));
  assert(!articlesHtml.includes('id="article-ean" required'));
  assert(articlesJs.includes('ean: articleEanInput.value.trim()'));

  assert(articlesRoutes.includes('toNullableString(ean)'));
  assert(articlesRoutes.includes("articleUniqueViolationMessage(err)"));
  assert(!articlesRoutes.includes('!toNullableString(ean)'));
  assert(!articlesStoreLevelRoutes.includes('!data.ean'));

  assert(articlesMigration.includes('ean VARCHAR(100),'));
  assert(!articlesMigration.match(/ean\s+VARCHAR\(100\)\s+NOT\s+NULL/i));

  assert(!scaouestParser.includes('EAN introuvable'));
  assert(!scaouestParser.includes('continue;\n      }\n\n      let montantHT'));
  assert(scaouestParser.includes('ean: ean || null'));
  assert(scaouestParser.includes('article_plu: supplierRef'));

  console.log('Articles EAN optional tests passed');
}

run();
