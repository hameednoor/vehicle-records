/**
 * File storage abstraction.
 *
 * When SUPABASE_URL is set  -> uses Supabase Storage (cloud)
 * When it is not            -> uses local filesystem (server/uploads/)
 *
 * Exported interface:
 *   uploadFile(bucket, filePath, buffer, mimetype)  -> URL string
 *   deleteFile(bucket, filePath)                    -> void
 *   getFileUrl(bucket, filePath)                    -> URL string
 *   isCloudStorage                                  -> boolean
 */

const fs = require('fs');
const path = require('path');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const isCloudStorage = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);

/**
 * Extract the filename from a file path or a full URL.
 * Handles cloud URLs like "https://xxx.supabase.co/storage/v1/object/public/invoices/abc.jpg?token=..."
 * as well as local paths and simple filenames.
 */
function extractFilename(filePath) {
  if (!filePath) return '';
  try {
    // If it looks like a URL, parse it properly to strip query params
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      const url = new URL(filePath);
      return path.basename(url.pathname);
    }
  } catch (_) {
    // Fall through to path.basename
  }
  return path.basename(filePath);
}

let supabase = null;

function getSupabase() {
  if (supabase) return supabase;
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
  return supabase;
}

/**
 * Ensure Supabase Storage buckets exist.
 */
async function ensureBuckets() {
  if (!isCloudStorage) return;

  const client = getSupabase();
  const buckets = ['invoices', 'vehicle-photos'];

  for (const bucket of buckets) {
    try {
      const { data, error } = await client.storage.getBucket(bucket);
      if (error) {
        if (error.message && error.message.includes('not found')) {
          const { error: createErr } = await client.storage.createBucket(bucket, {
            public: true,
            fileSizeLimit: 10 * 1024 * 1024, // 10MB
          });
          if (createErr) {
            console.error(`Failed to create bucket "${bucket}":`, createErr.message);
          } else {
            console.log(`Created storage bucket: ${bucket}`);
          }
        } else {
          console.error(`Error checking bucket "${bucket}":`, error.message);
        }
      }
    } catch (err) {
      console.error(`Exception checking/creating bucket "${bucket}":`, err.message);
    }
  }
}

/**
 * Upload a file.
 *
 * @param {string} bucket - Bucket name (e.g. 'invoices', 'vehicle-photos')
 * @param {string} filePath - The path/key within the bucket (e.g. 'abc-123.jpg')
 * @param {Buffer} buffer - File contents
 * @param {string} mimetype - MIME type
 * @returns {Promise<string>} Public URL or local path
 */
async function uploadFile(bucket, filePath, buffer, mimetype) {
  if (isCloudStorage) {
    const client = getSupabase();
    const { error } = await client.storage
      .from(bucket)
      .upload(filePath, buffer, {
        contentType: mimetype,
        upsert: true,
      });

    if (error) {
      throw new Error(`Supabase upload failed: ${error.message}`);
    }

    const { data: urlData } = client.storage.from(bucket).getPublicUrl(filePath);
    return urlData.publicUrl;
  }

  // Local storage
  const filename = extractFilename(filePath);
  const destPath = path.join(UPLOADS_DIR, filename);
  fs.writeFileSync(destPath, buffer);
  return `/uploads/${filename}`;
}

/**
 * Delete a file.
 *
 * @param {string} bucket - Bucket name
 * @param {string} filePath - The path/key within the bucket
 */
async function deleteFile(bucket, filePath) {
  if (!filePath) return;

  if (isCloudStorage) {
    const client = getSupabase();
    // Ensure we pass just the filename/key, not a full URL
    const key = extractFilename(filePath);
    const { error } = await client.storage.from(bucket).remove([key]);
    if (error) {
      console.error(`Supabase delete failed: ${error.message}`);
    }
    return;
  }

  // Local storage - skip if filePath is a cloud URL (e.g. leftover from cloud config)
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
 *
 * @param {string} bucket - Bucket name
 * @param {string} filePath - The path/key within the bucket
 * @returns {Promise<string>} URL
 */
async function getFileUrl(bucket, filePath) {
  if (isCloudStorage) {
    const client = getSupabase();
    const { data } = client.storage.from(bucket).getPublicUrl(filePath);
    return data.publicUrl;
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
  UPLOADS_DIR,
};
