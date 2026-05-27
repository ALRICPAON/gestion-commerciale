const crypto = require('crypto');
const path = require('path');

const SANITARY_IMAGE_MIME_TYPES = Object.freeze({
  '.jpg': ['image/jpeg', 'image/jpg', 'image/pjpeg'],
  '.jpeg': ['image/jpeg', 'image/jpg', 'image/pjpeg'],
  '.png': ['image/png'],
  '.webp': ['image/webp'],
  '.heic': ['image/heic', 'image/heif'],
  '.heif': ['image/heic', 'image/heif'],
});

const SPREADSHEET_MIME_TYPES = Object.freeze({
  '.xlsx': [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream',
  ],
  '.xls': [
    'application/vnd.ms-excel',
    'application/vnd.ms-office',
    'application/octet-stream',
  ],
  '.csv': [
    'text/csv',
    'application/csv',
    'text/plain',
    'application/vnd.ms-excel',
    'application/octet-stream',
  ],
});

const SUPPLIER_IMPORT_MIME_TYPES = Object.freeze({
  ...SPREADSHEET_MIME_TYPES,
  '.pdf': ['application/pdf', 'application/x-pdf'],
});

function getUploadExtension(file) {
  return path.extname(file?.originalname || '').toLowerCase();
}

function createSafeUploadFilename(prefix, ext) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
}

function createUploadError(message) {
  const error = new Error(message);
  error.status = 400;
  error.expose = true;
  return error;
}

function createFileFilter(allowedMimeTypesByExt, message) {
  return (req, file, cb) => {
    const ext = getUploadExtension(file);
    const allowedMimeTypes = allowedMimeTypesByExt[ext];
    const mimetype = String(file?.mimetype || '').toLowerCase();

    if (!allowedMimeTypes || !allowedMimeTypes.includes(mimetype)) {
      return cb(createUploadError(message));
    }

    return cb(null, true);
  };
}

module.exports = {
  createSafeUploadFilename,
  getUploadExtension,
  sanitaryImageFileFilter: createFileFilter(
    SANITARY_IMAGE_MIME_TYPES,
    'Type de photo non autorise'
  ),
  supplierImportFileFilter: createFileFilter(
    SUPPLIER_IMPORT_MIME_TYPES,
    'Type de document import non autorise'
  ),
  inventoryImportFileFilter: createFileFilter(
    SPREADSHEET_MIME_TYPES,
    'Type de fichier inventaire non autorise'
  ),
};
