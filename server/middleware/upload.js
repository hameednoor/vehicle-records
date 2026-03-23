const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { isCloudStorage, uploadFile } = require('../services/storage');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const ALLOWED_MIMETYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/webp',
  'application/pdf',
];

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.heic', '.webp', '.pdf'];

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

// Raw multer middleware
const rawSingleUpload = upload.single('photo');
const rawArrayUpload = upload.array('invoices', 10);

/**
 * After multer writes to disk, if cloud storage is enabled,
 * upload the file(s) to Supabase and set cloudUrl on each file object.
 * Then delete the local temp file.
 */
async function transferToCloud(files, bucket) {
  if (!isCloudStorage || !files || files.length === 0) return;

  for (const file of files) {
    try {
      const buffer = fs.readFileSync(file.path);
      const cloudUrl = await uploadFile(bucket, file.filename, buffer, file.mimetype);
      file.cloudUrl = cloudUrl;
      // Remove local temp file
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    } catch (err) {
      console.error(`Failed to transfer ${file.filename} to cloud:`, err.message);
      // Keep local file as fallback
    }
  }
}

// Middleware for single file upload (vehicle photo) with cloud transfer
function singleUploadMiddleware(req, res, next) {
  rawSingleUpload(req, res, async (err) => {
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

    // Transfer to cloud if applicable
    if (req.file) {
      await transferToCloud([req.file], 'vehicle-photos');
    }

    next();
  });
}

// Middleware for multiple file upload (invoices) with cloud transfer
function arrayUploadMiddleware(req, res, next) {
  rawArrayUpload(req, res, async (err) => {
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

    // Transfer to cloud if applicable
    if (req.files && req.files.length > 0) {
      await transferToCloud(req.files, 'invoices');
    }

    next();
  });
}

module.exports = {
  upload,
  singleUpload: singleUploadMiddleware,
  arrayUpload: arrayUploadMiddleware,
  UPLOADS_DIR,
};
