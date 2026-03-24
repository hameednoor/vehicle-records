const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { isCloudStorage, uploadFile } = require('../services/storage');

// On Vercel the deployed filesystem is read-only; use /tmp for temp files.
const UPLOADS_DIR = process.env.VERCEL
  ? '/tmp/uploads'
  : path.join(__dirname, '..', 'uploads');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const ALLOWED_MIMETYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/tiff',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

const ALLOWED_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.heic', '.webp', '.gif', '.bmp', '.tiff',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `${uuidv4()}${ext}`;
    cb(null, uniqueName);
  },
});

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED_MIMETYPES.includes(file.mimetype) || ALLOWED_EXTENSIONS.includes(ext)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        `Invalid file type. Allowed types: ${ALLOWED_EXTENSIONS.join(', ')}`
      ),
      false
    );
  }
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
  },
});

/**
 * After multer writes to disk, upload file(s) to cloud storage.
 * Sets cloudUrl on each file object, then deletes the local temp file.
 *
 * @param {Array} files - multer file objects
 * @param {string} bucket - 'invoices' or 'vehicle-photos'
 * @param {string} [vehicleName] - vehicle name for folder structure
 */
async function transferToCloud(files, bucket, vehicleName) {
  if (!files || files.length === 0) return;

  if (!isCloudStorage) {
    if (process.env.VERCEL) {
      console.error('CRITICAL: Cloud storage not configured on Vercel! Files will be lost.');
      console.error('Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in Vercel env vars.');
    }
    return;
  }

  for (const file of files) {
    try {
      const buffer = fs.readFileSync(file.path);
      const cloudUrl = await uploadFile(bucket, file.filename, buffer, file.mimetype, { vehicleName });
      file.cloudUrl = cloudUrl;
      console.log(`Uploaded to Google Drive: ${file.originalname} -> ${cloudUrl}`);
      // Remove local temp file
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    } catch (err) {
      console.error(`Failed to transfer ${file.filename} to cloud:`, err.message);
      throw new Error(`Cloud upload failed for ${file.originalname}: ${err.message}`);
    }
  }
}

// Middleware wrappers that handle multer errors (no auto cloud transfer)
function singleUploadMiddleware(req, res, next) {
  upload.single('photo')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File size exceeds the 10MB limit.' });
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ error: 'Too many files. Maximum 10 files allowed.' });
      }
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    }
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}

function arrayUploadMiddleware(req, res, next) {
  upload.array('invoices', 10)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File size exceeds the 10MB limit.' });
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ error: 'Too many files. Maximum 10 files allowed.' });
      }
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    }
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}

module.exports = {
  upload,
  singleUpload: singleUploadMiddleware,
  arrayUpload: arrayUploadMiddleware,
  transferToCloud,
  UPLOADS_DIR,
};
