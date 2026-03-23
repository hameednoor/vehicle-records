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
    const { data, error } = await client.storage.getBucket(bucket);
    if (error && error.message.includes('not found')) {
      const { error: createErr } = await client.storage.createBucket(bucket, {
        public: true,
        fileSizeLimit: 10 * 1024 * 1024, // 10MB
      });
      if (createErr) {
        console.error(`Failed to create bucket "${bucket}":`, createErr.message);
      } else {
        console.log(`Created storage bucket: ${bucket}`);
      }
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
  const destPath = path.join(UPLOADS_DIR, path.basename(filePath));
  fs.writeFileSync(destPath, buffer);
  return `/uploads/${path.basename(filePath)}`;
}

/**
 * Delete a file.
 *
 * @param {string} bucket - Bucket name
 * @param {string} filePath - The path/key within the bucket
 */
async function deleteFile(bucket, filePath) {
  if (isCloudStorage) {
    const client = getSupabase();
    const { error } = await client.storage.from(bucket).remove([filePath]);
    if (error) {
      console.error(`Supabase delete failed: ${error.message}`);
    }
    return;
  }

  // Local storage
  const fullPath = path.join(UPLOADS_DIR, path.basename(filePath));
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

  return `/uploads/${path.basename(filePath)}`;
}

module.exports = {
  uploadFile,
  deleteFile,
  getFileUrl,
  isCloudStorage,
  ensureBuckets,
  UPLOADS_DIR,
};
