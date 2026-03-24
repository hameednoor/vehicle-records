/**
 * File storage abstraction.
 *
 * Auth priority:
 *   1. OAuth2 (GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN)
 *      -> Files are owned by the user's account (has storage quota)
 *   2. Service account (GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY)
 *      -> Legacy fallback (service accounts have zero quota as of 2024)
 *
 * Folder structure on Google Drive:
 *   Vehicle Records/
 *     <Vehicle Name>/
 *       invoices/
 *       photos/
 *
 * Exported interface:
 *   uploadFile(bucket, filePath, buffer, mimetype, options)  -> URL string
 *   deleteFile(bucket, filePath)                             -> void
 *   getFileUrl(bucket, filePath)                             -> URL string
 *   ensureBuckets()                                          -> void
 *   isCloudStorage                                           -> boolean
 *   getDrive()                                               -> Google Drive client
 *   extractGoogleDriveFileId(url)                            -> string | null
 */

const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const UPLOADS_DIR = process.env.VERCEL
  ? '/tmp/uploads'
  : path.join(__dirname, '..', 'uploads');

// Cloud storage is enabled if OAuth2 OR service account credentials are set
const hasOAuth = !!(
  process.env.GOOGLE_CLIENT_ID &&
  process.env.GOOGLE_CLIENT_SECRET &&
  process.env.GOOGLE_REFRESH_TOKEN
);

const hasServiceAccount = !!(
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY
);

const isCloudStorage = hasOAuth || hasServiceAccount;

// ---------------------------------------------------------------------------
// Google Drive client (lazy-initialized, cached across warm invocations)
// ---------------------------------------------------------------------------

let driveClient = null;

function parsePrivateKey(raw) {
  if (!raw) return '';

  // Method 0: Base64-encoded key (most reliable for Vercel)
  const base64Key = process.env.GOOGLE_PRIVATE_KEY_BASE64;
  if (base64Key) {
    try {
      const decoded = Buffer.from(base64Key, 'base64').toString('utf8');
      if (decoded.includes('PRIVATE KEY')) {
        console.log('[Drive] Private key decoded from GOOGLE_PRIVATE_KEY_BASE64');
        return decoded;
      }
    } catch (err) {
      console.warn('[Drive] Failed to decode GOOGLE_PRIVATE_KEY_BASE64:', err.message);
    }
  }

  // Method 1: Try JSON.parse
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string' && parsed.includes('PRIVATE KEY')) {
      return parsed;
    }
  } catch {}

  // Method 2: Wrap in quotes and JSON.parse
  try {
    const parsed = JSON.parse(`"${raw.replace(/"/g, '\\"')}"`);
    if (typeof parsed === 'string' && parsed.includes('PRIVATE KEY')) {
      return parsed;
    }
  } catch {}

  // Method 3: Manual replacement
  let key = raw.replace(/^["']|["']$/g, '');
  key = key.replace(/\\n/g, '\n');
  key = key.replace(/\r/g, '');

  if (key.includes('-----BEGIN') && key.indexOf('\n') === -1) {
    const b64 = key
      .replace(/-----BEGIN PRIVATE KEY-----/, '')
      .replace(/-----END PRIVATE KEY-----/, '')
      .replace(/\s/g, '');
    const lines = b64.match(/.{1,64}/g) || [];
    key = ['-----BEGIN PRIVATE KEY-----', ...lines, '-----END PRIVATE KEY-----', ''].join('\n');
  }

  return key;
}

function getDrive() {
  if (driveClient) return driveClient;
  const { drive } = require('@googleapis/drive');

  // Prefer OAuth2 — files are owned by the user (has storage quota)
  if (hasOAuth) {
    const { OAuth2Client } = require('google-auth-library');
    const oauth2 = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
    driveClient = drive({ version: 'v3', auth: oauth2 });
    console.log('[Drive] Using OAuth2 (user account — has storage quota)');
    return driveClient;
  }

  // Fall back to service account
  const { GoogleAuth } = require('google-auth-library');
  const privateKey = parsePrivateKey(process.env.GOOGLE_PRIVATE_KEY);
  const auth = new GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: privateKey,
    },
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });
  driveClient = drive({ version: 'v3', auth });
  console.log('[Drive] Using service account (WARNING: no storage quota)');
  return driveClient;
}

// ---------------------------------------------------------------------------
// Folder management
// ---------------------------------------------------------------------------

let rootFolderId = null;
const folderCache = new Map(); // "vehicleName/subfolder" -> folderId

/**
 * Find a folder by name under a parent, or create it.
 */
async function findOrCreateFolder(name, parentId) {
  const drive = getDrive();
  const q = `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await drive.files.list({ q, fields: 'files(id, name)', pageSize: 1 });

  if (res.data.files && res.data.files.length > 0) {
    return res.data.files[0].id;
  }

  const folder = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    },
    fields: 'id',
  });

  return folder.data.id;
}

/**
 * Ensure root "Vehicle Records" folder exists.
 */
async function ensureRootFolder() {
  if (rootFolderId) return rootFolderId;

  if (process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID) {
    rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
    return rootFolderId;
  }

  const drive = getDrive();
  const q = `name='Vehicle Records' and 'root' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await drive.files.list({ q, fields: 'files(id)', pageSize: 1 });

  if (res.data.files && res.data.files.length > 0) {
    rootFolderId = res.data.files[0].id;
  } else {
    const folder = await drive.files.create({
      requestBody: {
        name: 'Vehicle Records',
        mimeType: 'application/vnd.google-apps.folder',
      },
      fields: 'id',
    });
    rootFolderId = folder.data.id;
    console.log(`Created Google Drive root folder: Vehicle Records (${rootFolderId})`);
  }

  return rootFolderId;
}

/**
 * Get or create: Vehicle Records / <vehicleName> / <subfolder>
 * subfolder = "invoices" or "photos"
 */
async function getOrCreateVehicleSubfolder(vehicleName, subfolder) {
  const cacheKey = `${vehicleName}/${subfolder}`;
  if (folderCache.has(cacheKey)) return folderCache.get(cacheKey);

  const root = await ensureRootFolder();
  const vehicleFolderId = await findOrCreateFolder(vehicleName, root);
  const subFolderId = await findOrCreateFolder(subfolder, vehicleFolderId);

  folderCache.set(cacheKey, subFolderId);
  return subFolderId;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractFilename(filePath) {
  if (!filePath) return '';
  try {
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      const url = new URL(filePath);
      return path.basename(url.pathname);
    }
  } catch (_) {
    // Fall through
  }
  return path.basename(filePath);
}

/**
 * Extract Google Drive file ID from a stored URL.
 * Supports: https://drive.google.com/uc?id=FILE_ID
 *           https://drive.google.com/file/d/FILE_ID/...
 *           gdrive:FILE_ID
 */
function extractGoogleDriveFileId(url) {
  if (!url) return null;
  if (url.startsWith('gdrive:')) return url.slice(7);

  const ucMatch = url.match(/drive\.google\.com\/uc\?id=([^&]+)/);
  if (ucMatch) return ucMatch[1];

  const fileMatch = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (fileMatch) return fileMatch[1];

  return null;
}

// ---------------------------------------------------------------------------
// Storage operations
// ---------------------------------------------------------------------------

/**
 * Ensure storage is ready.
 */
async function ensureBuckets() {
  if (!isCloudStorage) {
    console.warn('WARNING: Google Drive storage NOT configured. Files will be stored locally (lost on Vercel restarts).');
    return;
  }

  try {
    await ensureRootFolder();
    console.log(`Google Drive storage ready (mode: ${hasOAuth ? 'OAuth2' : 'service-account'}).`);
  } catch (err) {
    console.error('Failed to initialize Google Drive storage:', err.message);
  }
}

/**
 * Upload a file.
 *
 * @param {string} bucket - 'invoices' or 'vehicle-photos'
 * @param {string} filePath - Filename (e.g. 'abc-123.jpg')
 * @param {Buffer} buffer - File contents
 * @param {string} mimetype - MIME type
 * @param {object} [options] - { vehicleName: string }
 * @returns {Promise<string>} Public URL or local path
 */
async function uploadFile(bucket, filePath, buffer, mimetype, options) {
  if (isCloudStorage) {
    const drive = getDrive();
    const vehicleName = options?.vehicleName || 'General';
    const subfolder = bucket === 'vehicle-photos' ? 'photos' : 'invoices';
    const parentId = await getOrCreateVehicleSubfolder(vehicleName, subfolder);

    const file = await drive.files.create({
      requestBody: {
        name: filePath,
        parents: [parentId],
      },
      media: {
        mimeType: mimetype,
        body: Readable.from(buffer),
      },
      fields: 'id',
    });

    const fileId = file.data.id;
    return `https://drive.google.com/uc?id=${fileId}`;
  }

  // Local storage
  const filename = extractFilename(filePath);
  const destPath = path.join(UPLOADS_DIR, filename);
  fs.writeFileSync(destPath, buffer);
  return `/uploads/${filename}`;
}

/**
 * Delete a file.
 */
async function deleteFile(bucket, filePath) {
  if (!filePath) return;

  if (isCloudStorage) {
    const fileId = extractGoogleDriveFileId(filePath);
    if (!fileId) {
      console.warn(`Could not extract Google Drive file ID from: ${filePath}`);
      return;
    }
    try {
      const drive = getDrive();
      await drive.files.delete({ fileId });
    } catch (err) {
      console.error(`Google Drive delete failed for ${fileId}:`, err.message);
    }
    return;
  }

  // Local storage
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    console.warn(`Skipping local delete for cloud URL: ${filePath}`);
    return;
  }

  const filename = extractFilename(filePath);
  const fullPath = path.join(UPLOADS_DIR, filename);
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }
}

/**
 * Get a file's URL.
 */
async function getFileUrl(bucket, filePath) {
  if (isCloudStorage) {
    if (filePath && filePath.startsWith('https://')) return filePath;
    return filePath;
  }
  return `/uploads/${extractFilename(filePath)}`;
}

module.exports = {
  uploadFile,
  deleteFile,
  getFileUrl,
  isCloudStorage,
  ensureBuckets,
  extractFilename,
  extractGoogleDriveFileId,
  getDrive,
  UPLOADS_DIR,
};
