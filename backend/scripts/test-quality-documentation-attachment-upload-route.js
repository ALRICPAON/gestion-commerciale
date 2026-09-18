const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cors = require('cors');
const express = require('express');
const jwt = require('jsonwebtoken');

const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-documentation-upload-'));
process.env.JWT_SECRET = 'quality-documentation-upload-test-secret';
process.env.QUALITY_DOCUMENTATION_UPLOAD_DIR = uploadDir;

let databaseMode = 'success';
let insertParams = null;
const dbPool = {
  async query(sql, params = []) {
    if (sql.includes('SELECT id FROM quality_documentation_sections')) {
      if (databaseMode === 'error') throw new Error('Test database failure');
      return { rows: databaseMode === 'missing' ? [] : [{ id: params[0] }] };
    }
    if (sql.includes('INSERT INTO quality_documentation_attachments')) {
      insertParams = params;
      return {
        rows: [{
          id: 'attachment-test',
          section_id: params[0],
          store_id: params[1],
          filename: params[2],
          original_filename: params[3],
          mime_type: params[4],
          file_path: params[5],
          file_size: params[6],
          include_in_export: params[7],
          created_by: params[8],
        }],
      };
    }
    throw new Error(`Unexpected test query: ${sql}`);
  },
};

const dbRegistryPath = require.resolve('../dbRegistry');
require.cache[dbRegistryPath] = {
  id: dbRegistryPath,
  filename: dbRegistryPath,
  loaded: true,
  exports: {
    DB_CLIENTS: { default: 'test' },
    getPoolByClientKey: () => dbPool,
    getPoolByDatabase: () => dbPool,
    getDefaultPool: () => dbPool,
    closeAllPools: async () => {},
  },
};

const qualityRoutes = require('../routes/quality');
const app = express();
app.use(cors({
  origin: 'https://altamaree.fr',
  allowedHeaders: ['Authorization', 'Content-Type'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  optionsSuccessStatus: 204,
}));
app.use('/api/quality', qualityRoutes);
const sectionId = '11111111-1111-4111-8111-111111111111';
const token = jwt.sign({
  id: '22222222-2222-4222-8222-222222222222',
  email: 'quality-upload-test@altamaree.fr',
  role: 'admin',
  store_id: '33333333-3333-4333-8333-333333333333',
  client_key: 'default',
}, process.env.JWT_SECRET);

function multipartBody(filename = 'piece-jointe.txt') {
  const form = new FormData();
  form.set('file', new Blob(['piece jointe qualite'], { type: 'text/plain' }), filename);
  form.set('include_in_export', 'true');
  return form;
}

async function main() {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const uploadUrl = `${baseUrl}/api/quality/documentation/sections/${sectionId}/attachments`;
  const requestHeaders = { Origin: 'https://altamaree.fr', Authorization: `Bearer ${token}` };

  try {
    const preflight = await fetch(uploadUrl, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://altamaree.fr',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });
    assert.strictEqual(preflight.status, 204, 'le preflight multipart doit etre accepte');
    assert.strictEqual(preflight.headers.get('access-control-allow-origin'), 'https://altamaree.fr', 'le domaine frontend doit etre autorise');
    assert(preflight.headers.get('access-control-allow-methods').includes('POST'), 'POST doit etre autorise par CORS');

    databaseMode = 'success';
    const created = await fetch(uploadUrl, { method: 'POST', headers: requestHeaders, body: multipartBody() });
    const attachment = await created.json();
    assert.strictEqual(created.status, 201, 'la route multipart montee doit creer la piece jointe');
    assert.strictEqual(created.headers.get('access-control-allow-origin'), 'https://altamaree.fr', 'la reponse upload doit conserver CORS');
    assert.strictEqual(attachment.original_filename, 'piece-jointe.txt');
    assert.strictEqual(attachment.mime_type, 'text/plain');
    assert.strictEqual(attachment.include_in_export, true);
    assert(fs.existsSync(attachment.file_path), 'le fichier multipart doit etre ecrit');
    assert(insertParams, 'l insertion de la piece jointe doit etre executee');

    databaseMode = 'missing';
    const missing = await fetch(uploadUrl, { method: 'POST', headers: requestHeaders, body: multipartBody('missing.txt') });
    assert.strictEqual(missing.status, 404, 'un chapitre absent doit produire une 404');
    assert.strictEqual(missing.headers.get('access-control-allow-origin'), 'https://altamaree.fr', 'la 404 doit conserver CORS');

    databaseMode = 'error';
    const originalConsoleError = console.error;
    console.error = () => {};
    const failed = await fetch(uploadUrl, { method: 'POST', headers: requestHeaders, body: multipartBody('failure.txt') })
      .finally(() => { console.error = originalConsoleError; });
    assert.strictEqual(failed.status, 500, 'une erreur serveur doit produire une 500');
    assert.strictEqual(failed.headers.get('access-control-allow-origin'), 'https://altamaree.fr', 'la 500 doit conserver CORS');

    const catchAll = await fetch(`${baseUrl}/api/route-inexistante`, { headers: requestHeaders });
    assert.strictEqual(catchAll.status, 404, 'une route inconnue doit rester une 404');
    assert.strictEqual(catchAll.headers.get('access-control-allow-origin'), 'https://altamaree.fr', 'la 404 globale doit conserver CORS');

    console.log('quality documentation attachment upload route tests ok');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(uploadDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  fs.rmSync(uploadDir, { recursive: true, force: true });
  process.exitCode = 1;
});
