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
const STORE_FAVICONS_DIR = path.resolve(__dirname, '..', 'uploads', 'store-favicons');
const STORE_LOGOS_PUBLIC_PATH = '/uploads/store-logos';
const STORE_FAVICONS_PUBLIC_PATH = '/uploads/store-favicons';
const MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024;
const MAX_FAVICON_SIZE_BYTES = 512 * 1024;
const ALLOWED_LOGO_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/svg+xml']);
const ALLOWED_LOGO_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.svg']);
const ALLOWED_FAVICON_MIME_TYPES = new Set(['image/x-icon', 'image/vnd.microsoft.icon', 'image/png', 'image/svg+xml']);
const ALLOWED_FAVICON_EXTENSIONS = new Set(['.ico', '.png', '.svg']);

fs.mkdirSync(STORE_LOGOS_DIR, { recursive: true });
fs.mkdirSync(STORE_FAVICONS_DIR, { recursive: true });

const STORE_SETTINGS_FIELDS = [
  'company_name',
  'logo_url',
  'favicon_url',
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

  return settings;
}

function settingsSelectSql() {
  return `
    SELECT
      id,
      store_id,
      company_name,
      logo_url,
      favicon_url,
      address_line1,
      address_line2,
      postal_code,
      city,
      country,
      phone,
      email,
      siret,
      vat_number,
      sanitary_approval_number,
      iban,
      bic,
      payment_terms,
      legal_mentions,
      terms_and_conditions,
      delivery_note_footer,
      invoice_footer,
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

function validateFileMetadata(file, options) {
  if (!file) return uploadError(`Fichier ${options.label} manquant`);
  const ext = fileExtension(file.originalname);
  if (!options.extensions.has(ext)) {
    return uploadError(`Extension ${options.label} non autorisee`);
  }
  if (!options.mimeTypes.has(file.mimetype)) {
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

const faviconUpload = buildUpload({
  label: 'favicon',
  directory: STORE_FAVICONS_DIR,
  maxSize: MAX_FAVICON_SIZE_BYTES,
  extensions: ALLOWED_FAVICON_EXTENSIONS,
  mimeTypes: ALLOWED_FAVICON_MIME_TYPES,
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

  if (allowedExtensions.has('.ico') && ext === '.ico') {
    return buffer.length > 6 && buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && buffer[3] === 0x00;
  }

  return false;
}

function storeSettingsColumnsSql() {
  return `
    store_id,
    company_name,
    logo_url,
    favicon_url,
    address_line1,
    address_line2,
    postal_code,
    city,
    country,
    phone,
    email,
    siret,
    vat_number,
    sanitary_approval_number,
    iban,
    bic,
    payment_terms,
    legal_mentions,
    terms_and_conditions,
    delivery_note_footer,
    invoice_footer,
    created_by,
    updated_by
  `;
}

function storeSettingsValuesSql() {
  return `
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
    $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
    $21, $22, $23
  `;
}

function storeSettingsParams(req, settings) {
  return [
    req.user.store_id,
    settings.company_name,
    settings.logo_url,
    settings.favicon_url,
    settings.address_line1,
    settings.address_line2,
    settings.postal_code,
    settings.city,
    settings.country,
    settings.phone,
    settings.email,
    settings.siret,
    settings.vat_number,
    settings.sanitary_approval_number,
    settings.iban,
    settings.bic,
    settings.payment_terms,
    settings.legal_mentions,
    settings.terms_and_conditions,
    settings.delivery_note_footer,
    settings.invoice_footer,
    req.user.id,
    req.user.id,
  ];
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
        company_name = EXCLUDED.company_name,
        logo_url = EXCLUDED.logo_url,
        favicon_url = EXCLUDED.favicon_url,
        address_line1 = EXCLUDED.address_line1,
        address_line2 = EXCLUDED.address_line2,
        postal_code = EXCLUDED.postal_code,
        city = EXCLUDED.city,
        country = EXCLUDED.country,
        phone = EXCLUDED.phone,
        email = EXCLUDED.email,
        siret = EXCLUDED.siret,
        vat_number = EXCLUDED.vat_number,
        sanitary_approval_number = EXCLUDED.sanitary_approval_number,
        iban = EXCLUDED.iban,
        bic = EXCLUDED.bic,
        payment_terms = EXCLUDED.payment_terms,
        legal_mentions = EXCLUDED.legal_mentions,
        terms_and_conditions = EXCLUDED.terms_and_conditions,
        delivery_note_footer = EXCLUDED.delivery_note_footer,
        invoice_footer = EXCLUDED.invoice_footer,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
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

router.post(
  '/store-settings/favicon',
  authenticateToken,
  attachDbContext,
  requireAdminOrManager,
  faviconUpload.single('favicon'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Fichier favicon manquant' });
      }

      const validContent = await validateStoredImageContent(req.file, ALLOWED_FAVICON_EXTENSIONS);
      if (!validContent) {
        await removeUploadedFile(req.file);
        return res.status(400).json({ error: 'Contenu du favicon invalide' });
      }

      const previousSettings = await findStoreSettings(req);
      const faviconUrl = publicUrl(req, STORE_FAVICONS_PUBLIC_PATH, req.file.filename);

      await req.dbPool.query(
        `
        INSERT INTO store_settings (store_id, favicon_url, created_by, updated_by)
        VALUES ($1, $2, $3, $3)
        ON CONFLICT (store_id) DO UPDATE
        SET favicon_url = EXCLUDED.favicon_url,
          updated_by = EXCLUDED.updated_by,
          updated_at = now()
        `,
        [req.user.store_id, faviconUrl, req.user.id]
      );

      await removeLocalUploadIfOwned(previousSettings?.favicon_url, STORE_FAVICONS_PUBLIC_PATH, STORE_FAVICONS_DIR);
      const updated = await findStoreSettings(req);
      return res.json(updated);
    } catch (err) {
      await removeUploadedFile(req.file);
      console.error('Erreur POST /api/store-settings/favicon :', err);
      return res.status(500).json({ error: 'Erreur serveur upload favicon' });
    }
  }
);

router.delete('/store-settings/favicon', authenticateToken, attachDbContext, requireAdminOrManager, async (req, res) => {
  try {
    const previousSettings = await findStoreSettings(req);

    if (previousSettings) {
      await req.dbPool.query(
        `
        UPDATE store_settings
        SET favicon_url = NULL,
          updated_by = $2,
          updated_at = now()
        WHERE store_id = $1
        `,
        [req.user.store_id, req.user.id]
      );
    }

    await removeLocalUploadIfOwned(previousSettings?.favicon_url, STORE_FAVICONS_PUBLIC_PATH, STORE_FAVICONS_DIR);
    const updated = await findStoreSettings(req);
    return res.json(updated || { favicon_url: null });
  } catch (err) {
    console.error('Erreur DELETE /api/store-settings/favicon :', err);
    return res.status(500).json({ error: 'Erreur serveur suppression favicon' });
  }
});

module.exports = router;
