/**
 * File storage abstraction.
 *
 * When GOOGLE_SERVICE_ACCOUNT_EMAIL is set -> uses Google Drive
 * When it is not                          -> uses local filesystem (server/uploads/)
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

const isCloudStorage = !!(
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY
);

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
        const lineCount = decoded.split('\n').length;
        console.log(`[Drive] Key shape: ${decoded.length} chars, ${lineCount} lines, header=true, footer=true`);
        return decoded;
      }
    } catch (err) {
      console.warn('[Drive] Failed to decode GOOGLE_PRIVATE_KEY_BASE64:', err.message);
    }
  }

  // Method 1: Try JSON.parse — handles "...\n..." with proper escape processing
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string' && parsed.includes('PRIVATE KEY')) {
      console.log('[Drive] Private key parsed via JSON.parse (quoted value)');
      return parsed;
    }
  } catch {}

  // Method 2: Wrap in quotes and JSON.parse — handles \n as JSON escapes
  try {
    const parsed = JSON.parse(`"${raw.replace(/"/g, '\\"')}"`);
    if (typeof parsed === 'string' && parsed.includes('PRIVATE KEY')) {
      console.log('[Drive] Private key parsed via JSON.parse (unquoted value)');
      return parsed;
    }
  } catch {}

  // Method 3: Manual replacement
  let key = raw.replace(/^["']|["']$/g, '');
  key = key.replace(/\\n/g, '\n');
  key = key.replace(/\r/g, '');

  // If still no newlines, reformat the PEM
  if (key.includes('-----BEGIN') && key.indexOf('\n') === -1) {
    const b64 = key
      .replace(/-----BEGIN PRIVATE KEY-----/, '')
      .replace(/-----END PRIVATE KEY-----/, '')
      .replace(/\s/g, '');
    const lines = b64.match(/.{1,64}/g) || [];
    key = ['-----BEGIN PRIVATE KEY-----', ...lines, '-----END PRIVATE KEY-----', ''].join('\n');
    console.log('[Drive] Private key reformatted from single line');
  } else {
    console.log('[Drive] Private key parsed via manual replacement');
  }

  // Debug: log key shape (not the key itself)
  const lineCount = key.split('\n').length;
  const hasHeader = key.includes('-----BEGIN PRIVATE KEY-----');
  const hasFooter = key.includes('-----END PRIVATE KEY-----');
  console.log(`[Drive] Key shape: ${key.length} chars, ${lineCount} lines, header=${hasHeader}, footer=${hasFooter}`);

  return key;
}

function getDrive() {
  if (driveClient) return driveClient;
  const { drive } = require('@googleapis/drive');
  const { GoogleAuth } = require('google-auth-library');
  const privateKey = parsePrivateKey(process.env.GOOGLE_PRIVATE_KEY);
  const auth = new GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: privateKey,
    },
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  driveClient = drive({ version: 'v3', auth });
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

  // Transfer folder ownership so it doesn't count against service account quota
  const ownerEmail = process.env.SHARE_EMAIL || process.env.SMTP_USER;
  if (ownerEmail) {
    try {
      await drive.permissions.create({
        fileId: folder.data.id,
        transferOwnership: true,
        requestBody: { role: 'owner', type: 'user', emailAddress: ownerEmail },
      });
    } catch (err) {
      console.warn(`[Drive] Folder ownership transfer failed: ${err.message}`);
    }
  }

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

  // Search in the service account's Drive root
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
 * Ensure storage is ready (create root folder on Google Drive and share it).
 */
async function ensureBuckets() {
  if (!isCloudStorage) {
    console.warn('WARNING: Google Drive storage NOT configured. Files will be stored locally (lost on Vercel restarts).');
    console.warn('Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY environment variables.');
    return;
  }

  try {
    const folderId = await ensureRootFolder();

    // Share the root folder with the user so they can see it in their Google Drive
    const shareEmail = process.env.SMTP_USER || process.env.SHARE_EMAIL;
    if (shareEmail) {
      try {
        const drive = getDrive();
        // Check if already shared
        const perms = await drive.permissions.list({ fileId: folderId, fields: 'permissions(emailAddress,role)' });
        const alreadyShared = perms.data.permissions?.some(
          (p) => p.emailAddress && p.emailAddress.toLowerCase() === shareEmail.toLowerCase()
        );
        if (!alreadyShared) {
          await drive.permissions.create({
            fileId: folderId,
            requestBody: { role: 'writer', type: 'user', emailAddress: shareEmail },
            sendNotificationEmail: false,
          });
          console.log(`Shared "Vehicle Records" folder with ${shareEmail}`);
        }
      } catch (shareErr) {
        console.warn('Could not share Drive folder:', shareErr.message);
      }
    }

    console.log('Google Drive storage ready.');
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

    // Transfer ownership to the user's account so the file counts against
    // their quota (service accounts have zero storage quota).
    const ownerEmail = process.env.SHARE_EMAIL || process.env.SMTP_USER;
    if (ownerEmail) {
      try {
        await drive.permissions.create({
          fileId,
          transferOwnership: true,
          requestBody: { role: 'owner', type: 'user', emailAddress: ownerEmail },
        });
        console.log(`[Drive] Transferred ownership of ${fileId} to ${ownerEmail}`);
      } catch (ownerErr) {
        console.warn(`[Drive] Ownership transfer failed: ${ownerErr.message}`);
        // Fall back to making publicly readable
        await drive.permissions.create({
          fileId,
          requestBody: { role: 'reader', type: 'anyone' },
        });
      }
    } else {
      // No owner email configured — make publicly readable
      await drive.permissions.create({
        fileId,
        requestBody: { role: 'reader', type: 'anyone' },
      });
    }

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
    // filePath is already a full Google Drive URL
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
