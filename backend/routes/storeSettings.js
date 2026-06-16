const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const express = require('express');
const multer = require('multer');

const { authenticateToken } = require('../middleware/auth');
const { requireAdminOrManager } = require('../middleware/authorization');
const { attachDbContext } = require('../middleware/dbContext');

const router = express.Router();

const STORE_LOGOS_DIR = path.resolve(__dirname, '..', 'uploads', 'store-logos');
const STORE_LOGOS_PUBLIC_PATH = '/uploads/store-logos';
const MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024;
const ALLOWED_LOGO_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/svg+xml']);
const ALLOWED_LOGO_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.svg']);

fs.mkdirSync(STORE_LOGOS_DIR, { recursive: true });

const COMMUNICATION_DEFAULTS = {
  email_sender_name: 'ALTA MARÉE',
  email_sender_address: 'commercial@altamaree.fr',
  contact_email: 'contact@altamaree.fr',
  internal_email: 'alric@altamaree.fr',
  webmail_url: 'https://mail.altamaree.fr',
  calendar_url: 'https://mail.altamaree.fr',
};

const STORE_SETTINGS_FIELDS = [
  'company_name',
  'logo_url',
  'address_line1',
  'address_line2',
  'postal_code',
  'city',
  'country',
  'phone',
  'email',
  'siret',
  'vat_number',
  'sanitary_approval_number',
  'iban',
  'bic',
  'payment_terms',
  'legal_mentions',
  'terms_and_conditions',
  'delivery_note_footer',
  'invoice_footer',
  ...Object.keys(COMMUNICATION_DEFAULTS),
];

function normalizeText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function mapSettingsPayload(body = {}) {
  const settings = {};

  STORE_SETTINGS_FIELDS.forEach((field) => {
    settings[field] = normalizeText(body[field]);
  });

  settings.country = settings.country || 'France';
  Object.entries(COMMUNICATION_DEFAULTS).forEach(([field, fallback]) => {
    settings[field] = settings[field] || fallback;
  });

  return settings;
}

function settingsSelectSql() {
  return `
    SELECT
      id,
      store_id,
      ${STORE_SETTINGS_FIELDS.join(',\n      ')},
      created_by,
      updated_by,
      created_at,
      updated_at
    FROM store_settings
  `;
}

async function findStoreSettings(req) {
  const result = await req.dbPool.query(
    `
    ${settingsSelectSql()}
    WHERE store_id = $1
    LIMIT 1
    `,
    [req.user.store_id]
  );

  return result.rows[0] || null;
}

function uploadError(message) {
  const err = new Error(message);
  err.status = 400;
  err.expose = true;
  return err;
}

function fileExtension(filename = '') {
  return path.extname(filename).toLowerCase();
}

function logUploadRejection(label, file, reason) {
  console.warn(`Upload ${label} refusé`, {
    reason,
    filename: file?.originalname || null,
    mimetype: file?.mimetype || null,
    extension: file ? fileExtension(file.originalname) : null,
    size: file?.size || null,
  });
}

function validateFileMetadata(file, options) {
  if (!file) {
    logUploadRejection(options.label, file, 'fichier manquant');
    return uploadError(`Fichier ${options.label} manquant`);
  }

  const ext = fileExtension(file.originalname);
  if (!options.extensions.has(ext)) {
    logUploadRejection(options.label, file, 'extension non autorisee');
    return uploadError(`Extension ${options.label} non autorisee`);
  }
  if (!options.mimeTypes.has(file.mimetype)) {
    logUploadRejection(options.label, file, 'type MIME non autorise');
    return uploadError(`Type MIME ${options.label} non autorise`);
  }
  return null;
}

function safeUploadFilename(req, file) {
  const ext = fileExtension(file.originalname);
  const storeId = String(req.user.store_id || 'store').replace(/[^a-zA-Z0-9-]/g, '');
  return `${storeId}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
}

function buildUpload(options) {
  return multer({
    storage: multer.diskStorage({
      destination(req, file, cb) {
        fs.mkdir(options.directory, { recursive: true }, (err) => cb(err, options.directory));
      },
      filename(req, file, cb) {
        cb(null, safeUploadFilename(req, file));
      },
    }),
    limits: { fileSize: options.maxSize },
    fileFilter(req, file, cb) {
      const err = validateFileMetadata(file, options);
      cb(err, !err);
    },
  });
}

const logoUpload = buildUpload({
  label: 'logo',
  directory: STORE_LOGOS_DIR,
  maxSize: MAX_LOGO_SIZE_BYTES,
  extensions: ALLOWED_LOGO_EXTENSIONS,
  mimeTypes: ALLOWED_LOGO_MIME_TYPES,
});

function publicUrl(req, publicPath, filename) {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  return `${baseUrl}${publicPath}/${encodeURIComponent(filename)}`;
}

function localUploadedPathFromUrl(fileUrl, publicPath, directory) {
  if (!fileUrl) return null;

  let pathname;
  try {
    pathname = new URL(fileUrl).pathname;
  } catch {
    pathname = String(fileUrl || '');
  }

  const expectedPrefix = `${publicPath}/`;
  if (!pathname.startsWith(expectedPrefix)) return null;

  const filename = path.basename(decodeURIComponent(pathname));
  if (!filename) return null;

  const candidatePath = path.resolve(directory, filename);
  const allowedRoot = `${directory}${path.sep}`;
  return candidatePath.startsWith(allowedRoot) ? candidatePath : null;
}

async function removeLocalUploadIfOwned(fileUrl, publicPath, directory) {
  const localPath = localUploadedPathFromUrl(fileUrl, publicPath, directory);
  if (!localPath) return;

  try {
    await fsp.unlink(localPath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('Erreur suppression ancien fichier branding :', err);
    }
  }
}

async function removeUploadedFile(file) {
  if (!file?.path) return;
  try {
    await fsp.unlink(file.path);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('Erreur nettoyage fichier uploadé :', err);
    }
  }
}

async function validateStoredImageContent(file, allowedExtensions) {
  const ext = fileExtension(file.originalname);
  const buffer = await fsp.readFile(file.path);

  if (allowedExtensions.has('.png') && ext === '.png') {
    const pngSignature = '89504e470d0a1a0a';
    return buffer.subarray(0, 8).toString('hex') === pngSignature;
  }

  if (allowedExtensions.has('.jpg') && (ext === '.jpg' || ext === '.jpeg')) {
    return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  if (allowedExtensions.has('.svg') && ext === '.svg') {
    const text = buffer.toString('utf8').trim().toLowerCase();
    return text.includes('<svg') && !text.includes('<script') && !text.includes('javascript:');
  }

  return false;
}

function storeSettingsColumnsSql() {
  return ['store_id', ...STORE_SETTINGS_FIELDS, 'created_by', 'updated_by'].join(',\n    ');
}

function storeSettingsValuesSql() {
  return Array.from({ length: STORE_SETTINGS_FIELDS.length + 3 }, (_, index) => `$${index + 1}`).join(', ');
}

function storeSettingsParams(req, settings) {
  return [req.user.store_id, ...STORE_SETTINGS_FIELDS.map((field) => settings[field]), req.user.id, req.user.id];
}

function storeSettingsUpsertSql() {
  return [
    ...STORE_SETTINGS_FIELDS.map((field) => `${field} = EXCLUDED.${field}`),
    'updated_by = EXCLUDED.updated_by',
    'updated_at = now()',
  ].join(',\n        ');
}

router.get('/store-settings', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const settings = await findStoreSettings(req);
    res.json(settings);
  } catch (err) {
    console.error('Erreur GET /api/store-settings :', err);
    res.status(500).json({ error: 'Erreur serveur paramètres société' });
  }
});

router.post('/store-settings', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const settings = mapSettingsPayload(req.body);

    const result = await req.dbPool.query(
      `
      INSERT INTO store_settings (${storeSettingsColumnsSql()})
      VALUES (${storeSettingsValuesSql()})
      RETURNING id
      `,
      storeSettingsParams(req, settings)
    );

    const created = await findStoreSettings(req);
    res.status(201).json(created || { id: result.rows[0].id });
  } catch (err) {
    console.error('Erreur POST /api/store-settings :', err);
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Les paramètres société existent déjà pour ce magasin' });
    }
    res.status(500).json({ error: 'Erreur serveur création paramètres société' });
  }
});

router.put('/store-settings', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const settings = mapSettingsPayload(req.body);

    await req.dbPool.query(
      `
      INSERT INTO store_settings (${storeSettingsColumnsSql()})
      VALUES (${storeSettingsValuesSql()})
      ON CONFLICT (store_id) DO UPDATE
      SET
        ${storeSettingsUpsertSql()}
      `,
      storeSettingsParams(req, settings)
    );

    const updated = await findStoreSettings(req);
    res.json(updated);
  } catch (err) {
    console.error('Erreur PUT /api/store-settings :', err);
    res.status(500).json({ error: 'Erreur serveur mise à jour paramètres société' });
  }
});

router.post(
  '/store-settings/logo',
  authenticateToken,
  attachDbContext,
  requireAdminOrManager,
  logoUpload.single('logo'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Fichier logo manquant' });
      }

      const validContent = await validateStoredImageContent(req.file, ALLOWED_LOGO_EXTENSIONS);
      if (!validContent) {
        logUploadRejection('logo', req.file, 'contenu invalide');
        await removeUploadedFile(req.file);
        return res.status(400).json({ error: 'Contenu du logo invalide' });
      }

      const previousSettings = await findStoreSettings(req);
      const logoUrl = publicUrl(req, STORE_LOGOS_PUBLIC_PATH, req.file.filename);

      await req.dbPool.query(
        `
        INSERT INTO store_settings (store_id, logo_url, created_by, updated_by)
        VALUES ($1, $2, $3, $3)
        ON CONFLICT (store_id) DO UPDATE
        SET logo_url = EXCLUDED.logo_url,
          updated_by = EXCLUDED.updated_by,
          updated_at = now()
        `,
        [req.user.store_id, logoUrl, req.user.id]
      );

      await removeLocalUploadIfOwned(previousSettings?.logo_url, STORE_LOGOS_PUBLIC_PATH, STORE_LOGOS_DIR);
      const updated = await findStoreSettings(req);
      return res.json(updated);
    } catch (err) {
      await removeUploadedFile(req.file);
      console.error('Erreur POST /api/store-settings/logo :', err);
      return res.status(500).json({ error: 'Erreur serveur upload logo' });
    }
  }
);

router.delete('/store-settings/logo', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const previousSettings = await findStoreSettings(req);

    if (previousSettings) {
      await req.dbPool.query(
        `
        UPDATE store_settings
        SET logo_url = NULL,
          updated_by = $2,
          updated_at = now()
        WHERE store_id = $1
        `,
        [req.user.store_id, req.user.id]
      );
    }

    await removeLocalUploadIfOwned(previousSettings?.logo_url, STORE_LOGOS_PUBLIC_PATH, STORE_LOGOS_DIR);
    const updated = await findStoreSettings(req);
    return res.json(updated || { logo_url: null });
  } catch (err) {
    console.error('Erreur DELETE /api/store-settings/logo :', err);
    return res.status(500).json({ error: 'Erreur serveur suppression logo' });
  }
});

module.exports = router;
